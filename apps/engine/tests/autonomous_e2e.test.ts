import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { TestManager } from "../src/test/TestManager";
import { AIProviderFactory } from "../src/ai/AIProviderFactory";
import { EventCollector } from "../src/events/EventCollector";
import { IncidentEngine } from "../src/incidents/IncidentEngine";
import { ReplayManager } from "../src/replay/ReplayManager";
import { VerificationEngine } from "../src/verification/VerificationEngine";
import { StorageManager } from "../src/storage/StorageManager";

const DEMO_URL = "http://localhost:3000";

describe("WeBug - Autonomous AI Agent Exploration & Bug Discovery", () => {
  let testManager: TestManager;
  let storage: StorageManager;

  beforeAll(async () => {
    await fetch(`${DEMO_URL}/api/admin/reset-fix`, { method: "POST" });

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
    const verificationEngine = new VerificationEngine(storage);

    testManager = new TestManager({
      aiProvider,
      eventCollector,
      incidentEngine,
      replayManager,
      verificationEngine,
      storage,
      limits: {
        maxActions: 5,
        maxRuntime: 120000,
        maxConsecutiveFailures: 3,
        maxAICalls: 4,
      },
      demoMode: false, // Autonomous AI execution mode
      demoAppUrl: DEMO_URL,
    });
  });

  afterAll(async () => {
    await testManager.shutdown();
    await fetch(`${DEMO_URL}/api/admin/reset-fix`, { method: "POST" });
  });

  test("Autonomous Exploration: AI interprets goal, plans, and selects real browser actions", async () => {
    const runId = "auto-test-" + Date.now();
    await testManager.createTest({
      id: runId,
      url: DEMO_URL,
      goal: "Click Add to Cart for headphones and navigate to the cart page",
      demoMode: false,
    });

    await testManager.runTest(runId);

    const testMeta = await storage.getTest(runId);
    expect(testMeta).not.toBeNull();
    expect(["COMPLETED", "STOPPED"]).toContain(testMeta?.status || "");

    const actions = await storage.getActions(runId);
    expect(actions.length).toBeGreaterThanOrEqual(1);

    // Verify actions have valid agent structure generated during the run
    for (const a of actions) {
      expect(["click", "type", "navigate", "scroll", "wait", "finish"]).toContain(a.type);
      expect(typeof a.target).toBe("string");
      expect(typeof a.description).toBe("string");
      expect(typeof a.timestamp).toBe("number");
    }
  }, 180000);
});
