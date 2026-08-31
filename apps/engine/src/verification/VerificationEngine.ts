/**
 * Verification Engine - Reruns tests to verify fixes
 */

import { VerificationStatus, FailureSignature, VerificationComparison, TestMetadata, BrowserEvent, AgentLimits } from "@agentqa/types";
import { BrowserManager } from "../browser/BrowserManager";
import { EventCollector } from "../events/EventCollector";
import { IncidentEngine } from "../incidents/IncidentEngine";
import { AIProvider } from "../ai/AIProvider";
import { ReplayManager } from "../replay/ReplayManager";
import { StorageManager } from "../storage/StorageManager";
import { TestManager } from "../test/TestManager";
import { nanoid } from "nanoid";

interface VerificationRunOptions {
  runId: string;
  url: string;
  goal: string;
  originalFailure: FailureSignature;
  demoMode: boolean;
  eventCollector: EventCollector;
  incidentEngine: IncidentEngine;
  aiProvider: AIProvider;
  replayManager: ReplayManager;
  storage: StorageManager;
  limits: AgentLimits;
}

export class VerificationEngine {
  private storage: StorageManager;

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  async verify(
    runId: string,
    url: string,
    goal: string,
    originalFailure: FailureSignature,
    demoMode: boolean
  ): Promise<VerificationStatus> {
    // Create a minimal test run for verification
    const testManager = new TestManager({
      aiProvider: null as any, // Will be set by caller
      eventCollector: new EventCollector(),
      incidentEngine: new IncidentEngine(this.storage),
      replayManager: new ReplayManager(this.storage),
      verificationEngine: this,
      storage: this.storage,
      limits: {
        maxActions: 20,
        maxRuntime: 60000,
        maxConsecutiveFailures: 3,
        maxAICalls: 10,
      },
      demoMode,
      demoAppUrl: url,
    });

    // We need to properly set up the test manager with real dependencies
    // For now, let's do a simplified verification using a direct browser run

    const browserManager = new BrowserManager({
      runId,
      eventCollector: new EventCollector(),
      demoMode,
    });

    const eventCollector = new EventCollector();
    eventCollector.setRunId(runId);

    const incidentEngine = new IncidentEngine(this.storage);

    try {
      await browserManager.launch();
      await browserManager.navigate(url);

      // Run a simplified test flow similar to the original
      await this.runVerificationFlow(browserManager, goal, demoMode);

      // Collect results
      const events = eventCollector.getEvents();
      const incidents = await incidentEngine.getIncidents(runId);

      // Create failure signature for new run
      const newFailure = this.createFailureSignature(events, incidents);

      // Compare
      const comparison = this.compareFailures(originalFailure, newFailure);

      const verification: VerificationStatus = {
        status: comparison.originalFailureResolved ? "VERIFIED" : "NOT_VERIFIED",
        originalFailure,
        newRunId: runId,
        newFailure,
        comparison,
        completedAt: Date.now(),
      };

      await browserManager.close();
      return verification;
    } catch (error) {
      await browserManager.close();
      return {
        status: "ERROR",
        originalFailure,
        comparison: {
          networkStatusChanged: false,
          consoleErrorsChanged: false,
          goalCompletionChanged: false,
          originalFailureResolved: false,
        },
        completedAt: Date.now(),
      };
    }
  }

