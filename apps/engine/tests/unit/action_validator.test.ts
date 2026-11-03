import { describe, test, expect } from "bun:test";
import { TestManager } from "../../src/test/TestManager";
import { StorageManager } from "../../src/storage/StorageManager";
import { CompactPageState, AgentAction } from "@agentqa/types";

describe("TestManager - Action Validation & Loop Detection", () => {
  const storage = new StorageManager();
  const testManager = new TestManager({
    aiProvider: null as any,
    eventCollector: null as any,
    incidentEngine: null as any,
    replayManager: null as any,
    verificationEngine: null as any,
    storage,
    limits: null as any,
    demoMode: false,
    demoAppUrl: "http://localhost:3000",
  });

  const mockPageState: CompactPageState = {
    url: "http://localhost:3000/cart",
    title: "Shopping Cart",
    buttons: [
      { text: "Apply Coupon", selector: "#apply-coupon" },
      { text: "Proceed to Checkout", selector: "#checkout-btn" },
    ],
    inputs: [
      { selector: "#coupon-input", type: "text", placeholder: "Enter coupon code" },
    ],
    links: [
      { text: "Continue Shopping", selector: "a.continue-link" },
    ],
  };

  test("Validates click action against existing page button selector", () => {
    const validAction: AgentAction = {
      type: "click",
      target: "#apply-coupon",
      description: "Click apply coupon",
      timestamp: Date.now(),
    };
    expect(testManager.validateAction(validAction, mockPageState)).toBe(true);
  });

  test("Validates type action with text value", () => {
    const validTypeAction: AgentAction = {
      type: "type",
      target: "#coupon-input",
      value: "SAVE10",
      description: "Enter coupon code",
      timestamp: Date.now(),
    };
    expect(testManager.validateAction(validTypeAction, mockPageState)).toBe(true);
  });

  test("Rejects type action when value is missing", () => {
    const invalidTypeAction: AgentAction = {
      type: "type",
      target: "#coupon-input",
      description: "Missing value",
      timestamp: Date.now(),
    };
    expect(testManager.validateAction(invalidTypeAction, mockPageState)).toBe(false);
  });

  test("Rejects unknown action type", () => {
    const invalidAction: any = {
      type: "execute_shell_command",
      target: "rm -rf /",
      description: "Malicious command",
      timestamp: Date.now(),
    };
    expect(testManager.validateAction(invalidAction, mockPageState)).toBe(false);
  });

  test("Loop detection flags 3 consecutive identical actions", () => {
    const action: AgentAction = {
      type: "click",
      target: "#apply-coupon",
      description: "Click apply coupon",
      timestamp: Date.now(),
    };

    const recentActions: AgentAction[] = [
      { ...action, timestamp: Date.now() - 3000 },
      { ...action, timestamp: Date.now() - 2000 },
      { ...action, timestamp: Date.now() - 1000 },
    ];

    expect(testManager.isActionLoop(action, recentActions)).toBe(true);

    // If recent actions are different, no loop
    const differentActions: AgentAction[] = [
      { type: "type", target: "#coupon-input", value: "SAVE10", description: "Type", timestamp: Date.now() - 2000 },
      { type: "click", target: "#apply-coupon", description: "Click", timestamp: Date.now() - 1000 },
    ];
    expect(testManager.isActionLoop(action, differentActions)).toBe(false);
  });
});
