# WeBug - Current Implementation State

## Completed Components

- **Event Collection & Verification**: The `VerificationEngine` uses the actual browser's `EventCollector` to reliably record browser events. The deterministic failure signature accurately determines if a bug was fixed by the user, without relying on hallucination-prone AI opinions.
- **Backend Fix Mechanism**: Implemented a controlled backdoor mechanism for the demo application, allowing a safe deterministic way to apply a known fix to the bug without arbitrary filesystem operations. 
- **Replay System**: Uses genuine `rrweb` injection on the target page rather than faked snapshots, creating accurate session replays rendering flawlessly in `rrweb-player`.
- **UI Integrations**: Rebranded the UI from AgentQA to WeBug. The `BugReportPage` now seamlessly features an `Apply Fix to Demo App` button alongside the verification flow.
- **Docker Compose**: Pre-configured setup that launches the main Engine, Web app (served by Bun server), Demo app, and Ollama.

## Important Architecture Decisions

- Kept local JSON storage. No Postgres/MongoDB added, minimizing infrastructure overhead.
- Used Playwright `addScriptTag` and Playwright context evaluations for lightweight custom `rrweb` recording. 
- Maintained a narrow context for the AI: AI has no direct shell access or complete DOM trees, but focuses on structured browser state and interactive element descriptions.

## Known Limitations

- AI exploration is currently best demonstrated on the deterministic Demo App. True web exploration involves unbounded search spaces.
- Local storage can grow quickly if recording long `rrweb` sessions.

## Exact Demo Procedure

1. Open `http://localhost:3001`
2. Click **New Test**. Ensure `Target URL` is `http://demo-app:3000` and goal is testing checkout + SAVE10.
3. Click **Start Test**. The agent will navigate the UI and trigger an intentional HTTP 500.
4. Go to **Bug Report**, review the details, and generate a fix.
5. Watch the replay of the browser session.
6. Click **Apply Fix to Demo App**.
7. Click **Verify Fix**. The browser will rerun the scenario and output **FIX VERIFIED**.
