import { describe, test, expect } from "bun:test";
import { VerificationEngine } from "../../src/verification/VerificationEngine";
import { StorageManager } from "../../src/storage/StorageManager";
import { FailureSignature, BrowserEvent } from "@agentqa/types";

describe("VerificationEngine - Failure Signatures and Comparison", () => {
  const storage = new StorageManager();
  const engine = new VerificationEngine(storage);

  test("Generates failure signature from network 500 error event", () => {
    const events: BrowserEvent[] = [
      {
        id: "ev-1",
        runId: "run-1",
        timestamp: Date.now(),
        type: "network_response",
        data: {
          url: "http://localhost:3000/api/coupon",
          status: 500,
        },
      },
      {
        id: "ev-2",
        runId: "run-1",
        timestamp: Date.now() + 10,
        type: "console_error",
        data: { text: "Server responded with 500" },
      },
    ];

    const sig = engine.createFailureSignature(events, []);
    expect(sig.type).toBe("network_error");
    expect(sig.status).toBe(500);
    expect(sig.endpoint).toContain("/api/coupon");
    expect(sig.consoleErrors).toBe(1);
    expect(sig.goalCompleted).toBe(false);
  });

  test("Computes PASSED outcome when original failure is resolved and no regressions", () => {
    const original: FailureSignature = {
      type: "network_error",
      endpoint: "http://localhost:3000/api/coupon",
      status: 500,
      consoleErrors: 1,
      goalCompleted: false,
    };

    const current: FailureSignature = {
      type: "none",
      endpoint: "http://localhost:3000/api/coupon",
      status: 200,
      consoleErrors: 0,
      goalCompleted: true,
    };

    const cmp = engine.compareFailures(original, current);
    expect(cmp.outcome).toBe("PASSED");
    expect(cmp.originalFailureResolved).toBe(true);
    expect(cmp.networkStatusChanged).toBe(true);
    expect(cmp.goalCompletionChanged).toBe(true);
  });

  test("Computes FAILED outcome when original failure is still reproduced", () => {
    const original: FailureSignature = {
      type: "network_error",
      endpoint: "http://localhost:3000/api/coupon",
      status: 500,
      consoleErrors: 1,
      goalCompleted: false,
    };

    const current: FailureSignature = {
      type: "network_error",
      endpoint: "http://localhost:3000/api/coupon",
      status: 500,
      consoleErrors: 1,
      goalCompleted: false,
    };

    const cmp = engine.compareFailures(original, current);
    expect(cmp.outcome).toBe("FAILED");
    expect(cmp.originalFailureResolved).toBe(false);
  });

  test("Computes REGRESSION outcome when a new error occurs on another endpoint", () => {
    const original: FailureSignature = {
      type: "network_error",
      endpoint: "http://localhost:3000/api/coupon",
      status: 500,
      consoleErrors: 0,
      goalCompleted: false,
    };

    const current: FailureSignature = {
      type: "network_error",
      endpoint: "http://localhost:3000/api/checkout",
      status: 502,
      consoleErrors: 2,
      goalCompleted: false,
    };

    const cmp = engine.compareFailures(original, current);
    expect(cmp.outcome).toBe("REGRESSION");
    expect(cmp.details).toContain("checkout");
  });

  test("Computes INCONCLUSIVE outcome when current run aborted/crashed", () => {
    const original: FailureSignature = {
      type: "network_error",
      endpoint: "http://localhost:3000/api/coupon",
      status: 500,
      consoleErrors: 1,
      goalCompleted: false,
    };

    const current: FailureSignature = {
      type: "inconclusive",
      consoleErrors: 0,
      goalCompleted: false,
    };

    const cmp = engine.compareFailures(original, current);
    expect(cmp.outcome).toBe("INCONCLUSIVE");
  });
});
