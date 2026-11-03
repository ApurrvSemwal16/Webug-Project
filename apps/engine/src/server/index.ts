/**
 * AgentQA Engine - Main Entry Point
 * Bun HTTP Server with SSE support
 */

import { serve } from "bun";
import { TestManager } from "../test/TestManager";
import { AIProviderFactory, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "../ai/AIProviderFactory";
import { EventCollector } from "../events/EventCollector";
import { IncidentEngine } from "../incidents/IncidentEngine";
import { ReplayManager } from "../replay/ReplayManager";
import { VerificationEngine } from "../verification/VerificationEngine";
import { StorageManager } from "../storage/StorageManager";
import { DEFAULT_LIMITS } from "@agentqa/types";
import { nanoid } from "nanoid";

// Configuration from environment
const PORT = parseInt(process.env.AGENTQA_PORT || "3001");
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
const DEMO_MODE = process.env.DEMO_MODE === "true";
const DEMO_APP_URL = process.env.DEMO_APP_URL || "http://localhost:3000";

// Initialize services
const storage = new StorageManager();
const aiProvider = AIProviderFactory.create(OLLAMA_BASE_URL, OLLAMA_MODEL);
const eventCollector = new EventCollector();
const incidentEngine = new IncidentEngine(storage);
const replayManager = new ReplayManager(storage);
const verificationEngine = new VerificationEngine(storage);

// Wire storage to event collector for persistence
eventCollector.setStorage(storage);

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

// Initialize storage
await storage.initialize();

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
  fetch: async (req) => {
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

    // List all tests
    if (path === "/api/tests" && req.method === "GET") {
      const tests = await storage.listTests();
      return Response.json({ tests }, { headers: corsHeaders });
    }

    // Get test metadata
    if (path.match(/^\/api\/tests\/([^\/]+)$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const test = await storage.getTest(runId);
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
      const events = await storage.getEvents(runId);
      return Response.json({ events }, { headers: corsHeaders });
    }

    // Get test bugs
    if (path.match(/^\/api\/tests\/([^\/]+)\/bugs$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const bugs = await storage.getBugs(runId);
      return Response.json({ bugs }, { headers: corsHeaders });
    }

    // Get replay data
    if (path.match(/^\/api\/tests\/([^\/]+)\/replay$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const replay = await storage.getReplay(runId);
      if (!replay) {
        return Response.json({ error: "Replay not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ replay }, { headers: corsHeaders });
    }

    // SSE event stream
    if (path.match(/^\/api\/tests\/([^\/]+)\/events\/stream$/) && req.method === "GET") {
      const runId = path.split("/")[3];
      const test = await storage.getTest(runId);
      if (!test) {
        return Response.json({ error: "Test not found" }, { status: 404, headers: corsHeaders });
      }

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          let closed = false;

          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch {
              closed = true;
            }
          };

          // Send initial state
          send("test_started", { runId, ...test });

          // Subscribe to test events
          const unsubscribe = testManager.subscribe(runId, (event) => {
            send(event.type, event.data);
          });

          // Handle client disconnect
          req.signal.addEventListener("abort", () => {
            closed = true;
            unsubscribe();
            try { controller.close(); } catch { /* already closed */ }
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
      try {
        const fix = await testManager.generateFix(bugId);
        return Response.json({ fix }, { headers: corsHeaders });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
      }
    }

    // Apply fix for bug
    if (path.match(/^\/api\/bugs\/([^\/]+)\/apply$/) && req.method === "POST") {
      const bugId = path.split("/")[3];
      try {
        const success = await testManager.applyFix(bugId);
        if (success) {
          return Response.json({ success: true }, { headers: corsHeaders });
        } else {
          return Response.json({ error: "Failed to apply fix" }, { status: 500, headers: corsHeaders });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
      }
    }

    // Verify fix
    if (path.match(/^\/api\/tests\/([^\/]+)\/verify$/) && req.method === "POST") {
      const runId = path.split("/")[3];
      try {
        const verification = await testManager.verifyFix(runId);
        return Response.json({ verification }, { headers: corsHeaders });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
      }
    }

    // Serve static frontend files
    if (path === "/" || !path.startsWith("/api/")) {
      let filePath = path === "/" ? "/index.html" : path;
      const candidates = [
        process.env.WEB_DIST_DIR,
        "/app/apps/web/dist",
        require("path").resolve(process.cwd(), "apps/web/dist"),
        require("path").resolve(__dirname, "../../../web/dist"),
        require("path").resolve(__dirname, "../../web/dist"),
      ].filter(Boolean) as string[];
      const distDir = candidates.find(c => require("fs").existsSync(c)) || candidates[0];
      const fullPath = require("path").join(distDir, filePath);

      try {
        const file = Bun.file(fullPath);
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": getContentType(fullPath),
              ...corsHeaders,
            },
          });
        }
      } catch {
        // Fall through to SPA fallback
      }

      // SPA fallback
      try {
        const indexFile = Bun.file(require("path").join(distDir, "index.html"));
        if (await indexFile.exists()) {
          return new Response(indexFile, {
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }
      } catch {
        // Fall through to 404
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  },
});

function getContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".woff2")) return "font/woff2";
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
