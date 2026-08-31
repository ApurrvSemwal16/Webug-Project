/**
 * Test Manager - Orchestrates the complete test lifecycle
 */

import { TestMetadata, AgentAction, BrowserEvent, Incident, BugReport, AgentContext, InvestigationContext, VerificationStatus, FailureSignature, CodeFix, CompactPageState, AgentLimits } from "@agentqa/types";
import { BrowserManager } from "../browser/BrowserManager";
import { EventCollector } from "../events/EventCollector";
import { IncidentEngine } from "../incidents/IncidentEngine";
import { AIProvider } from "../ai/AIProvider";
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
  private options: TestManagerOptions;
  private runs: Map<string, TestRun> = new Map();

  constructor(options: TestManagerOptions) {
    this.options = options;
    this.options.eventCollector.setIncidentEngine(this.options.incidentEngine);
    this.options.eventCollector.setTestManager(this);
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

      // Finalize incidents
      await this.options.incidentEngine.finalizeAll(runId);

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
        action = this.getDemoAction(pageState, run.actionCount, metadata.goal);
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
    return url.includes("demo-app:3000") || url.includes("localhost:3000");
  }

  private getDemoAction(pageState: CompactPageState, actionCount: number, goal: string): AgentAction {
    // Deterministic demo flow for the checkout test
    const url = pageState.url;

    if (url.includes("/checkout")) {
      // On checkout page
      if (actionCount < 3) {
        // Fill email if not filled
        const emailInput = pageState.inputs.find(i => i.type === "email" || i.placeholder?.includes("email") || i.text?.includes("Email"));
        if (emailInput && !emailInput.value) {
          return {
            type: "type",
            target: emailInput.selector,
            value: "test@example.com",
            description: "Enter email address",
            timestamp: Date.now(),
          };
        }
        // Fill shipping info
        const nameInput = pageState.inputs.find(i => i.text?.includes("Name") || i.placeholder?.includes("Name"));
        if (nameInput && !nameInput.value) {
          return {
            type: "type",
            target: nameInput.selector,
            value: "John Doe",
            description: "Enter name",
            timestamp: Date.now(),
          };
        }
        // Apply buggy coupon
        const couponInput = pageState.inputs.find(i => i.placeholder?.includes("coupon") || i.placeholder?.includes("Coupon") || i.text?.includes("coupon"));
        const applyBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("apply"));
        if (couponInput && !couponInput.value && applyBtn) {
          return {
            type: "type",
            target: couponInput.selector,
            value: "SAVE10",
            description: "Enter buggy coupon code",
            timestamp: Date.now(),
          };
        }
        if (applyBtn && couponInput?.value === "SAVE10") {
          return {
            type: "click",
            target: applyBtn.text,
            description: "Apply coupon",
            timestamp: Date.now(),
          };
        }
        // Place order
        const placeOrderBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("place order"));
        if (placeOrderBtn) {
          return {
            type: "click",
            target: placeOrderBtn.text,
            description: "Place order",
            timestamp: Date.now(),
          };
        }
      }
      return { type: "finish", target: "done", description: "Test complete", timestamp: Date.now() };
    }

    if (url.includes("/cart")) {
      // On cart page - go to checkout
      const checkoutBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("checkout"));
      if (checkoutBtn) {
        return {
          type: "click",
          target: checkoutBtn.text,
          description: "Proceed to checkout",
          timestamp: Date.now(),
        };
      }
    }

    // On product page - add first product to cart
    const addToCartBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("add to cart"));
    if (addToCartBtn) {
      return {
        type: "click",
        target: addToCartBtn.text,
        description: "Add product to cart",
        timestamp: Date.now(),
      };
    }

    // On home page - click first product
    const productLink = pageState.links.find(l => l.text && !l.text.includes("Cart") && !l.text.includes("Home"));
    if (productLink) {
      return {
        type: "click",
        target: productLink.text,
        description: "View product",
        timestamp: Date.now(),
      };
    }

    // Default: click first button
    if (pageState.buttons.length > 0) {
      return {
        type: "click",
        target: pageState.buttons[0].text,
        description: `Click ${pageState.buttons[0].text}`,
        timestamp: Date.now(),
      };
    }

    return { type: "finish", target: "done", description: "No actions available", timestamp: Date.now() };
  }

  private validateAction(action: AgentAction, pageState: CompactPageState): boolean {
    // Basic validation - check target exists in page state
    const allElements = [...pageState.buttons, ...pageState.inputs, ...pageState.links];
    const hasTarget = allElements.some(el =>
      el.text.toLowerCase().includes(action.target.toLowerCase()) ||
      el.selector === action.target ||
      el.placeholder?.toLowerCase().includes(action.target.toLowerCase())
    );

    // For navigate, always allow
    if (action.type === "navigate") return true;
    // For wait, scroll, finish - always allow
    if (["wait", "scroll", "finish"].includes(action.type)) return true;

    return hasTarget || this.options.demoMode; // In demo mode, be more permissive
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
    // Find the bug across all runs
    for (const [runId, run] of this.runs) {
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

  private async getRelevantSourceCode(bug: BugReport): Promise<Array<{ path: string; content: string }>> {
    // For demo app, we know the buggy file
    if (bug.rootCause.toLowerCase().includes("coupon") || bug.title.toLowerCase().includes("coupon")) {
      try {
        const file = Bun.file("/app/apps/demo-app/src/server.js");
        if (await file.exists()) {
          const content = await file.text();
          return [{ path: "apps/demo-app/src/server.js", content }];
        }
      } catch {
        // Ignore
      }
    }
    return [];
  }

  async verifyFix(runId: string): Promise<VerificationStatus> {
    const run = this.runs.get(runId);
    const originalTest = this.options.storage.getTest(runId);

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
    const bugs = test.bugs;
    const criticalBugs = bugs.filter(b => b.severity === "critical" || b.severity === "high");

    if (criticalBugs.length > 0) {
      const bug = criticalBugs[0];
      const networkErrorEvidence = bug.evidence.find(e => e.type === "network_response" || e.type === "network_error");
      return {
        type: "network_error",
        endpoint: networkErrorEvidence?.data?.url,
        status: networkErrorEvidence?.data?.status,
        message: bug.actual,
        consoleErrors: test.events.filter(e => e.type === "console_error").length,
        goalCompleted: false,
      };
    }

    return {
      type: "unknown",
      consoleErrors: test.events.filter(e => e.type === "console_error").length,
      goalCompleted: false,
    };
  }

  async shutdown(): Promise<void> {
    // Stop all running tests
    for (const [runId, run] of this.runs) {
      await this.stopTest(runId);
    }
  }
}