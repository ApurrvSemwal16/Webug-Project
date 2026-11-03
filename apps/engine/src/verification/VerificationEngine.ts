/**
 * Verification Engine - Reruns tests to verify fixes
 */

import { VerificationStatus, FailureSignature, VerificationComparison, TestMetadata, BrowserEvent, AgentLimits, AgentAction } from "@agentqa/types";
import { BrowserManager } from "../browser/BrowserManager";
import { EventCollector } from "../events/EventCollector";
import { IncidentEngine } from "../incidents/IncidentEngine";
import type { AIProvider } from "@agentqa/types";
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

    const eventCollector = new EventCollector();
    eventCollector.setRunId(runId);
    eventCollector.setStorage(this.storage);

    const incidentEngine = new IncidentEngine(this.storage);
    eventCollector.setIncidentEngine(incidentEngine);

    const browserManager = new BrowserManager({
      runId,
      eventCollector,
      demoMode,
    });

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
        status: "INCONCLUSIVE",
        originalFailure,
        comparison: {
          outcome: "INCONCLUSIVE",
          networkStatusChanged: false,
          consoleErrorsChanged: false,
          goalCompletionChanged: false,
          originalFailureResolved: false,
          details: error instanceof Error ? error.message : String(error),
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
    const maxSteps = 15;
    let step = 0;
    const executedActions: AgentAction[] = [];

    while (step < maxSteps) {
      const pageState = await browserManager.getCompactPageState();
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
        break;
      }

      let action: AgentAction | null = null;

      // 2. Checkout page (/checkout)
      if (isCheckout) {
        const emailInput = pageState.inputs.find(
          i => i.selector === "#checkout-email" || i.type === "email" || i.placeholder?.includes("you@example.com")
        );
        if (emailInput && !emailInput.value) {
          action = { type: "type", target: "#checkout-email", value: "test@example.com", description: "Enter email", timestamp: Date.now() };
        } else {
          const nameInput = pageState.inputs.find(
            i => i.selector === "#checkout-name" || i.placeholder?.includes("John Doe")
          );
          if (nameInput && !nameInput.value) {
            action = { type: "type", target: "#checkout-name", value: "John Doe", description: "Enter full name", timestamp: Date.now() };
          } else {
            const addressInput = pageState.inputs.find(
              i => i.selector === "#checkout-address" || i.placeholder?.includes("123 Main St")
            );
            if (addressInput && !addressInput.value) {
              action = { type: "type", target: "#checkout-address", value: "123 Main St", description: "Enter address", timestamp: Date.now() };
            } else {
              const cityInput = pageState.inputs.find(
                i => i.selector === "#checkout-city" || i.placeholder?.includes("San Francisco")
              );
              if (cityInput && !cityInput.value) {
                action = { type: "type", target: "#checkout-city", value: "San Francisco", description: "Enter city", timestamp: Date.now() };
              } else {
                const zipInput = pageState.inputs.find(
                  i => i.selector === "#checkout-zip" || i.placeholder?.includes("94102")
                );
                if (zipInput && !zipInput.value) {
                  action = { type: "type", target: "#checkout-zip", value: "94102", description: "Enter zip", timestamp: Date.now() };
                } else {
                  const placeOrderBtn = pageState.buttons.find(
                    b => b.selector === "#place-order" || b.text.toLowerCase().includes("place order")
                  );
                  if (!placeOrderBtn) {
                    throw new Error("Place order button (#place-order) not found on Checkout page");
                  }
                  const alreadyPlaced = executedActions.some(
                    a => a.type === "click" && (a.target === "#place-order" || a.description?.toLowerCase().includes("place order"))
                  );
                  if (!alreadyPlaced) {
                    action = { type: "click", target: "#place-order", description: "Place order", timestamp: Date.now() };
                  } else {
                    action = { type: "finish", target: "done", description: "Complete", timestamp: Date.now() };
                  }
                }
              }
            }
          }
        }
      } else if (isCart) {
        // 3. Cart page (/cart)
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

        const couponTyped = executedActions.some(
          a => a.type === "type" && (a.target === "#coupon-input" || a.value === "SAVE10")
        );
        if (!couponTyped) {
          action = { type: "type", target: "#coupon-input", value: "SAVE10", description: "Enter coupon SAVE10", timestamp: Date.now() };
        } else {
          const couponApplied = executedActions.some(
            a => a.type === "click" && (a.target === "#apply-coupon" || a.description?.toLowerCase().includes("apply coupon"))
          );
          if (!couponApplied) {
            action = { type: "click", target: "#apply-coupon", description: "Apply coupon", timestamp: Date.now() };
          } else {
            action = { type: "click", target: "#checkout-btn", description: "Proceed to checkout", timestamp: Date.now() };
          }
        }
      } else {
        // 4. Home page
        const productAdded = executedActions.some(
          a => a.type === "click" && (a.target === ".add-to-cart" || a.description?.toLowerCase().includes("add product"))
        );
        if (!productAdded) {
          const addToCartBtn = pageState.buttons.find(
            b => b.selector === ".add-to-cart" || b.text.toLowerCase().includes("add to cart")
          );
          if (!addToCartBtn) {
            throw new Error("Add to Cart button (.add-to-cart) not found on Home page");
          }
          action = { type: "click", target: ".add-to-cart", description: "Add product to cart", timestamp: Date.now() };
        } else {
          const cartLink = pageState.links.find(
            l => l.selector === 'a[href="/cart"]' || l.text.toLowerCase().includes("cart")
          );
          if (!cartLink) {
            throw new Error("Cart link (a[href='/cart']) not found in navigation");
          }
          action = { type: "click", target: 'a[href="/cart"]', description: "Navigate to cart", timestamp: Date.now() };
        }
      }

      if (!action || action.type === "finish") break;

      const result = await browserManager.executeAction(action);
      if (!result.success) {
        console.log(`[verification] Action failed: ${result.error}`);
      }
      executedActions.push(action);

      step++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  public createFailureSignature(events: BrowserEvent[], incidents: any[]): FailureSignature {
    const networkResponses = events.filter(e => e.type === "network_response");
    const networkErrors = networkResponses.filter(e => (e.data as any).status >= 400);
    const networkErrorEvents = events.filter(e => e.type === "network_error");
    const consoleErrors = events.filter(e => e.type === "console_error");
    const exceptions = events.filter(e => e.type === "exception" || e.type === "page_error");

    // Check for the specific coupon error or success
    const couponError = networkErrors.find(e => (e.data as any).url?.includes("/api/coupon"));
    const couponSuccess = networkResponses.find(
      e => (e.data as any).url?.includes("/api/coupon") && (e.data as any).status === 200
    );

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
      endpoint: couponSuccess ? (couponSuccess.data as any).url : undefined,
      status: couponSuccess ? (couponSuccess.data as any).status : 200,
      message: couponSuccess ? "Coupon applied successfully (HTTP 200)" : "Success",
      consoleErrors: consoleErrors.length,
      goalCompleted: true,
    };
  }

  public compareFailures(original: FailureSignature, current: FailureSignature): VerificationComparison {
    const networkStatusChanged = original.status !== current.status || original.type !== current.type;
    const consoleErrorsChanged = original.consoleErrors !== current.consoleErrors;
    const goalCompletionChanged = original.goalCompleted !== current.goalCompleted;

    const originalFailureResolved =
      (original.status === 500 && current.status === 200 && current.type === "none") ||
      (original.type === "network_error" && current.type === "none") ||
      (original.type === "exception" && current.type === "none") ||
      (original.goalCompleted === false && current.goalCompleted === true && current.type === "none");

    let outcome: "PASSED" | "FAILED" | "REGRESSION" | "INCONCLUSIVE";
    let details: string;

    if (!current || current.type === "inconclusive") {
      outcome = "INCONCLUSIVE";
      details = "Verification test failed to execute to completion.";
    } else if (originalFailureResolved) {
      if (current.consoleErrors > original.consoleErrors && current.consoleErrors > 0) {
        outcome = "REGRESSION";
        details = "Original failure resolved, but new console errors appeared.";
      } else {
        outcome = "PASSED";
        details = "Original failure resolved and no new regressions detected.";
      }
    } else if (
      current.status &&
      current.status >= 400 &&
      current.endpoint &&
      original.endpoint &&
      !current.endpoint.includes(original.endpoint)
    ) {
      outcome = "REGRESSION";
      details = `Original failure resolved, but new failure occurred on ${current.endpoint} (${current.status}).`;
    } else {
      outcome = "FAILED";
      details = `Original failure still reproduced: ${current.message || current.type}`;
    }

    return {
      outcome,
      networkStatusChanged,
      consoleErrorsChanged,
      goalCompletionChanged,
      originalFailureResolved,
      details,
    };
  }
}
