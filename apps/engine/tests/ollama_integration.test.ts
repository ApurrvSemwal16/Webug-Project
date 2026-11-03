import { describe, test, expect, beforeAll } from "bun:test";
import { AIProviderFactory } from "../src/ai/AIProviderFactory";
import { OllamaProvider } from "../src/ai/AIProvider";
import { AgentContext, InvestigationContext, FixContext, BrowserEvent } from "@agentqa/types";

describe("AIProvider - Ollama & Qwen3:1.7b Real Integration", () => {
  let aiProvider: OllamaProvider;
  const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";

  beforeAll(async () => {
    aiProvider = AIProviderFactory.create(OLLAMA_BASE_URL, OLLAMA_MODEL) as OllamaProvider;
    const isHealthy = await aiProvider.healthCheck();
    expect(isHealthy).toBe(true);
  });

  test("1. Health check connects to local Ollama service", async () => {
    const isHealthy = await aiProvider.healthCheck();
    expect(isHealthy).toBe(true);
  });

  test("2. Generates structured browser action conforming to schema", async () => {
    const context: AgentContext = {
      goal: "Add a wireless headphones product to the cart",
      pageState: {
        url: "http://localhost:3000",
        title: "Demo Store",
        buttons: [{ text: "Add to Cart", selector: ".add-to-cart" }],
        inputs: [],
        links: [{ text: "Cart", selector: 'a[href="/cart"]' }],
      },
      recentActions: [],
      recentEvents: [],
      runId: "test-ai-action",
      step: 1,
    };

    const action = await aiProvider.generateAction(context);
    expect(action).toBeDefined();
    expect(["click", "type", "navigate", "scroll", "wait", "finish"]).toContain(action.type);
    expect(action.target).toBeDefined();
    expect(typeof action.target).toBe("string");
    expect(action.description).toBeDefined();
    expect(typeof action.timestamp).toBe("number");
  }, 45000);

  test("3. Analyzes bug incident and produces structured BugReport with schema constraints", async () => {
    const suspiciousEvent: BrowserEvent = {
      id: "ev-err",
      runId: "test-ai-bug",
      timestamp: Date.now(),
      type: "network_response",
      data: {
        url: "http://localhost:3000/api/coupon",
        method: "POST",
        status: 500,
        statusText: "Internal Server Error",
      },
    };

    const context: InvestigationContext = {
      goal: "Apply coupon SAVE10 during checkout",
      currentUrl: "http://localhost:3000/cart",
      suspiciousEvent,
      recentActions: [
        { type: "type", target: "#coupon-input", value: "SAVE10", description: "Enter coupon code SAVE10", timestamp: Date.now() - 1000 },
        { type: "click", target: "#apply-coupon", description: "Click apply coupon", timestamp: Date.now() - 500 },
      ],
      relevantNetworkEvents: [suspiciousEvent],
      consoleErrors: [
        {
          id: "ev-console",
          runId: "test-ai-bug",
          timestamp: Date.now(),
          type: "console_error",
          data: { text: "Failed to load resource: 500 (Internal Server Error) at /api/coupon" },
        },
      ],
      exceptions: [],
    };

    const analysis = await aiProvider.analyzeBug(context);
    expect(analysis).toBeDefined();
    expect(analysis.isBug).toBe(true);
    expect(typeof analysis.title).toBe("string");
    expect(analysis.title.length).toBeGreaterThan(0);
    expect(["low", "medium", "high", "critical"]).toContain(analysis.severity);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0);
    expect(analysis.confidence).toBeLessThanOrEqual(1);
    expect(typeof analysis.expected).toBe("string");
    expect(typeof analysis.actual).toBe("string");
    expect(typeof analysis.rootCause).toBe("string");
    expect(Array.isArray(analysis.evidence)).toBe(true);
  }, 45000);

  test("4. Proposes unified diff code fix for identified bug", async () => {
    const context: FixContext = {
      bug: {
        id: "bug-1",
        runId: "test-ai-fix",
        title: "Coupon API returns HTTP 500 for SAVE10",
        severity: "critical",
        confidence: 0.9,
        expected: "Coupon applied successfully",
        actual: "HTTP 500 Internal Server Error",
        rootCause: "Intentional server exception when SAVE10 is passed",
        evidence: [{ eventId: "ev-1", type: "network_response", description: "POST /api/coupon -> 500", timestamp: Date.now(), replayTimestamp: 1000 }],
        timestamp: Date.now(),
      },
      evidence: [
        { eventId: "ev-1", type: "network_response", description: "POST /api/coupon -> 500", timestamp: Date.now(), replayTimestamp: 1000 },
      ],
      sourceCode: [
        {
          path: "apps/demo-app/src/server.js",
          content: "if (!isFixApplied && buggyCodes.includes(code)) {\n  throw new Error('Coupon validation service unavailable');\n}",
        },
      ],
    };

    const fix = await aiProvider.generateFix(context);
    expect(fix).toBeDefined();
    expect(typeof fix.explanation).toBe("string");
    expect(fix.explanation.length).toBeGreaterThan(0);
  }, 45000);

  test("5. Gracefully handles unreachable Ollama service without unhandled crash", async () => {
    const badProvider = new OllamaProvider("http://localhost:59999", "qwen3:1.7b", 2000);
    const health = await badProvider.healthCheck();
    expect(health).toBe(false);
  });
});
