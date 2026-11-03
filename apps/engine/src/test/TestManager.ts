import { PatchManager } from "../patch/PatchManager";
import { join } from "path";
/**
 * Test Manager - Orchestrates the complete test lifecycle
 */

import { TestMetadata, AgentAction, BrowserEvent, Incident, BugReport, AgentContext, InvestigationContext, VerificationStatus, FailureSignature, CodeFix, CompactPageState, AgentLimits } from "@agentqa/types";
import { BrowserManager } from "../browser/BrowserManager";
import { EventCollector } from "../events/EventCollector";
import { IncidentEngine } from "../incidents/IncidentEngine";
import type { AIProvider } from "@agentqa/types";
import { ReplayManager } from "../replay/ReplayManager";
import { VerificationEngine } from "../verification/VerificationEngine";
import { StorageManager } from "../storage/StorageManager";
import { nanoid } from "nanoid";

export interface TestManagerOptions {
  aiProvider: AIProvider;
  eventCollector: EventCollector;
  incidentEngine: IncidentEngine;
  replayManager: ReplayManager;
  verificationEngine: VerificationEngine;
  storage: StorageManager;
  limits: AgentLimits;
  demoMode: boolean;
  demoAppUrl: string;
}

interface TestRun {
  metadata: TestMetadata;
  browserManager: BrowserManager;
  abortController: AbortController;
  actionCount: number;
  aiCallCount: number;
  consecutiveFailures: number;
  startTime: number;
  subscribers: Set<(event: { type: string; data: any }) => void>;
}

export class TestManager {
  private patchManager = new PatchManager();
  private options: TestManagerOptions;
  private runs: Map<string, TestRun> = new Map();

  constructor(options: TestManagerOptions) {
    this.options = options;
    if (this.options.eventCollector) {
      if (this.options.incidentEngine) this.options.eventCollector.setIncidentEngine(this.options.incidentEngine);
      this.options.eventCollector.setTestManager(this);
    }
  }

  async createTest(params: { id: string; url: string; goal: string; demoMode: boolean }): Promise<{ metadata: TestMetadata; sseUrl: string }> {
    const { id, url, goal, demoMode } = params;

    const metadata: TestMetadata = {
      id,
      url,
      goal,
      startTime: Date.now(),
      status: "CREATED",
      actions: [],
      events: [],
      incidents: [],
      bugs: [],
      demoMode,
    };

    await this.options.storage.createTest(metadata);

    const browserManager = new BrowserManager({
      runId: id,
      eventCollector: this.options.eventCollector,
      demoMode,
    });

    const run: TestRun = {
      metadata,
      browserManager,
      abortController: new AbortController(),
      actionCount: 0,
      aiCallCount: 0,
      consecutiveFailures: 0,
      startTime: Date.now(),
      subscribers: new Set(),
    };

    this.runs.set(id, run);
    this.options.eventCollector.setRunId(id);

    return { metadata, sseUrl: `/api/tests/${id}/events/stream` };
  }

  subscribe(runId: string, callback: (event: { type: string; data: any }) => void): () => void {
    const run = this.runs.get(runId);
    if (!run) return () => {};

    run.subscribers.add(callback);
    return () => run.subscribers.delete(callback);
  }

  private emit(runId: string, type: string, data: any): void {
    const run = this.runs.get(runId);
    if (!run) return;

    for (const subscriber of run.subscribers) {
      try {
        subscriber({ type, data });
      } catch (error) {
        console.error("[test] Subscriber error:", error);
      }
    }
  }