  private async runVerificationFlow(
    browserManager: BrowserManager,
    goal: string,
    demoMode: boolean
  ): Promise<void> {
    // Simplified deterministic flow for verification
    const maxSteps = 15;
    let step = 0;

    while (step < maxSteps) {
      const pageState = await browserManager.getCompactPageState();
      const url = pageState.url;

      // Determine action based on page (same logic as demo mode)
      let action: any = null;

      if (url.includes("/checkout")) {
        const emailInput = pageState.inputs.find(i =>
          i.type === "email" || i.placeholder?.includes("email") || i.text?.includes("Email")
        );
        if (emailInput && !emailInput.value) {
          action = { type: "type", target: emailInput.selector, value: "test@example.com", description: "Enter email" };
        } else {
          const couponInput = pageState.inputs.find(i =>
            i.placeholder?.includes("coupon") || i.text?.includes("coupon")
          );
          const applyBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("apply"));
          if (couponInput && !couponInput.value && applyBtn) {
            action = { type: "type", target: couponInput.selector, value: "SAVE10", description: "Enter coupon" };
          } else if (applyBtn && couponInput?.value === "SAVE10") {
            action = { type: "click", target: applyBtn.text, description: "Apply coupon" };
          } else {
            const placeOrderBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("place order"));
            if (placeOrderBtn) {
              action = { type: "click", target: placeOrderBtn.text, description: "Place order" };
            } else {
              action = { type: "finish", target: "done", description: "Complete" };
            }
          }
        }
      } else if (url.includes("/cart")) {
        const checkoutBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("checkout"));
        if (checkoutBtn) {
          action = { type: "click", target: checkoutBtn.text, description: "Go to checkout" };
        }
      } else {
        const addToCartBtn = pageState.buttons.find(b => b.text.toLowerCase().includes("add to cart"));
        if (addToCartBtn) {
          action = { type: "click", target: addToCartBtn.text, description: "Add to cart" };
        } else {
          const productLink = pageState.links.find(l =>
            l.text && !l.text.includes("Cart") && !l.text.includes("Home")
          );
          if (productLink) {
            action = { type: "click", target: productLink.text, description: "View product" };
          } else if (pageState.buttons.length > 0) {
            action = { type: "click", target: pageState.buttons[0].text, description: "Click button" };
          } else {
            action = { type: "finish", target: "done", description: "Complete" };
          }
        }
      }

      if (!action || action.type === "finish") break;

      const result = await browserManager.executeAction(action);
      if (!result.success) {
        console.log(`[verification] Action failed: ${result.error}`);
      }

      step++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  private createFailureSignature(events: BrowserEvent[], incidents: any[]): FailureSignature {
    const networkErrors = events.filter(e =>
      e.type === "network_response" && (e.data as any).status >= 400
    );
    const networkErrorEvents = events.filter(e => e.type === "network_error");
    const consoleErrors = events.filter(e => e.type === "console_error");
    const exceptions = events.filter(e => e.type === "exception" || e.type === "page_error");

    // Check for the specific coupon 500 error
    const couponError = networkErrors.find(e => (e.data as any).url?.includes("/api/coupon"));

    if (couponError) {
      return {
        type: "network_error",
        endpoint: (couponError.data as any).url,
        status: (couponError.data as any).status,
        message: `Coupon API returned ${(couponError.data as any).status}`,
        consoleErrors: consoleErrors.length,
        goalCompleted: false,
      };
    }

    if (networkErrorEvents.length > 0) {
      return {
        type: "network_error",
        endpoint: (networkErrorEvents[0].data as any).url,
        message: (networkErrorEvents[0].data as any).error,
        consoleErrors: consoleErrors.length,
        goalCompleted: false,
      };
    }

    if (exceptions.length > 0) {
      return {
        type: "exception",
        message: (exceptions[0].data as any).message,
        consoleErrors: consoleErrors.length,
        goalCompleted: false,
      };
    }

    return {
      type: "none",
      consoleErrors: consoleErrors.length,
      goalCompleted: true,
    };
  }

  private compareFailures(original: FailureSignature, current: FailureSignature): VerificationComparison {
    const networkStatusChanged = original.endpoint && current.endpoint
      ? original.status !== current.status
      : original.type !== current.type;

    const consoleErrorsChanged = original.consoleErrors !== current.consoleErrors;
    const goalCompletionChanged = original.goalCompleted !== current.goalCompleted;

    // Original failure is resolved if:
    // - The original error endpoint no longer returns an error
    // - No new critical errors
    // - Goal can now be completed
    const originalFailureResolved =
      (original.type === "network_error" && current.type === "none") ||
      (original.type === "network_error" && current.type === "network_error" && current.status && current.status < 400) ||
      (original.type === "exception" && current.type === "none") ||
      (original.goalCompleted === false && current.goalCompleted === true);

    return {
      networkStatusChanged,
      consoleErrorsChanged,
      goalCompletionChanged,
      originalFailureResolved,
    };
  }
}