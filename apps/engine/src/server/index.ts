/**
 * AgentQA Engine - Main Entry Point
 * Bun HTTP Server with SSE support
 */

import { serve } from "bun";
import { TestManager } from "../test/TestManager";
import { AIProviderFactory } from "../ai/AIProviderFactory";
import { EventCollector } from "../events/EventCollector";
import { IncidentEngine } from "../incidents/IncidentEngine";
import { ReplayManager } from "../replay/ReplayManager";
import { VerificationEngine } from "../verification/VerificationEngine";
import { StorageManager } from "../storage/StorageManager";
import { DEFAULT_LIMITS } from "@agentqa/types";
import { nanoid } from "nanoid";

// Configuration from environment
const PORT = parseInt(process.env.AGENTQA_PORT || "3001");
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://ollama:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
const DEMO_MODE = process.env.DEMO_MODE === "true";
const DEMO_APP_URL = process.env.DEMO_APP_URL || "http://demo-app:3000";

// Initialize core services
const storage = new StorageManager();
const aiProvider = AIProviderFactory.create(OLLAMA_BASE_URL, OLLAMA_MODEL);
const eventCollector = new EventCollector();
const incidentEngine = new IncidentEngine();
const replayManager = new ReplayManager();
const verificationEngine = new VerificationEngine(storage);
const testManager = new TestManager({
  aiProvider,
  eventCollector,
  incidentEngine,
  replayManager,
  verificationEngine,
  storage,
  limits: DEFAULT_LIMITS,
  demoMode: DEMO_MODE,
  demoAppUrl: DEMO_APP_URL,
});

// Start test cleanup interval (clean up old runs periodically)
setInterval(() => {
  storage.cleanupOldRuns(7 * 24 * 60 * 60 * 1000); // 7 days
}, 60 * 60 * 1000); // Run every hour

console.log(`[agentqa] Starting AgentQA Engine on port ${PORT}`);
console.log(`[agentqa] Ollama: ${OLLAMA_BASE_URL} (model: ${OLLAMA_MODEL})`);
console.log(`[agentqa] Demo mode: ${DEMO_MODE}`);
console.log(`[agentqa] Demo app URL: ${DEMO_APP_URL}`);

// HTTP Server with SSE support
const server = serve({
  port: PORT,
  fetch: async (req, server) => {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle OPTIONS
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (path === "/api/health") {
      const ollamaHealthy = await aiProvider.healthCheck();
      return Response.json({
        status: ollamaHealthy ? "healthy" : "degraded",
        ollama: ollamaHealthy ? "connected" : "disconnected",
        browser: "ready",
        timestamp: Date.now(),
      }, { headers: corsHeaders });
    }

    // Create new test
    if (path === "/api/tests" && req.method === "POST") {
      try {
        const body = await req.json();
        const { url: testUrl, goal, demoMode } = body;

        if (!testUrl || !goal) {
          return Response.json({ error: "url and goal are required" }, { status: 400, headers: corsHeaders });
        }

        const runId = nanoid(8);
        const test = await testManager.createTest({
          id: runId,
          url: testUrl,
          goal,
          demoMode: demoMode ?? DEMO_MODE,
        });

        // Start test asynchronously
        testManager.runTest(runId).catch(err => {
          console.error(`[agentqa] Test ${runId} failed:`, err);
        });

        return Response.json({
          test: test.metadata,
          sseUrl: `/api/tests/${runId}/events/stream`,
        }, { headers: corsHeaders });
      } catch (error) {
        console.error("[agentqa] Failed to create test:", error);
        return Response.json({ error: "Failed to create test" }, { status: 500, headers: corsHeaders });
      }
    }

    // Get test metadata
    if (path.match(/^\/api\/tests\/([^\/]+)$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const test = storage.getTest(runId);
      if (!test) {
        return Response.json({ error: "Test not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ test }, { headers: corsHeaders });
    }

    // Stop test
    if (path.match(/^\/api\/tests\/([^\/]+)\/stop$/) && req.method === "POST") {
      const runId = path.split("/")[3];
      await testManager.stopTest(runId);
      return Response.json({ success: true, message: "Test stopped" }, { headers: corsHeaders });
    }

    // Get test events
    if (path.match(/^\/api\/tests\/([^\/]+)\/events$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const events = storage.getEvents(runId);
      return Response.json({ events }, { headers: corsHeaders });
    }

    // Get test bugs
    if (path.match(/^\/api\/tests\/([^\/]+)\/bugs$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const bugs = storage.getBugs(runId);
      return Response.json({ bugs }, { headers: corsHeaders });
    }

    // SSE event stream
    if (path.match(/^\/api\/tests\/([^\/]+)\/events\/stream$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const test = storage.getTest(runId);
      if (!test) {
        return Response.json({ error: "Test not found" }, { status: 404, headers: corsHeaders });
      }

      // Upgrade to SSE
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          // Send initial state
          send("test_started", { runId, ...test });

          // Subscribe to test events
          const unsubscribe = testManager.subscribe(runId, (event) => {
            send(event.type, event.data);
          });

          // Handle client disconnect
          req.signal.addEventListener("abort", () => {
            unsubscribe();
            controller.close();
          });
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders,
        },
      });
    }

    // Generate fix for bug
    if (path.match(/^\/api\/bugs\/([^\/]+)\/fix$/) && req.method === "POST") {
      const bugId = path.split("/")[3];
      const fix = await testManager.generateFix(bugId);
      return Response.json({ fix }, { headers: corsHeaders });
    }

    // Verify fix
    if (path.match(/^\/api\/tests\/([^\/]+)\/verify$/) && req.method === "POST") {
      const runId = path.split("/")[3];
      const verification = await testManager.verifyFix(runId);
      return Response.json({ verification }, { headers: corsHeaders });
    }

    // Get replay data
    if (path.match(/^\/api\/tests\/([^\/]+)\/replay$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const replay = storage.getReplay(runId);
      if (!replay) {
        return Response.json({ error: "Replay not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ replay }, { headers: corsHeaders });
    }

    // List all tests
    if (path === "/api/tests" && req.method === "GET") {
      const tests = storage.listTests();
      return Response.json({ tests }, { headers: corsHeaders });
    }

    // Serve static frontend files
    if (path === "/" || path.startsWith("/assets/")) {
      let filePath = path === "/" ? "/index.html" : path;
      filePath = `/app/apps/web/dist${filePath}`;

      try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": getContentType(filePath),
              ...corsHeaders,
            },
          });
        }
      } catch {
        // Fall through to 404
      }
    }

    // SPA fallback - serve index.html for client-side routing
    if (!path.startsWith("/api/")) {
      try {
        const file = Bun.file("/app/apps/web/dist/index.html");
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }
      } catch {
        // Fall through
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  },
});

function getContentType(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

console.log(`[agentqa] Server running on http://localhost:${PORT}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("[agentqa] Shutting down...");
  await testManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[agentqa] Shutting down...");
  await testManager.shutdown();
  process.exit(0);
});