  async runTest(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Test ${runId} not found`);

    try {
      // Update status
      run.metadata.status = "STARTING";
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "test_started", run.metadata);

      // Launch browser
      await run.browserManager.launch();

      // Navigate to target URL
      run.metadata.status = "RUNNING";
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "navigation", { url: run.metadata.url });

      await run.browserManager.navigate(run.metadata.url);

      // Main agent loop
      await this.agentLoop(runId);

      // Persist all events
      await this.options.storage.setEvents(runId, this.options.eventCollector.getEvents());

      // Finalize incidents
      await this.options.incidentEngine.finalizeAll(runId);

      // Investigate incidents and create bug reports
      await this.investigateIncidents(runId);

      // Save replay data before closing browser
      try {
        const rrwebEvents = run.browserManager.getRRWebEvents();
        if (rrwebEvents.length > 0) {
          await this.options.replayManager.saveReplay(runId, rrwebEvents, {
            href: run.metadata.url,
            width: 1280,
            height: 720,
            userAgent: "AgentQA/1.0",
          });
        }
      } catch (replayErr) {
        console.error("[test] Failed to save replay:", replayErr);
      }

      // Update final status
      run.metadata.status = "COMPLETED";
      run.metadata.endTime = Date.now();
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "test_completed", run.metadata);

    } catch (error) {
      console.error(`[test] Test ${runId} error:`, error);
      run.metadata.status = "FAILED";
      run.metadata.endTime = Date.now();
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "error", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      await run.browserManager.close();
      this.runs.delete(runId);
    }
  }

  private async agentLoop(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    const { metadata, browserManager, abortController } = run;
    const limits = this.options.limits;

    let step = 0;

    while (!abortController.signal.aborted) {
      // Check limits
      if (run.actionCount >= limits.maxActions) {
        console.log(`[test] Max actions (${limits.maxActions}) reached`);
        break;
      }
      if (Date.now() - run.startTime > limits.maxRuntime) {
        console.log(`[test] Max runtime (${limits.maxRuntime}ms) reached`);
        break;
      }
      if (run.consecutiveFailures >= limits.maxConsecutiveFailures) {
        console.log(`[test] Max consecutive failures (${limits.maxConsecutiveFailures}) reached`);
        break;
      }
      if (run.aiCallCount >= limits.maxAICalls) {
        console.log(`[test] Max AI calls (${limits.maxAICalls}) reached`);
        break;
      }

      step++;

      // Observe: Get current page state
      this.emit(runId, "agent_observing", { step, url: metadata.url });
      let pageState: CompactPageState;
      try {
        pageState = await browserManager.getCompactPageState();
      } catch (error) {
        console.error("[test] Failed to get page state:", error);
        run.consecutiveFailures++;
        await this.wait(1000);
        continue;
      }

      // Update metadata with current URL
      metadata.url = pageState.url;

      // Demo mode: use deterministic actions for known demo app
      let action: AgentAction;
      if (metadata.demoMode && this.isDemoApp(pageState.url)) {
        action = this.getDemoAction(pageState, run.actionCount, metadata.goal, metadata.actions);
      } else {
        // Decide: Ask AI for next action
        this.emit(runId, "agent_action", { step, message: "Asking AI for next action..." });

        const context: AgentContext = {
          goal: metadata.goal,
          pageState,
          recentActions: metadata.actions.slice(-5),
          recentEvents: this.options.eventCollector.getEvents().slice(-10),
          runId,
          step,
        };

        try {
          action = await this.options.aiProvider.generateAction(context);
          run.aiCallCount++;
        } catch (error) {
          console.error("[test] AI action generation failed:", error);
          run.consecutiveFailures++;
          await this.wait(1000);
          continue;
        }
      }

      // Validate action
      if (!this.validateAction(action, pageState)) {
        console.error("[test] Invalid action:", action);
        run.consecutiveFailures++;
        continue;
      }

      // Loop detection: prevent repetitive stuck loops
      if (this.isActionLoop(action, metadata.actions)) {
        console.warn("[test] Loop detected: Agent repeating action", action.type, action.target);
        action = {
          type: "wait",
          target: "page",
          value: "1000",
          description: "Wait 1s after loop detected",
          timestamp: Date.now(),
        };
      }

      // Execute action
      this.emit(runId, "agent_action", { step, action: action.description });
      const result = await browserManager.executeAction(action);

      // Record action
      action.timestamp = Date.now();
      metadata.actions.push(action);
      await this.options.storage.appendAction(runId, action);
      run.actionCount++;

      if (result.success) {
        run.consecutiveFailures = 0;
      } else {
        run.consecutiveFailures++;
        console.log(`[test] Action failed: ${result.error}`);
      }

      // Check for finish action
      if (action.type === "finish") {
        console.log(`[test] Test finished by agent`);
        break;
      }

      // Small delay between actions
      await this.wait(500);
    }
  }

  private isDemoApp(url: string): boolean {
    return url.includes("demo-app:3000") || url.includes("localhost:3000") || url.includes("127.0.0.1:3000");
  }

  private getDemoAction(
    pageState: CompactPageState,
    actionCount: number,
    goal: string,
    recentActions: AgentAction[] = []
  ): AgentAction {
    const url = pageState.url;

    const isConfirmation =
      url.includes("/confirmation") ||
      pageState.buttons.some(b => b.text.toLowerCase().includes("continue shopping")) ||
      pageState.links.some(l => l.text.toLowerCase().includes("continue shopping"));

    const isCheckout =
      pageState.inputs.some(i => i.selector === "#checkout-email") ||
      (url.includes("/checkout") && !isConfirmation);

    const isCart =
      pageState.inputs.some(i => i.selector === "#coupon-input") ||
      (url.includes("/cart") && !isCheckout && !isConfirmation);

    // 1. Order confirmation page
    if (isConfirmation) {
      return {
        type: "finish",
        target: "done",
        description: "Test complete - order confirmed",
        timestamp: Date.now(),
      };
    }

    // 2. Checkout page (/checkout)
    if (isCheckout) {
      const emailInput = pageState.inputs.find(
        i => i.selector === "#checkout-email" || i.type === "email" || i.placeholder?.includes("you@example.com")
      );
      if (emailInput && !emailInput.value) {
        return {
          type: "type",
          target: "#checkout-email",
          value: "test@example.com",
          description: "Enter email address",
          timestamp: Date.now(),
        };
      }

      const nameInput = pageState.inputs.find(
        i => i.selector === "#checkout-name" || i.placeholder?.includes("John Doe")
      );
      if (nameInput && !nameInput.value) {
        return {
          type: "type",
          target: "#checkout-name",
          value: "John Doe",
          description: "Enter full name",
          timestamp: Date.now(),
        };
      }

      const addressInput = pageState.inputs.find(
        i => i.selector === "#checkout-address" || i.placeholder?.includes("123 Main St")
      );
      if (addressInput && !addressInput.value) {
        return {
          type: "type",
          target: "#checkout-address",
          value: "123 Main St",
          description: "Enter shipping address",
          timestamp: Date.now(),
        };
      }

      const cityInput = pageState.inputs.find(
        i => i.selector === "#checkout-city" || i.placeholder?.includes("San Francisco")
      );
      if (cityInput && !cityInput.value) {
        return {
          type: "type",
          target: "#checkout-city",
          value: "San Francisco",
          description: "Enter city",
          timestamp: Date.now(),
        };
      }

      const zipInput = pageState.inputs.find(
        i => i.selector === "#checkout-zip" || i.placeholder?.includes("94102")
      );
      if (zipInput && !zipInput.value) {
        return {
          type: "type",
          target: "#checkout-zip",
          value: "94102",
          description: "Enter ZIP code",
          timestamp: Date.now(),
        };
      }

      const placeOrderBtn = pageState.buttons.find(
        b => b.selector === "#place-order" || b.text.toLowerCase().includes("place order")
      );
      if (!placeOrderBtn) {
        throw new Error("Place order button (#place-order) not found on Checkout page");
      }

      const orderAlreadyPlaced = recentActions.some(
        a => a.type === "click" && (a.target === "#place-order" || a.description?.toLowerCase().includes("place order"))
      );
      if (!orderAlreadyPlaced) {
        return {
          type: "click",
          target: "#place-order",
          description: "Place order",
          timestamp: Date.now(),
        };
      }

      return {
        type: "finish",
        target: "done",
        description: "Checkout submitted",
        timestamp: Date.now(),
      };
    }

    // 3. Cart page (/cart)
    if (isCart) {
      const couponInput = pageState.inputs.find(
        i => i.selector === "#coupon-input" || i.placeholder?.toLowerCase().includes("code") || i.placeholder?.toLowerCase().includes("coupon")
      );
      if (!couponInput) {
        throw new Error("Coupon input (#coupon-input) not found on Cart page");
      }

      const applyBtn = pageState.buttons.find(
        b => b.selector === "#apply-coupon" || b.text.toLowerCase().includes("apply")
      );
      if (!applyBtn) {
        throw new Error("Apply coupon button (#apply-coupon) not found on Cart page");
      }

      const checkoutBtn = pageState.buttons.find(
        b => b.selector === "#checkout-btn" || b.text.toLowerCase().includes("checkout")
      );
      if (!checkoutBtn) {
        throw new Error("Proceed to Checkout button (#checkout-btn) not found on Cart page");
      }

      const couponTyped = recentActions.some(
        a => a.type === "type" && (a.target === "#coupon-input" || a.value === "SAVE10")
      );
      if (!couponTyped) {
        return {
          type: "type",
          target: "#coupon-input",
          value: "SAVE10",
          description: "Enter coupon code SAVE10",
          timestamp: Date.now(),
        };
      }

      const couponApplied = recentActions.some(
        a => a.type === "click" && (a.target === "#apply-coupon" || a.description?.toLowerCase().includes("apply coupon"))
      );
      if (!couponApplied) {
        return {
          type: "click",
          target: "#apply-coupon",
          description: "Apply coupon",
          timestamp: Date.now(),
        };
      }

      return {
        type: "click",
        target: "#checkout-btn",
        description: "Proceed to checkout",
        timestamp: Date.now(),
      };
    }

    // 4. Home / Product page
    const productAdded = recentActions.some(
      a => a.type === "click" && (a.target === ".add-to-cart" || a.description?.toLowerCase().includes("add product"))
    );

    if (!productAdded) {
      const addToCartBtn = pageState.buttons.find(
        b => b.selector === ".add-to-cart" || b.text.toLowerCase().includes("add to cart")
      );
      if (!addToCartBtn) {
        throw new Error("Add to Cart button (.add-to-cart) not found on page");
      }
      return {
        type: "click",
        target: ".add-to-cart",
        description: "Add product to cart",
        timestamp: Date.now(),
      };
    }

    // Product is in cart, navigate to cart
    const cartLink = pageState.links.find(
      l => l.selector === 'a[href="/cart"]' || l.text.toLowerCase().includes("cart")
    );
    if (!cartLink) {
      throw new Error("Cart link (a[href='/cart']) not found in navigation");
    }

    return {
      type: "click",
      target: 'a[href="/cart"]',
      description: "Navigate to cart",
      timestamp: Date.now(),
    };
  }

  private async investigateIncidents(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    const incidents = await this.options.incidentEngine.getIncidents(runId);
    const severityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const uninvestigated = incidents
      .filter(i => !i.investigated)
      .sort((a, b) => (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0));

    if (uninvestigated.length === 0) return;

    run.metadata.status = "INVESTIGATING";
    await this.options.storage.updateTest(run.metadata);
    this.emit(runId, "investigation_started", { count: uninvestigated.length });

    const allEvents = this.options.eventCollector.getEvents();
    const bugs: BugReport[] = await this.options.storage.getBugs(runId);

    for (const incident of uninvestigated) {
      if (run.abortController.signal.aborted) break;
      if (run.aiCallCount >= this.options.limits.maxAICalls) break;

      // Build investigation context
      const incidentEvents = allEvents.filter(e => incident.eventIds.includes(e.id));
      const suspiciousEvent = incidentEvents[0] || allEvents.find(e => e.id === incident.eventIds[0]);
      if (!suspiciousEvent) continue;

      // Get recent actions before the incident
      const recentActions = run.metadata.actions.filter(a =>
        a.timestamp <= incident.firstTimestamp
      ).slice(-5);

      // Get relevant network events
      const relevantNetworkEvents = allEvents.filter(e =>
        (e.type === "network_response" || e.type === "network_error") &&
        e.timestamp >= incident.firstTimestamp - 5000 &&
        e.timestamp <= incident.lastTimestamp + 2000
      );

      // Get console errors around the incident
      const consoleErrors = allEvents.filter(e =>
        e.type === "console_error" &&
        e.timestamp >= incident.firstTimestamp - 5000 &&
        e.timestamp <= incident.lastTimestamp + 2000
      );

      // Get exceptions around the incident
      const exceptions = allEvents.filter(e =>
        (e.type === "exception" || e.type === "page_error") &&
        e.timestamp >= incident.firstTimestamp - 5000 &&
        e.timestamp <= incident.lastTimestamp + 2000
      );

      // Get current page state (best effort)
      let pageState = { url: incident.url, title: "", buttons: [], inputs: [], links: [], forms: [] };
      try {
        pageState = await run.browserManager.getCompactPageState();
      } catch { /* ignore */ }

      const context: InvestigationContext = {
        goal: run.metadata.goal,
        currentUrl: incident.url,
        recentActions,
        suspiciousEvent,
        relevantNetworkEvents,
        consoleErrors,
        exceptions,
        visibleElements: pageState,
        timestamps: { first: incident.firstTimestamp, last: incident.lastTimestamp },
      };

      try {
        run.aiCallCount++;
        const analysis = await this.options.aiProvider.analyzeBug(context);
        await this.options.incidentEngine.markInvestigated(runId, incident.id);

        if (analysis.isBug) {
          // Build evidence list from incident events
          const evidence = incidentEvents.map((e, i) => ({
            eventId: e.id,
            type: e.type,
            description: this.describeEvent(e),
            timestamp: e.timestamp,
            replayTimestamp: e.timestamp - (allEvents[0]?.timestamp || e.timestamp),
            data: e.data,
          }));

          const bug: BugReport = {
            id: `bug-${runId}-${incident.id}`,
            runId,
            incidentId: incident.id,
            title: analysis.title,
            severity: analysis.severity,
            confidence: analysis.confidence,
            expected: analysis.expected,
            actual: analysis.actual,
            rootCause: analysis.rootCause,
            evidence,
            createdAt: Date.now(),
          };

          bugs.push(bug);
          run.metadata.bugs.push(bug);
          await this.options.storage.setBugs(runId, bugs);
          incident.bugId = bug.id;

          this.emit(runId, "bug_found", bug);
          console.log(`[test] Bug found: ${bug.title} (${bug.severity})`);
        }
      } catch (error) {
        console.error("[test] Investigation error:", error);
        await this.options.incidentEngine.markInvestigated(runId, incident.id);
      }
    }
  }

  private describeEvent(event: BrowserEvent): string {
    const d = event.data as Record<string, unknown>;
    switch (event.type) {
      case "network_response":
        return `${d.method || "REQUEST"} ${d.url} → ${d.status} ${d.statusText || ""}`;
      case "network_error":
        return `Network error: ${d.url} - ${d.error || "Unknown"}`;
      case "console_error":
        return `Console error: ${String(d.text || "").substring(0, 100)}`;
      case "page_error":
        return `Page error: ${String(d.message || "").substring(0, 100)}`;
      case "exception":
        return `Exception: ${String(d.message || "").substring(0, 100)}`;
      case "timeout":
        return `Timeout: ${(d.action as Record<string,unknown>)?.target || "Unknown"}`;
      default:
        return `${event.type}: ${JSON.stringify(d).substring(0, 100)}`;
    }
  }

  public validateAction(action: AgentAction, pageState: CompactPageState): boolean {
    if (!action || !action.type) return false;
    const validTypes = ["click", "type", "navigate", "scroll", "wait", "finish"];
    if (!validTypes.includes(action.type)) return false;

    if (action.type === "type" && typeof action.value !== "string") return false;

    if (action.type === "navigate") {
      return Boolean(action.target && (action.target.startsWith("http://") || action.target.startsWith("https://") || action.target.startsWith("/")));
    }

    if (["wait", "scroll", "finish"].includes(action.type)) return true;

    const allElements = [...pageState.buttons, ...pageState.inputs, ...pageState.links];
    const hasTarget = allElements.some(el =>
      (el.text && el.text.toLowerCase().includes(action.target.toLowerCase())) ||
      el.selector === action.target ||
      (el.placeholder && el.placeholder.toLowerCase().includes(action.target.toLowerCase()))
    );

    return hasTarget || this.options.demoMode;
  }

  public isActionLoop(action: AgentAction, recentActions: AgentAction[]): boolean {
    if (recentActions.length < 3) return false;
    const last3 = recentActions.slice(-3);
    return last3.every(a => a.type === action.type && a.target === action.target && a.value === action.value);
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stopTest(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    run.abortController.abort();
    run.metadata.status = "STOPPED";
    run.metadata.endTime = Date.now();
    await this.options.storage.updateTest(run.metadata);
    await run.browserManager.close();
    this.runs.delete(runId);
  }

  async generateFix(bugId: string): Promise<CodeFix> {
    // Find the bug across all stored runs (active and completed)
    const allTests = await this.options.storage.listTests();
    for (const testMeta of allTests) {
      const runId = testMeta.id;
      const bugs = await this.options.storage.getBugs(runId);
      const bug = bugs.find(b => b.id === bugId);
      if (bug) {
        // Get evidence
        const events = await this.options.storage.getEvents(runId);
        const evidence = bug.evidence.map(e => {
          const event = events.find(ev => ev.id === e.eventId);
          return {
            eventId: e.eventId,
            type: e.type,
            description: e.description,
            timestamp: e.timestamp,
            replayTimestamp: e.replayTimestamp,
            data: event?.data,
          };
        });

        // Try to get relevant source code (for demo app)
        const sourceCode = await this.getRelevantSourceCode(bug);

        const fix = await this.options.aiProvider.generateFix({
          bug,
          evidence,
          sourceCode,
        });

        // Update bug with suggested fix
        bug.suggestedFix = fix;
        await this.options.storage.setBugs(runId, bugs);

        return fix;
      }
    }

    throw new Error(`Bug ${bugId} not found`);
  }

  async applyFix(bugId: string): Promise<boolean> {
    // 1. Check if bug has a code patch
    const allTests = await this.options.storage.listTests();
    let targetBug: BugReport | undefined;
    for (const test of allTests) {
      const bugs = await this.options.storage.getBugs(test.id);
      const found = bugs.find(b => b.id === bugId);
      if (found) {
        targetBug = found;
        break;
      }
    }

    if (targetBug?.suggestedFix?.patch) {
      const patchFile = targetBug.suggestedFix.file || "apps/demo-app/src/server.js";
      try {
        const patchResult = await this.patchManager.applyPatch(patchFile, targetBug.suggestedFix.patch);
        console.log(`[test] Patch applied to ${patchFile}: ${patchResult.message}`);
      } catch (e) {
        console.warn(`[test] File patch failed:`, e);
      }
    }

    // 2. Also notify demo app admin endpoint
    const demoUrl = this.options.demoAppUrl || "http://localhost:3000";
    try {
      const response = await fetch(`${demoUrl}/api/admin/apply-fix`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        return data.success === true && data.isFixApplied === true;
      }
    } catch (error) {
      console.warn("[test] Demo app admin endpoint not reachable:", error);
    }

    return true;
  }

  private async getRelevantSourceCode(bug: BugReport): Promise<Array<{ path: string; content: string }>> {
    // For demo app, we know the buggy file
    if (
      bug.rootCause.toLowerCase().includes("coupon") ||
      bug.title.toLowerCase().includes("coupon") ||
      bug.actual.toLowerCase().includes("coupon")
    ) {
      const candidates = [
        "/app/apps/demo-app/src/server.js",
        join(import.meta.dir, "../../../demo-app/src/server.js"),
        join(process.cwd(), "apps/demo-app/src/server.js"),
        join(process.cwd(), "../demo-app/src/server.js"),
      ];
      for (const candidate of candidates) {
        try {
          const file = Bun.file(candidate);
          if (await file.exists()) {
            const content = await file.text();
            return [{ path: "apps/demo-app/src/server.js", content }];
          }
        } catch {
          // Continue
        }
      }
    }
    return [];
  }

  async verifyFix(runId: string): Promise<VerificationStatus> {
    const run = this.runs.get(runId);
    const originalTest = await this.options.storage.getTest(runId);

    if (!originalTest) {
      throw new Error(`Original test ${runId} not found`);
    }

    // Create verification run
    const verificationRunId = `${runId}-verify-${nanoid(6)}`;

    // Get original failure signature
    const originalFailure = this.createFailureSignature(originalTest);

    // Run verification test
    const verification = await this.options.verificationEngine.verify(
      verificationRunId,
      originalTest.url,
      originalTest.goal,
      originalFailure,
      originalTest.demoMode
    );

    // Update original test with verification status
    originalTest.verificationStatus = verification;
    await this.options.storage.setVerification(runId, verification);

    return verification;
  }

  private createFailureSignature(test: TestMetadata): FailureSignature {
    const bugs = test.bugs || [];
    const significantBugs = bugs.filter(b => ["critical", "high", "medium"].includes(b.severity));
    const bug = significantBugs[0] || bugs[0];

    const couponErrorEvent = test.events?.find(
      e => e.type === "network_response" && (e.data as any)?.url?.includes("/api/coupon") && (e.data as any)?.status >= 400
    );

    if (couponErrorEvent) {
      const d = couponErrorEvent.data as any;
      return {
        type: "network_error",
        endpoint: d.url,
        status: d.status,
        message: bug ? bug.actual : `Coupon API returned ${d.status}`,
        consoleErrors: (test.events || []).filter(e => e.type === "console_error").length,
        goalCompleted: false,
      };
    }

    const networkErrorEvidence = bug?.evidence?.find(e => e.type === "network_response" || e.type === "network_error");
    if (networkErrorEvidence) {
      const d = networkErrorEvidence.data as Record<string, unknown> | undefined;
      return {
        type: "network_error",
        endpoint: d?.url as string | undefined,
        status: d?.status as number | undefined,
        message: bug?.actual || "Network error",
        consoleErrors: (test.events || []).filter(e => e.type === "console_error").length,
        goalCompleted: false,
      };
    }

    if (bug) {
      return {
        type: "bug",
        message: bug.actual || bug.title,
        consoleErrors: (test.events || []).filter(e => e.type === "console_error").length,
        goalCompleted: false,
      };
    }

    return {
      type: "none",
      consoleErrors: (test.events || []).filter(e => e.type === "console_error").length,
      goalCompleted: true,
    };
  }

  async shutdown(): Promise<void> {
    // Stop all running tests
    for (const [runId, run] of this.runs) {
      await this.stopTest(runId);
    }
  }
}