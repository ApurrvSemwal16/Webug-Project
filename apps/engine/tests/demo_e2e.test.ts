import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { TestManager } from "../src/test/TestManager";
import { AIProviderFactory } from "../src/ai/AIProviderFactory";
import { EventCollector } from "../src/events/EventCollector";
import { IncidentEngine } from "../src/incidents/IncidentEngine";
import { ReplayManager } from "../src/replay/ReplayManager";
import { VerificationEngine } from "../src/verification/VerificationEngine";
import { StorageManager } from "../src/storage/StorageManager";
import { DEFAULT_LIMITS } from "@agentqa/types";

const DEMO_URL = "http://localhost:3000";

describe("WeBug Phase 2 - End-to-End Demo Flow & Verification", () => {
  let testManager: TestManager;
  let storage: StorageManager;
  let verificationEngine: VerificationEngine;

  beforeAll(async () => {
    // Ensure demo app has initial unfixed state
    const resetRes = await fetch(`${DEMO_URL}/api/admin/reset-fix`, { method: "POST" });
    expect(resetRes.status).toBe(200);

    storage = new StorageManager();
    await storage.initialize();

    const aiProvider = AIProviderFactory.create(
      process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      process.env.OLLAMA_MODEL || "qwen3:1.7b"
    );

    const eventCollector = new EventCollector();
    eventCollector.setStorage(storage);

    const incidentEngine = new IncidentEngine(storage);
    const replayManager = new ReplayManager(storage);
    verificationEngine = new VerificationEngine(storage);

    testManager = new TestManager({
      aiProvider,
      eventCollector,
      incidentEngine,
      replayManager,
      verificationEngine,
      storage,
      limits: {
        maxActions: 15,
        maxRuntime: 180000,
        maxConsecutiveFailures: 3,
        maxAICalls: 1,
      },
      demoMode: true,
      demoAppUrl: DEMO_URL,
    });
  });

  afterAll(async () => {
    await testManager.shutdown();
    await fetch(`${DEMO_URL}/api/admin/reset-fix`, { method: "POST" });
  });

  test("Initial Test Run: Executes Cart coupon flow and captures HTTP 500 failure", async () => {
    const runId = "test-e2e-" + Date.now();
    await testManager.createTest({
      id: runId,
      url: DEMO_URL,
      goal: "Test the checkout flow and coupon validation",
      demoMode: true,
    });

    expect(runId).toBeDefined();

    // Execute the test flow
    await testManager.runTest(runId);

    // Fetch stored test run
    const testMeta = await storage.getTest(runId);
    expect(testMeta).not.toBeNull();
    expect(testMeta?.status).toBe("COMPLETED");

    // Verify browser executed the expected actions on Cart and Checkout
    const actions = await storage.getActions(runId);
    expect(actions.length).toBeGreaterThanOrEqual(4);

    const couponTyped = actions.find(a => a.type === "type" && a.value === "SAVE10");
    expect(couponTyped).toBeDefined();
    expect(couponTyped?.target).toBe("#coupon-input");

    const couponApplied = actions.find(a => a.type === "click" && a.target === "#apply-coupon");
    expect(couponApplied).toBeDefined();

    // Verify network events captured the HTTP 500 error
    const events = await storage.getEvents(runId);
    const coupon500Event = events.find(
      e => e.type === "network_response" &&
      (e.data as any)?.url?.includes("/api/coupon") &&
      (e.data as any)?.status === 500
    );
    expect(coupon500Event).toBeDefined();
    expect((coupon500Event?.data as any)?.status).toBe(500);

    // Verify incident was detected
    const incidents = await storage.getIncidents(runId);
    expect(incidents.length).toBeGreaterThanOrEqual(1);

    // Verify bug report was created with evidence
    const bugs = await storage.getBugs(runId);
    expect(bugs.length).toBeGreaterThanOrEqual(1);
    const bug = bugs[0];
    expect(bug).toBeDefined();
    expect(bug.title.length).toBeGreaterThan(0);

    const bugEvidence = bug.evidence.find(
      ev => ev.type === "network_response" && (ev.data as any)?.status === 500
    );
    expect(bugEvidence).toBeDefined();

    // Test applying the demo fix via TestManager
    const fixResult = await testManager.applyFix(bug.id);
    expect(fixResult).toBe(true);

    // Verify server actually confirmed fix is applied
    const fixStatusRes = await fetch(`${DEMO_URL}/api/admin/fix-status`);
    const fixStatusBody = await fixStatusRes.json();
    expect(fixStatusBody.isFixApplied).toBe(true);

    // Run verification in a fresh browser session
    const verification = await testManager.verifyFix(runId);
    expect(verification.status).toBe("VERIFIED");
    expect(verification.originalFailure.status).toBe(500);
    expect(verification.newFailure?.status).toBe(200);
    expect(verification.comparison?.originalFailureResolved).toBe(true);
    expect(verification.comparison?.networkStatusChanged).toBe(true);
  }, 300000);
});
