# WeBug — Autonomous AI Web Application Testing & Bug Investigation Platform

> **Core Principle**: *AI proposes. The browser proves.*

WeBug is a local-first autonomous QA engineering platform. Given a target website URL and a natural-language testing goal, WeBug autonomously explores the web application using Playwright, captures rich multi-modal evidence, correlates disparate error signals into single actionable incidents, investigates root causes using structured AI reasoning, safely generates and applies unified diff patches, and deterministically verifies fixes in fresh browser sessions.

---

## 1. Architecture Overview

WeBug is structured as a TypeScript monorepo managed with **Bun**:

```
WeBug/
├── apps/
│   ├── engine/           # Core QA orchestrator, browser runner, Ollama AI integration & API server (Port 3001)
│   ├── web/              # Premium React + Vite + Tailwind developer dashboard (SPA)
│   └── demo-app/         # Express e-commerce demo application with intentional coupon failure (Port 3000)
├── packages/
│   └── types/            # Shared TypeScript contracts and schemas (@agentqa/types)
├── docker-compose.yml    # Complete containerized multi-service deployment
└── Dockerfile            # Multi-stage production container for Playwright & Engine
```

### Technology Stack
- **Runtime**: [Bun](https://bun.sh) (fast TypeScript/JavaScript runtime & package manager)
- **Browser Automation**: [Playwright](https://playwright.dev) & Chromium with CDP network and console interception
- **AI Model**: [Ollama](https://ollama.com) running `qwen3:1.7b` locally with constrained JSON schema enforcement
- **Session Replay**: [rrweb](https://github.com/rrweb-io/rrweb) DOM mutation recording and interactive timeline scrubbing
- **Frontend**: React 18, Vite, Tailwind CSS, Zustand
- **Storage**: Deterministic JSON persistence with automatic run directory creation

---

## 2. Autonomous Agent Lifecycle

WeBug operates in a closed autonomous feedback loop:

```
   ┌────────────────────────────────────────────────────────┐
   │ 1. GOAL: User inputs URL and natural-language goal     │
   └───────────────────────────┬────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 2. PLAN & ACT: Qwen3 selects browser action            │
   │    (click, type, navigate, scroll, wait, finish)       │
   └───────────────────────────┬────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 3. OBSERVE: Playwright executes action & captures state│
   │    (HTTP 5xx, network errors, console errors, DOM)     │
   └───────────────────────────┬────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 4. CORRELATE: IncidentEngine merges signals into ONE   │
   │    logical incident per underlying root cause           │
   └───────────────────────────┬────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 5. INVESTIGATE: Qwen3 investigates structured context  │
   │    and produces schema-compliant BugReport             │
   └───────────────────────────┬────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 6. PATCH & VERIFY: PatchManager safely applies diff;   │
   │    VerificationEngine tests fix in fresh browser session│
   └────────────────────────────────────────────────────────┘
```

---

## 3. Incident Correlation & Evidence Engine

When a failure occurs (such as an unhandled HTTP 500), web applications emit multiple concurrent signals:
1. `network_response`: HTTP status 500
2. `network_error`: `net::ERR_HTTP_RESPONSE_CODE_FAILURE`
3. `console_error`: `Failed to load resource: the server responded with a status of 500`

WeBug's `IncidentEngine` normalizes endpoint paths (e.g. `/api/coupon`) and correlates temporal errors occurring within 5 seconds into **one single logical incident**. This prevents redundant duplicate model queries while preserving every piece of raw browser evidence.

---

## 4. Local Installation & Native Setup (Fedora / Linux)

### Prerequisites
1. **Bun** (>= 1.2.0):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   source ~/.bashrc
   ```
2. **Playwright Chromium**:
   ```bash
   bun x playwright install chromium
   ```
3. **Ollama & Qwen3:1.7b**:
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull qwen3:1.7b
   ollama run qwen3:1.7b "" # verifies model loads
   ```

### Running WeBug Locally

1. **Install Dependencies**:
   ```bash
   cd /home/redpanda/Documents/WeBug
   bun install
   ```

2. **Start the Demo Application (Terminal 1)**:
   ```bash
   cd apps/demo-app
   node src/server.js
   # Running on http://localhost:3000
   ```

3. **Build the Frontend & Start the Engine (Terminal 2)**:
   ```bash
   cd apps/web && bun run build
   cd ../engine && bun run src/server/index.ts
   # Engine & Frontend running on http://localhost:3001
   ```

4. **Access the Web Dashboard**:
   Open your browser to: `http://localhost:3001`

---

## 5. Docker Deployment

WeBug includes a multi-service Docker configuration supporting containerized Playwright, Ollama, and the demo application.

```bash
# Start all services
docker compose up --build
```

> **Note on Host Ollama**: If Ollama is running on your host machine rather than inside a Docker container, `docker-compose.yml` automatically configures `host.docker.internal:host-gateway`. Simply set `OLLAMA_BASE_URL=http://host.docker.internal:11434` in the environment.

---

## 6. Environment Variables Reference

| Variable | Default Value | Description |
|---|---|---|
| `AGENTQA_PORT` | `3001` | Port for the Engine API server and frontend SPA |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | URL of the Ollama service |
| `OLLAMA_MODEL` | `qwen3:1.7b` | Model identifier used for planning, reasoning, and patches |
| `OLLAMA_TIMEOUT` | `60000` | Timeout in ms for Ollama inference calls (60s) |
| `DEMO_MODE` | `true` | Enables deterministic demo flow for standard checkout benchmarks |
| `DEMO_APP_URL` | `http://localhost:3000` | Target URL for the built-in demo application |
| `AGENTQA_STORAGE_DIR` | `.agentqa/runs` | Filesystem directory for persistent test runs, replays, and bugs |
| `AUTHORIZED_WORKSPACE` | Project root | Permitted filesystem directory boundary for safe patch application |

---

## 7. API Reference

### Tests
- `POST /api/tests`: Create and launch a QA test run.
  - Body: `{ url: string, goal: string, demoMode?: boolean }`
- `GET /api/tests`: List all historical test runs.
- `GET /api/tests/:runId`: Retrieve metadata and current status for a test run.
- `POST /api/tests/:runId/stop`: Abort an active test execution.
- `GET /api/tests/:runId/events/stream`: Server-Sent Events (SSE) live stream of browser events.
- `GET /api/tests/:runId/events`: Retrieve all captured browser events.
- `GET /api/tests/:runId/bugs`: Retrieve investigated bug reports.
- `GET /api/tests/:runId/replay`: Retrieve rrweb DOM replay payload.

### Fixes & Verification
- `POST /api/bugs/:bugId/fix`: Request AI unified diff patch generation.
- `POST /api/bugs/:bugId/apply`: Apply approved code fix to authorized workspace.
- `POST /api/tests/:runId/verify`: Launch fresh browser session to verify whether the defect was resolved.

---

## 8. Test Suite Execution

WeBug includes a multi-tiered test suite:

### 1. Unit Tests (23 tests)
Validates patch safety, path traversal prevention, SSRF protection, action validation, loop detection, and failure signature comparison:
```bash
bun test apps/engine/tests/unit/
```

### 2. Coupon Regression Tests (12 tests)
Validates demo application discount calculations and failure behavior before and after patch:
```bash
bun test apps/demo-app/tests/coupon.test.js
```

### 3. Real Ollama Integration Tests (5 tests)
Directly queries the local `qwen3:1.7b` model with JSON schema enforcement:
```bash
bun test apps/engine/tests/ollama_integration.test.ts
```

### 4. End-to-End Demo Verification (1 test)
Executes initial test, reproduces SAVE10 failure, captures evidence, investigates with AI, applies patch, reruns test in fresh browser, and verifies fix:
```bash
bun test apps/engine/tests/demo_e2e.test.ts
```

### 5. Autonomous AI Exploration (1 test)
Exercises genuine autonomous agent action selection with `demoMode: false`:
```bash
bun test apps/engine/tests/autonomous_e2e.test.ts
```

---

## 9. Security Model & Target Policy

- **Workspace Sandboxing**: The `PatchManager` strictly restricts file modifications to `AUTHORIZED_WORKSPACE` and rejects path traversal (`..`), null bytes, and arbitrary filesystem access.
- **SSRF Safeguards**: The `TargetPolicy` blocks access to cloud metadata services (e.g. `169.254.169.254`, `metadata.google.internal`) and restricts protocols to HTTP/HTTPS.
- **Deterministic Verification**: Fix status is determined solely by actual browser evidence in a fresh session, never by AI opinion.
