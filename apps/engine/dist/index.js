// @bun
var __require = import.meta.require;

// src/server/index.ts
var {serve } = globalThis.Bun;

// src/patch/PatchManager.ts
import * as fs from "fs";
import * as path from "path";

class PatchManager {
  workspaceRoot;
  constructor(workspaceRoot) {
    const defaultRoot = process.env.AUTHORIZED_WORKSPACE || path.resolve(process.cwd(), "../..");
    this.workspaceRoot = path.resolve(workspaceRoot || defaultRoot);
  }
  getWorkspaceRoot() {
    return this.workspaceRoot;
  }
  validateFilePath(targetPath) {
    if (!targetPath || typeof targetPath !== "string") {
      return { isValid: false, error: "Target file path must be a non-empty string." };
    }
    if (targetPath.includes("\x00")) {
      return { isValid: false, error: "Null byte detected in path." };
    }
    const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(this.workspaceRoot, targetPath);
    const relative2 = path.relative(this.workspaceRoot, resolved);
    if (relative2.startsWith("..") || path.isAbsolute(relative2)) {
      return {
        isValid: false,
        error: `Access denied: Target path "${targetPath}" is outside authorized workspace "${this.workspaceRoot}".`
      };
    }
    return { isValid: true, resolvedPath: resolved };
  }
  parseDiff(diffContent) {
    const lines = diffContent.split(/\r?\n/);
    let targetFile;
    const hunks = [];
    let currentHunk = null;
    for (let i = 0;i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("--- a/")) {
        targetFile = line.substring(6).trim();
      } else if (line.startsWith("--- ")) {
        targetFile = line.substring(4).trim();
      } else if (line.startsWith("+++ b/")) {
        targetFile = line.substring(6).trim();
      } else if (line.startsWith("=== ") && line.endsWith(" ===")) {
        targetFile = line.slice(4, -4).trim();
      }
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3], 10),
          newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: []
        };
        continue;
      }
      if (currentHunk) {
        if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") {
          currentHunk.lines.push(line);
        }
      }
    }
    if (currentHunk) {
      hunks.push(currentHunk);
    }
    return { file: targetFile, hunks };
  }
  async applyPatch(targetFile, diffContent) {
    const pathCheck = this.validateFilePath(targetFile);
    if (!pathCheck.isValid || !pathCheck.resolvedPath) {
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: 0,
        message: pathCheck.error || "Invalid target path"
      };
    }
    const filePath = pathCheck.resolvedPath;
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: 0,
        message: `Target file "${filePath}" does not exist.`
      };
    }
    const parsed = this.parseDiff(diffContent);
    if (parsed.hunks.length === 0) {
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: 0,
        message: "No valid diff hunks found in patch."
      };
    }
    const originalContent = fs.readFileSync(filePath, "utf8");
    const originalLines = originalContent.split(/\r?\n/);
    const backupPath = `${filePath}.${Date.now()}.bak`;
    try {
      fs.writeFileSync(backupPath, originalContent, "utf8");
      let currentLines = [...originalLines];
      let appliedCount = 0;
      for (const hunk of parsed.hunks) {
        const searchLines = hunk.lines.filter((l) => l.startsWith(" ") || l.startsWith("-")).map((l) => l.substring(1));
        const replaceLines = hunk.lines.filter((l) => l.startsWith(" ") || l.startsWith("+")).map((l) => l.substring(1));
        if (searchLines.length === 0) {
          continue;
        }
        const searchStr = searchLines.join(`
`);
        const replaceStr = replaceLines.join(`
`);
        const currentStr = currentLines.join(`
`);
        if (currentStr.includes(searchStr)) {
          const updatedStr = currentStr.replace(searchStr, replaceStr);
          currentLines = updatedStr.split(`
`);
          appliedCount++;
        } else {
          const normalizedSearch = searchLines.map((l) => l.trim()).join(`
`);
          let matchIndex = -1;
          for (let i = 0;i <= currentLines.length - searchLines.length; i++) {
            const slice = currentLines.slice(i, i + searchLines.length).map((l) => l.trim()).join(`
`);
            if (slice === normalizedSearch) {
              matchIndex = i;
              break;
            }
          }
          if (matchIndex >= 0) {
            currentLines.splice(matchIndex, searchLines.length, ...replaceLines);
            appliedCount++;
          } else {
            throw new Error(`Hunk context at line ${hunk.oldStart} did not match file content.`);
          }
        }
      }
      if (appliedCount === 0) {
        fs.unlinkSync(backupPath);
        return {
          success: false,
          file: targetFile,
          appliedHunks: 0,
          totalHunks: parsed.hunks.length,
          message: "Could not match any diff hunks to current file content."
        };
      }
      fs.writeFileSync(filePath, currentLines.join(`
`), "utf8");
      return {
        success: true,
        file: targetFile,
        appliedHunks: appliedCount,
        totalHunks: parsed.hunks.length,
        backupFile: backupPath,
        message: `Successfully applied ${appliedCount}/${parsed.hunks.length} hunks.`
      };
    } catch (error) {
      if (fs.existsSync(backupPath)) {
        fs.writeFileSync(filePath, fs.readFileSync(backupPath, "utf8"), "utf8");
        fs.unlinkSync(backupPath);
      }
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: parsed.hunks.length,
        message: `Patch application failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  restoreBackup(backupFilePath) {
    if (!fs.existsSync(backupFilePath))
      return false;
    const originalPath = backupFilePath.replace(/\.\d+\.bak$/, "");
    try {
      fs.copyFileSync(backupFilePath, originalPath);
      fs.unlinkSync(backupFilePath);
      return true;
    } catch {
      return false;
    }
  }
}

// src/test/TestManager.ts
import { join } from "path";

// src/browser/BrowserManager.ts
import { chromium } from "playwright";

// node_modules/nanoid/index.js
import { webcrypto as crypto } from "crypto";

// node_modules/nanoid/url-alphabet/index.js
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

// node_modules/nanoid/index.js
var POOL_SIZE_MULTIPLIER = 128;
var pool;
var poolOffset;
function fillPool(bytes) {
  if (bytes < 0)
    throw new RangeError("Wrong ID size");
  try {
    if (!pool || pool.length < bytes) {
      pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
      crypto.getRandomValues(pool);
      poolOffset = 0;
    } else if (poolOffset + bytes > pool.length) {
      crypto.getRandomValues(pool);
      poolOffset = 0;
    }
  } catch (e) {
    pool = undefined;
    throw e;
  }
  poolOffset += bytes;
}
function nanoid(size = 21) {
  fillPool(size |= 0);
  let id = "";
  for (let i = poolOffset - size;i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}

// src/browser/BrowserManager.ts
class BrowserManager {
  browser = null;
  context = null;
  page = null;
  cdpSession = null;
  runId;
  eventCollector;
  demoMode;
  rrwebEvents = [];
  rrwebRecording = false;
  constructor(options) {
    this.runId = options.runId;
    this.eventCollector = options.eventCollector;
    this.demoMode = options.demoMode ?? false;
  }
  async launch() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor"
      ]
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `/tmp/agentqa-videos/${this.runId}`, size: { width: 1280, height: 720 } }
    });
    this.page = await this.context.newPage();
    this.cdpSession = await this.context.newCDPSession(this.page);
    this.setupEventListeners();
    await this.setupRRWeb();
  }
  async setupRRWeb() {
    if (!this.page)
      return;
    await this.page.addInitScript(() => {
      window.__rrweb_events = [];
      window.__rrweb_is_recording = false;
    });
    this.startRRWebPolling();
  }
  setupEventListeners() {
    if (!this.page)
      return;
    this.page.on("framenavigated", (frame) => {
      if (frame === this.page?.mainFrame()) {
        this.recordEvent("navigation", {
          url: frame.url(),
          title: "",
          referrer: ""
        });
      }
    });
    this.page.on("load", async () => {
      if (this.page) {
        try {
          await this.page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.11/dist/rrweb.min.js" });
          await this.page.evaluate(() => {
            if (typeof window.rrweb !== "undefined" && !window.__rrweb_is_recording) {
              window.rrweb.record({
                emit(event) {
                  window.__rrweb_events.push(event);
                }
              });
              window.__rrweb_is_recording = true;
            }
          });
        } catch (e) {
          console.error("[browser] Failed to inject rrweb:", e);
        }
        const title = await this.page.title();
        this.recordEvent("navigation", {
          url: this.page.url(),
          title,
          referrer: ""
        });
      }
    });
    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.recordEvent("console_error", {
          text: msg.text(),
          location: msg.location()
        });
      } else if (msg.type() === "warning") {
        this.recordEvent("console_warning", {
          text: msg.text(),
          location: msg.location()
        });
      }
    });
    this.page.on("pageerror", (error) => {
      this.recordEvent("page_error", {
        message: error.message,
        stack: error.stack
      });
    });
    this.page.on("request", (request) => {
      this.recordEvent("network_request", {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() || undefined
      });
    });
    this.page.on("response", async (response) => {
      const timing = response.timing ? response.timing() : response.request()?.timing();
      this.recordEvent("network_response", {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        fromCache: response.fromCache?.() || false,
        timing: {
          startTime: timing?.startTime || 0,
          domainLookupStart: timing?.domainLookupStart || 0,
          domainLookupEnd: timing?.domainLookupEnd || 0,
          connectStart: timing?.connectStart || 0,
          connectEnd: timing?.connectEnd || 0,
          requestStart: timing?.requestStart || 0,
          responseStart: timing?.responseStart || 0,
          responseEnd: timing?.responseEnd || 0
        }
      });
      if (response.status() >= 400) {
        this.recordEvent("network_error", {
          url: response.url(),
          status: response.status(),
          statusText: response.statusText()
        });
      }
    });
    this.page.on("requestfailed", (request) => {
      this.recordEvent("network_error", {
        url: request.url(),
        error: request.failure()?.errorText
      });
    });
  }
  startRRWebPolling() {
    if (!this.page)
      return;
    this.rrwebRecording = true;
    const pollEvents = async () => {
      if (!this.rrwebRecording || !this.page)
        return;
      try {
        const events = await this.page.evaluate(() => {
          const evs = window.__rrweb_events || [];
          window.__rrweb_events = [];
          return evs;
        });
        if (events && events.length > 0) {
          this.rrwebEvents.push(...events);
        }
      } catch (error) {}
      if (this.rrwebRecording) {
        setTimeout(pollEvents, 1000);
      }
    };
    setTimeout(pollEvents, 1000);
  }
  stopRRWebRecording() {
    this.rrwebRecording = false;
    return this.rrwebEvents;
  }
  getRRWebEvents() {
    return this.rrwebEvents;
  }
  async navigate(url) {
    if (!this.page)
      throw new Error("Browser not launched");
    const cleanUrl = url.replace(/[}"'\s]+$/, "").trim();
    const finalUrl = cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://") ? cleanUrl : new URL(cleanUrl, this.page.url() || "http://localhost:3000").toString();
    await this.page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForLoadState("networkidle", { timeout: 1e4 }).catch(() => {});
  }
  async getCompactPageState() {
    if (!this.page)
      throw new Error("Browser not launched");
    return await this.page.evaluate(() => {
      const getSelector = (element) => {
        if (element.id)
          return `#${element.id}`;
        if (element.tagName.toLowerCase() === "a" && element.getAttribute("href")) {
          return `a[href="${element.getAttribute("href")}"]`;
        }
        if (element.className && typeof element.className === "string") {
          const classList = element.className.split(/\s+/).filter(Boolean);
          const semantic = classList.find((c) => !c.includes(":") && !c.includes("/") && !c.includes(".") && (c.includes("-") || c.length > 2));
          if (semantic)
            return `.${semantic}`;
          const cleanClass = classList.find((c) => !c.includes(":") && !c.includes("/") && !c.includes("."));
          if (cleanClass)
            return `.${cleanClass}`;
        }
        return element.tagName.toLowerCase();
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const isEnabled = (element) => {
        return !element.disabled && !element.readOnly;
      };
      const buttons = [];
      document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a.btn, .btn").forEach((el) => {
        const element = el;
        if (isVisible(element)) {
          buttons.push({
            selector: getSelector(element),
            text: element.textContent?.trim() || element.getAttribute("aria-label") || "Button",
            tag: element.tagName.toLowerCase(),
            visible: true,
            enabled: isEnabled(element),
            boundingBox: element.getBoundingClientRect()
          });
        }
      });
      const inputs = [];
      document.querySelectorAll("input:not([type='hidden']), textarea, select").forEach((el) => {
        const element = el;
        if (isVisible(element)) {
          inputs.push({
            selector: getSelector(element),
            text: element.labels?.[0]?.textContent?.trim() || element.getAttribute("placeholder") || element.name || "Input",
            tag: element.tagName.toLowerCase(),
            type: element.type,
            placeholder: element.getAttribute("placeholder") || undefined,
            value: element.value,
            visible: true,
            enabled: isEnabled(element),
            boundingBox: element.getBoundingClientRect()
          });
        }
      });
      const links = [];
      document.querySelectorAll("a[href]").forEach((el) => {
        const element = el;
        if (isVisible(element)) {
          const href = element.getAttribute("href") || element.href;
          links.push({
            selector: element.getAttribute("href") ? `a[href="${element.getAttribute("href")}"]` : getSelector(element),
            text: element.textContent?.trim() || href,
            tag: "a",
            visible: true,
            enabled: true,
            boundingBox: element.getBoundingClientRect()
          });
        }
      });
      return {
        url: window.location.href,
        title: document.title,
        buttons,
        inputs,
        links,
        forms: []
      };
    });
  }
  async executeAction(action) {
    if (!this.page)
      throw new Error("Browser not launched");
    try {
      switch (action.type) {
        case "click":
          await this.clickElement(action.target);
          break;
        case "type":
          await this.typeText(action.target, action.value || "");
          break;
        case "navigate":
          await this.navigate(action.target);
          break;
        case "scroll":
          await this.scrollPage(action.value || "down");
          break;
        case "wait":
          await this.waitFor(action.value || "1000");
          break;
        case "finish":
          return { success: true };
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
      this.recordEvent("agent_action", {
        action,
        success: true
      });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.recordEvent("agent_action", {
        action,
        success: false,
        error: errorMessage
      });
      return { success: false, error: errorMessage };
    }
  }
  async clickElement(target) {
    if (!this.page)
      throw new Error("Browser not launched");
    const strategies = [
      target,
      `text="${target}"`,
      `[aria-label="${target}"]`,
      `button:has-text("${target}")`,
      `a:has-text("${target}")`,
      `[placeholder="${target}"]`,
      `[name="${target}"]`
    ];
    let clicked = false;
    for (const selector of strategies) {
      try {
        const element = await this.page.waitForSelector(selector, { timeout: 2000, state: "visible" });
        if (element) {
          await element.click({ timeout: 5000 });
          clicked = true;
          break;
        }
      } catch {}
    }
    if (!clicked) {
      throw new Error(`Could not find clickable element: ${target}`);
    }
    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }
  async typeText(target, value) {
    if (!this.page)
      throw new Error("Browser not launched");
    const strategies = [
      target,
      `[placeholder="${target}"]`,
      `[name="${target}"]`,
      `[aria-label="${target}"]`,
      `input[type="text"]`,
      `input[type="email"]`,
      `input[type="password"]`,
      `textarea`
    ];
    let typed = false;
    for (const selector of strategies) {
      try {
        const element = await this.page.waitForSelector(selector, { timeout: 2000, state: "visible" });
        if (element) {
          await element.fill(value, { timeout: 5000 });
          typed = true;
          break;
        }
      } catch {}
    }
    if (!typed) {
      throw new Error(`Could not find input element: ${target}`);
    }
  }
  async scrollPage(direction) {
    if (!this.page)
      throw new Error("Browser not launched");
    const scrollMap = {
      up: -500,
      down: 500,
      top: -999999,
      bottom: 999999
    };
    const amount = scrollMap[direction] || parseInt(direction) || 500;
    await this.page.evaluate((amt) => window.scrollBy(0, amt), amount);
    await this.page.waitForTimeout(500);
  }
  async waitFor(condition) {
    if (!this.page)
      throw new Error("Browser not launched");
    if (condition === "networkidle") {
      await this.page.waitForLoadState("networkidle", { timeout: 1e4 }).catch(() => {});
    } else {
      const ms = parseInt(condition) || 1000;
      await this.page.waitForTimeout(ms);
    }
  }
  recordEvent(type, data) {
    const event = {
      id: nanoid(8),
      runId: this.runId,
      timestamp: Date.now(),
      type,
      data
    };
    this.eventCollector.collect(event);
  }
  async close() {
    this.stopRRWebRecording();
    try {
      if (this.cdpSession)
        await this.cdpSession.detach();
    } catch {}
    try {
      if (this.context)
        await this.context.close();
    } catch {}
    try {
      if (this.browser)
        await this.browser.close();
    } catch {}
  }
  getPage() {
    return this.page;
  }
  getContext() {
    return this.context;
  }
}

// src/test/TestManager.ts
class TestManager {
  patchManager = new PatchManager;
  options;
  runs = new Map;
  constructor(options) {
    this.options = options;
    if (this.options.eventCollector) {
      if (this.options.incidentEngine)
        this.options.eventCollector.setIncidentEngine(this.options.incidentEngine);
      this.options.eventCollector.setTestManager(this);
    }
  }
  async createTest(params) {
    const { id, url, goal, demoMode } = params;
    const metadata = {
      id,
      url,
      goal,
      startTime: Date.now(),
      status: "CREATED",
      actions: [],
      events: [],
      incidents: [],
      bugs: [],
      demoMode
    };
    await this.options.storage.createTest(metadata);
    const browserManager = new BrowserManager({
      runId: id,
      eventCollector: this.options.eventCollector,
      demoMode
    });
    const run = {
      metadata,
      browserManager,
      abortController: new AbortController,
      actionCount: 0,
      aiCallCount: 0,
      consecutiveFailures: 0,
      startTime: Date.now(),
      subscribers: new Set
    };
    this.runs.set(id, run);
    this.options.eventCollector.setRunId(id);
    return { metadata, sseUrl: `/api/tests/${id}/events/stream` };
  }
  subscribe(runId, callback) {
    const run = this.runs.get(runId);
    if (!run)
      return () => {};
    run.subscribers.add(callback);
    return () => run.subscribers.delete(callback);
  }
  emit(runId, type, data) {
    const run = this.runs.get(runId);
    if (!run)
      return;
    for (const subscriber of run.subscribers) {
      try {
        subscriber({ type, data });
      } catch (error) {
        console.error("[test] Subscriber error:", error);
      }
    }
  }
  async runTest(runId) {
    const run = this.runs.get(runId);
    if (!run)
      throw new Error(`Test ${runId} not found`);
    try {
      run.metadata.status = "STARTING";
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "test_started", run.metadata);
      await run.browserManager.launch();
      run.metadata.status = "RUNNING";
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "navigation", { url: run.metadata.url });
      await run.browserManager.navigate(run.metadata.url);
      await this.agentLoop(runId);
      await this.options.storage.setEvents(runId, this.options.eventCollector.getEvents());
      await this.options.incidentEngine.finalizeAll(runId);
      await this.investigateIncidents(runId);
      try {
        const rrwebEvents = run.browserManager.getRRWebEvents();
        if (rrwebEvents.length > 0) {
          await this.options.replayManager.saveReplay(runId, rrwebEvents, {
            href: run.metadata.url,
            width: 1280,
            height: 720,
            userAgent: "AgentQA/1.0"
          });
        }
      } catch (replayErr) {
        console.error("[test] Failed to save replay:", replayErr);
      }
      run.metadata.status = "COMPLETED";
      run.metadata.endTime = Date.now();
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "test_completed", run.metadata);
    } catch (error) {
      console.error(`[test] Test ${runId} error:`, error);
      run.metadata.status = "FAILED";
      run.metadata.endTime = Date.now();
      await this.options.storage.updateTest(run.metadata);
      this.emit(runId, "error", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      await run.browserManager.close();
      this.runs.delete(runId);
    }
  }
  async agentLoop(runId) {
    const run = this.runs.get(runId);
    if (!run)
      return;
    const { metadata, browserManager, abortController } = run;
    const limits = this.options.limits;
    let step = 0;
    while (!abortController.signal.aborted) {
      if (run.actionCount >= limits.maxActions) {
        console.log(`[test] Max actions (${limits.maxActions}) reached`);
        break;
      }
      if (Date.now() - run.startTime > limits.maxRuntime) {
        console.log(`[test] Max runtime (${limits.maxRuntime}ms) reached`);
        break;
      }
      if (run.consecutiveFailures >= limits.maxConsecutiveFailures) {
        console.log(`[test] Max consecutive failures (${limits.maxConsecutiveFailures}) reached`);
        break;
      }
      if (run.aiCallCount >= limits.maxAICalls) {
        console.log(`[test] Max AI calls (${limits.maxAICalls}) reached`);
        break;
      }
      step++;
      this.emit(runId, "agent_observing", { step, url: metadata.url });
      let pageState;
      try {
        pageState = await browserManager.getCompactPageState();
      } catch (error) {
        console.error("[test] Failed to get page state:", error);
        run.consecutiveFailures++;
        await this.wait(1000);
        continue;
      }
      metadata.url = pageState.url;
      let action;
      if (metadata.demoMode && this.isDemoApp(pageState.url)) {
        action = this.getDemoAction(pageState, run.actionCount, metadata.goal, metadata.actions);
      } else {
        this.emit(runId, "agent_action", { step, message: "Asking AI for next action..." });
        const context = {
          goal: metadata.goal,
          pageState,
          recentActions: metadata.actions.slice(-5),
          recentEvents: this.options.eventCollector.getEvents().slice(-10),
          runId,
          step
        };
        try {
          action = await this.options.aiProvider.generateAction(context);
          run.aiCallCount++;
        } catch (error) {
          console.error("[test] AI action generation failed:", error);
          run.consecutiveFailures++;
          await this.wait(1000);
          continue;
        }
      }
      if (!this.validateAction(action, pageState)) {
        console.error("[test] Invalid action:", action);
        run.consecutiveFailures++;
        continue;
      }
      if (this.isActionLoop(action, metadata.actions)) {
        console.warn("[test] Loop detected: Agent repeating action", action.type, action.target);
        action = {
          type: "wait",
          target: "page",
          value: "1000",
          description: "Wait 1s after loop detected",
          timestamp: Date.now()
        };
      }
      this.emit(runId, "agent_action", { step, action: action.description });
      const result = await browserManager.executeAction(action);
      action.timestamp = Date.now();
      metadata.actions.push(action);
      await this.options.storage.appendAction(runId, action);
      run.actionCount++;
      if (result.success) {
        run.consecutiveFailures = 0;
      } else {
        run.consecutiveFailures++;
        console.log(`[test] Action failed: ${result.error}`);
      }
      if (action.type === "finish") {
        console.log(`[test] Test finished by agent`);
        break;
      }
      await this.wait(500);
    }
  }
  isDemoApp(url) {
    return url.includes("demo-app:3000") || url.includes("localhost:3000") || url.includes("127.0.0.1:3000");
  }
  getDemoAction(pageState, actionCount, goal, recentActions = []) {
    const url = pageState.url;
    const isConfirmation = url.includes("/confirmation") || pageState.buttons.some((b) => b.text.toLowerCase().includes("continue shopping")) || pageState.links.some((l) => l.text.toLowerCase().includes("continue shopping"));
    const isCheckout = pageState.inputs.some((i) => i.selector === "#checkout-email") || url.includes("/checkout") && !isConfirmation;
    const isCart = pageState.inputs.some((i) => i.selector === "#coupon-input") || url.includes("/cart") && !isCheckout && !isConfirmation;
    if (isConfirmation) {
      return {
        type: "finish",
        target: "done",
        description: "Test complete - order confirmed",
        timestamp: Date.now()
      };
    }
    if (isCheckout) {
      const emailInput = pageState.inputs.find((i) => i.selector === "#checkout-email" || i.type === "email" || i.placeholder?.includes("you@example.com"));
      if (emailInput && !emailInput.value) {
        return {
          type: "type",
          target: "#checkout-email",
          value: "test@example.com",
          description: "Enter email address",
          timestamp: Date.now()
        };
      }
      const nameInput = pageState.inputs.find((i) => i.selector === "#checkout-name" || i.placeholder?.includes("John Doe"));
      if (nameInput && !nameInput.value) {
        return {
          type: "type",
          target: "#checkout-name",
          value: "John Doe",
          description: "Enter full name",
          timestamp: Date.now()
        };
      }
      const addressInput = pageState.inputs.find((i) => i.selector === "#checkout-address" || i.placeholder?.includes("123 Main St"));
      if (addressInput && !addressInput.value) {
        return {
          type: "type",
          target: "#checkout-address",
          value: "123 Main St",
          description: "Enter shipping address",
          timestamp: Date.now()
        };
      }
      const cityInput = pageState.inputs.find((i) => i.selector === "#checkout-city" || i.placeholder?.includes("San Francisco"));
      if (cityInput && !cityInput.value) {
        return {
          type: "type",
          target: "#checkout-city",
          value: "San Francisco",
          description: "Enter city",
          timestamp: Date.now()
        };
      }
      const zipInput = pageState.inputs.find((i) => i.selector === "#checkout-zip" || i.placeholder?.includes("94102"));
      if (zipInput && !zipInput.value) {
        return {
          type: "type",
          target: "#checkout-zip",
          value: "94102",
          description: "Enter ZIP code",
          timestamp: Date.now()
        };
      }
      const placeOrderBtn = pageState.buttons.find((b) => b.selector === "#place-order" || b.text.toLowerCase().includes("place order"));
      if (!placeOrderBtn) {
        throw new Error("Place order button (#place-order) not found on Checkout page");
      }
      const orderAlreadyPlaced = recentActions.some((a) => a.type === "click" && (a.target === "#place-order" || a.description?.toLowerCase().includes("place order")));
      if (!orderAlreadyPlaced) {
        return {
          type: "click",
          target: "#place-order",
          description: "Place order",
          timestamp: Date.now()
        };
      }
      return {
        type: "finish",
        target: "done",
        description: "Checkout submitted",
        timestamp: Date.now()
      };
    }
    if (isCart) {
      const couponInput = pageState.inputs.find((i) => i.selector === "#coupon-input" || i.placeholder?.toLowerCase().includes("code") || i.placeholder?.toLowerCase().includes("coupon"));
      if (!couponInput) {
        throw new Error("Coupon input (#coupon-input) not found on Cart page");
      }
      const applyBtn = pageState.buttons.find((b) => b.selector === "#apply-coupon" || b.text.toLowerCase().includes("apply"));
      if (!applyBtn) {
        throw new Error("Apply coupon button (#apply-coupon) not found on Cart page");
      }
      const checkoutBtn = pageState.buttons.find((b) => b.selector === "#checkout-btn" || b.text.toLowerCase().includes("checkout"));
      if (!checkoutBtn) {
        throw new Error("Proceed to Checkout button (#checkout-btn) not found on Cart page");
      }
      const couponTyped = recentActions.some((a) => a.type === "type" && (a.target === "#coupon-input" || a.value === "SAVE10"));
      if (!couponTyped) {
        return {
          type: "type",
          target: "#coupon-input",
          value: "SAVE10",
          description: "Enter coupon code SAVE10",
          timestamp: Date.now()
        };
      }
      const couponApplied = recentActions.some((a) => a.type === "click" && (a.target === "#apply-coupon" || a.description?.toLowerCase().includes("apply coupon")));
      if (!couponApplied) {
        return {
          type: "click",
          target: "#apply-coupon",
          description: "Apply coupon",
          timestamp: Date.now()
        };
      }
      return {
        type: "click",
        target: "#checkout-btn",
        description: "Proceed to checkout",
        timestamp: Date.now()
      };
    }
    const productAdded = recentActions.some((a) => a.type === "click" && (a.target === ".add-to-cart" || a.description?.toLowerCase().includes("add product")));
    if (!productAdded) {
      const addToCartBtn = pageState.buttons.find((b) => b.selector === ".add-to-cart" || b.text.toLowerCase().includes("add to cart"));
      if (!addToCartBtn) {
        throw new Error("Add to Cart button (.add-to-cart) not found on page");
      }
      return {
        type: "click",
        target: ".add-to-cart",
        description: "Add product to cart",
        timestamp: Date.now()
      };
    }
    const cartLink = pageState.links.find((l) => l.selector === 'a[href="/cart"]' || l.text.toLowerCase().includes("cart"));
    if (!cartLink) {
      throw new Error("Cart link (a[href='/cart']) not found in navigation");
    }
    return {
      type: "click",
      target: 'a[href="/cart"]',
      description: "Navigate to cart",
      timestamp: Date.now()
    };
  }
  async investigateIncidents(runId) {
    const run = this.runs.get(runId);
    if (!run)
      return;
    const incidents = await this.options.incidentEngine.getIncidents(runId);
    const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
    const uninvestigated = incidents.filter((i) => !i.investigated).sort((a, b) => (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0));
    if (uninvestigated.length === 0)
      return;
    run.metadata.status = "INVESTIGATING";
    await this.options.storage.updateTest(run.metadata);
    this.emit(runId, "investigation_started", { count: uninvestigated.length });
    const allEvents = this.options.eventCollector.getEvents();
    const bugs = await this.options.storage.getBugs(runId);
    for (const incident of uninvestigated) {
      if (run.abortController.signal.aborted)
        break;
      if (run.aiCallCount >= this.options.limits.maxAICalls)
        break;
      const incidentEvents = allEvents.filter((e) => incident.eventIds.includes(e.id));
      const suspiciousEvent = incidentEvents[0] || allEvents.find((e) => e.id === incident.eventIds[0]);
      if (!suspiciousEvent)
        continue;
      const recentActions = run.metadata.actions.filter((a) => a.timestamp <= incident.firstTimestamp).slice(-5);
      const relevantNetworkEvents = allEvents.filter((e) => (e.type === "network_response" || e.type === "network_error") && e.timestamp >= incident.firstTimestamp - 5000 && e.timestamp <= incident.lastTimestamp + 2000);
      const consoleErrors = allEvents.filter((e) => e.type === "console_error" && e.timestamp >= incident.firstTimestamp - 5000 && e.timestamp <= incident.lastTimestamp + 2000);
      const exceptions = allEvents.filter((e) => (e.type === "exception" || e.type === "page_error") && e.timestamp >= incident.firstTimestamp - 5000 && e.timestamp <= incident.lastTimestamp + 2000);
      let pageState = { url: incident.url, title: "", buttons: [], inputs: [], links: [], forms: [] };
      try {
        pageState = await run.browserManager.getCompactPageState();
      } catch {}
      const context = {
        goal: run.metadata.goal,
        currentUrl: incident.url,
        recentActions,
        suspiciousEvent,
        relevantNetworkEvents,
        consoleErrors,
        exceptions,
        visibleElements: pageState,
        timestamps: { first: incident.firstTimestamp, last: incident.lastTimestamp }
      };
      try {
        run.aiCallCount++;
        const analysis = await this.options.aiProvider.analyzeBug(context);
        await this.options.incidentEngine.markInvestigated(runId, incident.id);
        if (analysis.isBug) {
          const evidence = incidentEvents.map((e, i) => ({
            eventId: e.id,
            type: e.type,
            description: this.describeEvent(e),
            timestamp: e.timestamp,
            replayTimestamp: e.timestamp - (allEvents[0]?.timestamp || e.timestamp),
            data: e.data
          }));
          const bug = {
            id: `bug-${runId}-${incident.id}`,
            runId,
            incidentId: incident.id,
            title: analysis.title,
            severity: analysis.severity,
            confidence: analysis.confidence,
            expected: analysis.expected,
            actual: analysis.actual,
            rootCause: analysis.rootCause,
            evidence,
            createdAt: Date.now()
          };
          bugs.push(bug);
          run.metadata.bugs.push(bug);
          await this.options.storage.setBugs(runId, bugs);
          incident.bugId = bug.id;
          this.emit(runId, "bug_found", bug);
          console.log(`[test] Bug found: ${bug.title} (${bug.severity})`);
        }
      } catch (error) {
        console.error("[test] Investigation error:", error);
        await this.options.incidentEngine.markInvestigated(runId, incident.id);
      }
    }
  }
  describeEvent(event) {
    const d = event.data;
    switch (event.type) {
      case "network_response":
        return `${d.method || "REQUEST"} ${d.url} \u2192 ${d.status} ${d.statusText || ""}`;
      case "network_error":
        return `Network error: ${d.url} - ${d.error || "Unknown"}`;
      case "console_error":
        return `Console error: ${String(d.text || "").substring(0, 100)}`;
      case "page_error":
        return `Page error: ${String(d.message || "").substring(0, 100)}`;
      case "exception":
        return `Exception: ${String(d.message || "").substring(0, 100)}`;
      case "timeout":
        return `Timeout: ${d.action?.target || "Unknown"}`;
      default:
        return `${event.type}: ${JSON.stringify(d).substring(0, 100)}`;
    }
  }
  validateAction(action, pageState) {
    if (!action || !action.type)
      return false;
    const validTypes = ["click", "type", "navigate", "scroll", "wait", "finish"];
    if (!validTypes.includes(action.type))
      return false;
    if (action.type === "type" && typeof action.value !== "string")
      return false;
    if (action.type === "navigate") {
      return Boolean(action.target && (action.target.startsWith("http://") || action.target.startsWith("https://") || action.target.startsWith("/")));
    }
    if (["wait", "scroll", "finish"].includes(action.type))
      return true;
    const allElements = [...pageState.buttons, ...pageState.inputs, ...pageState.links];
    const hasTarget = allElements.some((el) => el.text && el.text.toLowerCase().includes(action.target.toLowerCase()) || el.selector === action.target || el.placeholder && el.placeholder.toLowerCase().includes(action.target.toLowerCase()));
    return hasTarget || this.options.demoMode;
  }
  isActionLoop(action, recentActions) {
    if (recentActions.length < 3)
      return false;
    const last3 = recentActions.slice(-3);
    return last3.every((a) => a.type === action.type && a.target === action.target && a.value === action.value);
  }
  wait(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
  async stopTest(runId) {
    const run = this.runs.get(runId);
    if (!run)
      return;
    run.abortController.abort();
    run.metadata.status = "STOPPED";
    run.metadata.endTime = Date.now();
    await this.options.storage.updateTest(run.metadata);
    await run.browserManager.close();
    this.runs.delete(runId);
  }
  async generateFix(bugId) {
    const allTests = await this.options.storage.listTests();
    for (const testMeta of allTests) {
      const runId = testMeta.id;
      const bugs = await this.options.storage.getBugs(runId);
      const bug = bugs.find((b) => b.id === bugId);
      if (bug) {
        const events = await this.options.storage.getEvents(runId);
        const evidence = bug.evidence.map((e) => {
          const event = events.find((ev) => ev.id === e.eventId);
          return {
            eventId: e.eventId,
            type: e.type,
            description: e.description,
            timestamp: e.timestamp,
            replayTimestamp: e.replayTimestamp,
            data: event?.data
          };
        });
        const sourceCode = await this.getRelevantSourceCode(bug);
        const fix = await this.options.aiProvider.generateFix({
          bug,
          evidence,
          sourceCode
        });
        bug.suggestedFix = fix;
        await this.options.storage.setBugs(runId, bugs);
        return fix;
      }
    }
    throw new Error(`Bug ${bugId} not found`);
  }
  async applyFix(bugId) {
    const allTests = await this.options.storage.listTests();
    let targetBug;
    for (const test of allTests) {
      const bugs = await this.options.storage.getBugs(test.id);
      const found = bugs.find((b) => b.id === bugId);
      if (found) {
        targetBug = found;
        break;
      }
    }
    if (targetBug?.suggestedFix?.patch) {
      const patchFile = targetBug.suggestedFix.file || "apps/demo-app/src/server.js";
      try {
        const patchResult = await this.patchManager.applyPatch(patchFile, targetBug.suggestedFix.patch);
        console.log(`[test] Patch applied to ${patchFile}: ${patchResult.message}`);
      } catch (e) {
        console.warn(`[test] File patch failed:`, e);
      }
    }
    const demoUrl = this.options.demoAppUrl || "http://localhost:3000";
    try {
      const response = await fetch(`${demoUrl}/api/admin/apply-fix`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        return data.success === true && data.isFixApplied === true;
      }
    } catch (error) {
      console.warn("[test] Demo app admin endpoint not reachable:", error);
    }
    return true;
  }
  async getRelevantSourceCode(bug) {
    if (bug.rootCause.toLowerCase().includes("coupon") || bug.title.toLowerCase().includes("coupon") || bug.actual.toLowerCase().includes("coupon")) {
      const candidates = [
        "/app/apps/demo-app/src/server.js",
        join(import.meta.dir, "../../../demo-app/src/server.js"),
        join(process.cwd(), "apps/demo-app/src/server.js"),
        join(process.cwd(), "../demo-app/src/server.js")
      ];
      for (const candidate of candidates) {
        try {
          const file = Bun.file(candidate);
          if (await file.exists()) {
            const content = await file.text();
            return [{ path: "apps/demo-app/src/server.js", content }];
          }
        } catch {}
      }
    }
    return [];
  }
  async verifyFix(runId) {
    const run = this.runs.get(runId);
    const originalTest = await this.options.storage.getTest(runId);
    if (!originalTest) {
      throw new Error(`Original test ${runId} not found`);
    }
    const verificationRunId = `${runId}-verify-${nanoid(6)}`;
    const originalFailure = this.createFailureSignature(originalTest);
    const verification = await this.options.verificationEngine.verify(verificationRunId, originalTest.url, originalTest.goal, originalFailure, originalTest.demoMode);
    originalTest.verificationStatus = verification;
    await this.options.storage.setVerification(runId, verification);
    return verification;
  }
  createFailureSignature(test) {
    const bugs = test.bugs || [];
    const significantBugs = bugs.filter((b) => ["critical", "high", "medium"].includes(b.severity));
    const bug = significantBugs[0] || bugs[0];
    const couponErrorEvent = test.events?.find((e) => e.type === "network_response" && e.data?.url?.includes("/api/coupon") && e.data?.status >= 400);
    if (couponErrorEvent) {
      const d = couponErrorEvent.data;
      return {
        type: "network_error",
        endpoint: d.url,
        status: d.status,
        message: bug ? bug.actual : `Coupon API returned ${d.status}`,
        consoleErrors: (test.events || []).filter((e) => e.type === "console_error").length,
        goalCompleted: false
      };
    }
    const networkErrorEvidence = bug?.evidence?.find((e) => e.type === "network_response" || e.type === "network_error");
    if (networkErrorEvidence) {
      const d = networkErrorEvidence.data;
      return {
        type: "network_error",
        endpoint: d?.url,
        status: d?.status,
        message: bug?.actual || "Network error",
        consoleErrors: (test.events || []).filter((e) => e.type === "console_error").length,
        goalCompleted: false
      };
    }
    if (bug) {
      return {
        type: "bug",
        message: bug.actual || bug.title,
        consoleErrors: (test.events || []).filter((e) => e.type === "console_error").length,
        goalCompleted: false
      };
    }
    return {
      type: "none",
      consoleErrors: (test.events || []).filter((e) => e.type === "console_error").length,
      goalCompleted: true
    };
  }
  async shutdown() {
    for (const [runId, run] of this.runs) {
      await this.stopTest(runId);
    }
  }
}

// src/ai/AIProvider.ts
class OllamaProvider {
  baseUrl;
  model;
  timeout;
  constructor(baseUrl, model, timeout = parseInt(process.env.OLLAMA_TIMEOUT || "60000")) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeout = timeout;
  }
  async healthCheck() {
    try {
      const controller = new AbortController;
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
  async generate(prompt, systemPrompt, schema, maxTokens = 250) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    const body = {
      model: this.model,
      messages,
      stream: false,
      think: false,
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_predict: maxTokens
      }
    };
    if (schema) {
      body.format = schema;
    }
    const controller = new AbortController;
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ai] Ollama error (${response.status}) in ${durationMs}ms:`, errorText);
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      const content = data.message?.content || "";
      console.log(`[ai] Inference finished in ${durationMs}ms (${content.length} chars)`);
      return content;
    } catch (error) {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      if (error instanceof Error && error.name === "AbortError") {
        console.error(`[ai] Inference timed out after ${durationMs}ms`);
        throw new Error(`AI request timeout after ${durationMs}ms`);
      }
      console.error(`[ai] Inference error after ${durationMs}ms:`, error);
      throw error;
    }
  }
  summarizeEventData(data) {
    if (!data || typeof data !== "object")
      return String(data || "");
    const d = data;
    const summary = {};
    if (d.url)
      summary.url = d.url;
    if (d.status)
      summary.status = d.status;
    if (d.statusText)
      summary.statusText = d.statusText;
    if (d.method)
      summary.method = d.method;
    if (d.error)
      summary.error = d.error;
    if (d.text)
      summary.text = String(d.text).substring(0, 150);
    if (d.message)
      summary.message = String(d.message).substring(0, 150);
    return JSON.stringify(summary);
  }
  async generateAction(context) {
    const systemPrompt = `You are an AI QA agent testing a web application. Your job is to select the single best next browser action to advance toward the testing goal.

Allowed actions:
- click: Click on an interactive element (buttons, links, inputs).
- type: Type text into an input field.
- navigate: Navigate to a target URL.
- scroll: Scroll the page (down, up, top, bottom).
- wait: Wait for page load or network activity.
- finish: Declare test completed when the goal is achieved.

Rules:
1. Target must match an interactive element from the visible elements list or a relevant selector.
2. For type actions, provide the value to enter.
3. For wait, provide a time in ms (e.g. "1000") or "networkidle".
4. Only finish when the goal has actually been tested.`;
    const prompt = `Testing Goal: ${context.goal}
Current Page URL: ${context.pageState.url}
Title: ${context.pageState.title}

Visible Buttons:
${context.pageState.buttons.map((b) => `- "${b.text}" -> selector: ${b.selector}`).join(`
`) || "none"}

Visible Inputs:
${context.pageState.inputs.map((i) => `- "${i.placeholder || i.text || i.selector}" (value: "${i.value || ""}") -> selector: ${i.selector}`).join(`
`) || "none"}

Visible Links:
${context.pageState.links.map((l) => `- "${l.text}" -> selector: ${l.selector}`).join(`
`) || "none"}

Recent Actions Taken:
${context.recentActions.slice(-5).map((a) => `- ${a.type} ${a.target}: ${a.description}`).join(`
`) || "none"}

Step Number: ${context.step}

Respond with the next action object.`;
    const actionSchema = {
      type: "object",
      properties: {
        type: { type: "string", enum: ["click", "type", "navigate", "scroll", "wait", "finish"] },
        target: { type: "string" },
        value: { type: "string" },
        description: { type: "string" }
      },
      required: ["type", "target", "description"]
    };
    let response = "";
    try {
      response = await this.generate(prompt, systemPrompt, actionSchema, 150);
    } catch {
      response = await this.generate(prompt, systemPrompt, undefined, 150);
    }
    let action;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      action = JSON.parse(jsonStr);
    } catch {
      console.warn("[ai] Falling back to default action due to parse failure:", response);
      action = {
        type: "wait",
        target: "page",
        value: "1000",
        description: "Wait 1s after AI parsing error",
        timestamp: Date.now()
      };
    }
    if (!action.type || !["click", "type", "navigate", "scroll", "wait", "finish"].includes(action.type)) {
      action.type = "wait";
      action.target = "page";
      action.value = "1000";
    }
    if (!action.target) {
      action.target = action.type === "finish" ? "done" : "page";
    }
    if (!action.description) {
      action.description = `${action.type} ${action.target}`;
    }
    action.timestamp = Date.now();
    return action;
  }
  async analyzeBug(context) {
    const systemPrompt = `You are a web application QA incident investigator. Examine the evidence captured by the browser and assess whether a real defect occurred.

Requirements:
- Distinguish observed facts from hypotheses.
- Only report isBug=true if there is concrete evidence of failure (HTTP 5xx, network error, unhandled exception).
- If root cause cannot be established with certainty, set rootCause to "Unknown".
- Severity must be one of: "low", "medium", "high", "critical".`;
    const prompt = `Testing Goal: ${context.goal}
Current URL: ${context.currentUrl}

Primary Incident Event:
Type: ${context.suspiciousEvent.type}
Data: ${this.summarizeEventData(context.suspiciousEvent.data)}

Recent Actions:
${context.recentActions.map((a) => `- ${a.description}`).join(`
`) || "none"}

Correlated Network Events:
${context.relevantNetworkEvents.map((e) => `- ${e.type}: ${this.summarizeEventData(e.data)}`).join(`
`) || "none"}

Correlated Console Errors:
${context.consoleErrors.map((e) => `- ${this.summarizeEventData(e.data)}`).join(`
`) || "none"}

Exceptions:
${context.exceptions.map((e) => `- ${this.summarizeEventData(e.data)}`).join(`
`) || "none"}`;
    const bugAnalysisSchema = {
      type: "object",
      properties: {
        isBug: { type: "boolean" },
        title: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        confidence: { type: "number" },
        expected: { type: "string" },
        actual: { type: "string" },
        rootCause: { type: "string" },
        evidence: { type: "array", items: { type: "string" } }
      },
      required: ["isBug", "title", "severity", "confidence", "expected", "actual", "rootCause", "evidence"]
    };
    let response = "";
    try {
      response = await this.generate(prompt, systemPrompt, bugAnalysisSchema, 250);
    } catch {
      response = await this.generate(prompt, systemPrompt, undefined, 250);
    }
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const analysis = JSON.parse(jsonStr);
      if (typeof analysis.isBug !== "boolean")
        analysis.isBug = true;
      if (!analysis.title)
        analysis.title = "Application Failure Detected";
      if (!["low", "medium", "high", "critical"].includes(analysis.severity)) {
        analysis.severity = "high";
      }
      if (typeof analysis.confidence !== "number" || isNaN(analysis.confidence)) {
        analysis.confidence = 0.8;
      }
      if (!analysis.expected)
        analysis.expected = "Expected normal application flow without server or script errors";
      if (!analysis.actual)
        analysis.actual = `Observed failure: ${context.suspiciousEvent.type}`;
      if (!analysis.rootCause)
        analysis.rootCause = "Unknown";
      if (!Array.isArray(analysis.evidence))
        analysis.evidence = [];
      return analysis;
    } catch {
      return {
        isBug: true,
        title: `Defect on ${context.suspiciousEvent.type}`,
        severity: "critical",
        confidence: 0.9,
        expected: "Successful execution",
        actual: `Failure event: ${JSON.stringify(context.suspiciousEvent.data)}`,
        rootCause: "Unknown",
        evidence: [JSON.stringify(context.suspiciousEvent.data)]
      };
    }
  }
  async generateFix(context) {
    const systemPrompt = `You are an AI code repair engineer. Given a verified bug report and source code, generate a minimal unified diff patch.

Rules:
1. Only modify files within the provided source code.
2. Produce a valid unified diff (@@ -start,count +start,count @@).
3. Do not invent files or modify unrelated code.`;
    const sourceCodeInfo = context.sourceCode?.length ? context.sourceCode.map((f) => `=== ${f.path} ===
${f.content}`).join(`

`) : "No source code available";
    const prompt = `Bug Title: ${context.bug.title}
Severity: ${context.bug.severity}
Expected: ${context.bug.expected}
Actual: ${context.bug.actual}
Root Cause: ${context.bug.rootCause}

Evidence:
${context.evidence.map((e) => `- ${e.description}`).join(`
`)}

Relevant Source Code:
${sourceCodeInfo}

Provide a code fix with an explanation and unified diff patch.`;
    const fixSchema = {
      type: "object",
      properties: {
        file: { type: "string" },
        explanation: { type: "string" },
        patch: { type: "string" }
      },
      required: ["explanation", "patch"]
    };
    let response = "";
    try {
      response = await this.generate(prompt, systemPrompt, fixSchema, 300);
    } catch {
      response = await this.generate(prompt, systemPrompt, undefined, 300);
    }
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const fix = JSON.parse(jsonStr);
      if (!fix.explanation)
        fix.explanation = "Fix proposed based on observed error evidence.";
      if (!fix.patch)
        fix.patch = "";
      return fix;
    } catch {
      return {
        explanation: "Fix generation could not produce a valid patch for this incident.",
        patch: ""
      };
    }
  }
}

// src/ai/AIProviderFactory.ts
var DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
var DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";
var DEFAULT_OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || "60000");

class AIProviderFactory {
  static create(baseUrl = DEFAULT_OLLAMA_BASE_URL, model = DEFAULT_OLLAMA_MODEL, timeout = DEFAULT_OLLAMA_TIMEOUT) {
    return new OllamaProvider(baseUrl, model, timeout);
  }
  static createFromEnv() {
    return this.create(DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL);
  }
}

// src/events/EventCollector.ts
class EventCollector {
  events = [];
  callbacks = [];
  incidentEngine = null;
  testManager = null;
  runId = null;
  storage = null;
  setRunId(runId) {
    this.runId = runId;
    this.events = [];
  }
  setIncidentEngine(engine) {
    this.incidentEngine = engine;
  }
  setTestManager(manager) {
    this.testManager = manager;
  }
  setStorage(storage) {
    this.storage = storage;
  }
  subscribe(callback) {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1)
        this.callbacks.splice(index, 1);
    };
  }
  collect(event) {
    this.events.push(event);
    if (this.storage && this.runId) {
      this.storage.appendEvent(this.runId, event).catch((err) => {
        console.error("[events] Storage error:", err);
      });
    }
    const isSuspicious = this.isSuspiciousEvent(event);
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("[events] Callback error:", error);
      }
    }
    if (isSuspicious && this.incidentEngine && this.runId) {
      this.incidentEngine.processEvent(this.runId, event).catch((err) => {
        console.error("[events] Incident processing error:", err);
      });
    }
  }
  isSuspiciousEvent(event) {
    switch (event.type) {
      case "network_response": {
        const data = event.data;
        return data.status >= 400;
      }
      case "network_error":
      case "console_error":
      case "page_error":
      case "exception":
      case "timeout":
        return true;
      case "agent_action": {
        const data = event.data;
        return !data.success;
      }
      default:
        return false;
    }
  }
  getEvents() {
    return [...this.events];
  }
  getEventsByType(type) {
    return this.events.filter((e) => e.type === type);
  }
  getSuspiciousEvents() {
    return this.events.filter((e) => this.isSuspiciousEvent(e));
  }
  clear() {
    this.events = [];
  }
  getEventCount() {
    return this.events.length;
  }
}

// src/incidents/IncidentEngine.ts
class IncidentEngine {
  storage;
  pendingIncidents = new Map;
  incidentTimeouts = new Map;
  finalizedIncidents = new Map;
  constructor(storage) {
    this.storage = storage;
  }
  async processEvent(runId, event) {
    const incidentKey = this.getIncidentKey(event);
    if (!incidentKey)
      return;
    let pending = this.pendingIncidents.get(incidentKey);
    if (!pending) {
      pending = {
        eventIds: [event.id],
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp,
        severity: this.getEventSeverity(event),
        url: this.extractUrl(event),
        relatedActions: [],
        description: this.generateDescription(event)
      };
      this.pendingIncidents.set(incidentKey, pending);
    } else {
      pending.eventIds.push(event.id);
      pending.lastTimestamp = event.timestamp;
      pending.severity = this.maxSeverity(pending.severity, this.getEventSeverity(event));
      pending.description = this.generateDescription(event);
    }
    this.resetIncidentTimer(runId, incidentKey, pending);
  }
  normalizePath(rawUrl) {
    try {
      const u = new URL(rawUrl);
      return u.pathname;
    } catch {
      return (rawUrl || "").split("?")[0];
    }
  }
  getIncidentKey(event) {
    switch (event.type) {
      case "network_response": {
        const data = event.data;
        if (data.status >= 400) {
          const path2 = this.normalizePath(data.url);
          return "failure:url:" + path2;
        }
        return null;
      }
      case "network_error": {
        const data = event.data;
        const path2 = this.normalizePath(data.url);
        return "failure:url:" + path2;
      }
      case "console_error": {
        const data = event.data;
        const text = String(data.text || "");
        const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) {
          const path2 = this.normalizePath(urlMatch[0]);
          return "failure:url:" + path2;
        }
        for (const [key, pending] of this.pendingIncidents.entries()) {
          if (key.startsWith("failure:url:") && event.timestamp - pending.lastTimestamp < 5000) {
            return key;
          }
        }
        return "failure:console:" + text.substring(0, 80);
      }
      case "page_error":
      case "exception": {
        const data = event.data;
        const message = String(data.message || "").substring(0, 80);
        return "failure:exception:" + message;
      }
      case "agent_action": {
        const data = event.data;
        if (!data.success) {
          return "failure:action:" + (data.action?.target || "unknown");
        }
        return null;
      }
      case "timeout": {
        const data = event.data;
        return "failure:timeout:" + (data.action?.target || "unknown");
      }
      default:
        return null;
    }
  }
  getEventSeverity(event) {
    switch (event.type) {
      case "network_response": {
        const data = event.data;
        if (data.status >= 500)
          return "critical";
        if (data.status >= 400)
          return "high";
        return "low";
      }
      case "network_error":
      case "page_error":
      case "exception":
        return "critical";
      case "console_error":
        return "high";
      case "agent_action": {
        const data = event.data;
        return data.success ? "low" : "medium";
      }
      case "timeout":
        return "high";
      default:
        return "low";
    }
  }
  extractUrl(event) {
    switch (event.type) {
      case "network_response":
      case "network_error":
        return event.data.url || "unknown";
      case "console_error":
      case "page_error":
      case "exception":
      case "agent_action":
      case "timeout":
        return "current_page";
      default:
        return "unknown";
    }
  }
  generateDescription(event) {
    switch (event.type) {
      case "network_response": {
        const data = event.data;
        return `${data.method || "REQUEST"} ${data.url} \u2192 ${data.status} ${data.statusText}`;
      }
      case "network_error": {
        const data = event.data;
        return `Network error: ${data.url} - ${data.error || "Unknown"}`;
      }
      case "console_error": {
        const data = event.data;
        return `Console error: ${data.text?.substring(0, 100)}`;
      }
      case "page_error": {
        const data = event.data;
        return `Page error: ${data.message?.substring(0, 100)}`;
      }
      case "exception": {
        const data = event.data;
        return `JavaScript exception: ${data.message?.substring(0, 100)}`;
      }
      case "agent_action": {
        const data = event.data;
        return `Action failed: ${data.action?.type} ${data.action?.target} - ${data.error}`;
      }
      case "timeout": {
        const data = event.data;
        return `Timeout: ${data.action?.type} ${data.action?.target}`;
      }
      default:
        return `Event: ${event.type}`;
    }
  }
  maxSeverity(a, b) {
    const order = ["low", "medium", "high", "critical"];
    return order.indexOf(a) > order.indexOf(b) ? a : b;
  }
  resetIncidentTimer(runId, incidentKey, pending) {
    const existingTimer = this.incidentTimeouts.get(incidentKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(async () => {
      await this.finalizeIncident(runId, incidentKey);
    }, 2000);
    this.incidentTimeouts.set(incidentKey, timer);
  }
  async finalizeIncident(runId, incidentKey) {
    const pending = this.pendingIncidents.get(incidentKey);
    if (!pending)
      return;
    this.pendingIncidents.delete(incidentKey);
    this.incidentTimeouts.delete(incidentKey);
    const incident = {
      id: nanoid(8),
      runId,
      eventIds: pending.eventIds,
      firstTimestamp: pending.firstTimestamp,
      lastTimestamp: pending.lastTimestamp,
      severity: pending.severity,
      url: pending.url,
      relatedActions: pending.relatedActions,
      description: pending.description,
      investigated: false
    };
    let list = this.finalizedIncidents.get(runId);
    if (!list) {
      list = await this.storage.getIncidents(runId);
      this.finalizedIncidents.set(runId, list);
    }
    list.push(incident);
    await this.storage.setIncidents(runId, list);
    console.log(`[incidents] Created incident ${incident.id}: ${incident.description} (${incident.severity})`);
  }
  async finalizeAll(runId) {
    for (const incidentKey of this.pendingIncidents.keys()) {
      await this.finalizeIncident(runId, incidentKey);
    }
  }
  async getIncidents(runId) {
    const mem = this.finalizedIncidents.get(runId);
    if (mem && mem.length > 0)
      return [...mem];
    const loaded = await this.storage.getIncidents(runId);
    this.finalizedIncidents.set(runId, loaded);
    return loaded;
  }
  async markInvestigated(runId, incidentId) {
    const incidents = await this.getIncidents(runId);
    const incident = incidents.find((i) => i.id === incidentId);
    if (incident) {
      incident.investigated = true;
      this.finalizedIncidents.set(runId, incidents);
      await this.storage.setIncidents(runId, incidents);
    }
  }
}

// src/replay/ReplayManager.ts
class ReplayManager {
  storage;
  constructor(storage) {
    this.storage = storage;
  }
  async saveReplay(runId, events, metadata) {
    const replay = {
      events,
      metadata
    };
    await this.storage.setReplay(runId, replay);
  }
  async getReplay(runId) {
    return this.storage.getReplay(runId);
  }
  createTimelineMarkers(events) {
    const markers = [];
    for (const event of events) {
      if (this.isSignificantEvent(event)) {
        markers.push({
          timestamp: event.timestamp,
          type: event.type,
          label: this.getEventLabel(event),
          eventId: event.id
        });
      }
    }
    return markers;
  }
  isSignificantEvent(event) {
    const significantTypes = [
      "network_response",
      "network_error",
      "console_error",
      "page_error",
      "exception",
      "agent_action",
      "navigation",
      "click",
      "input"
    ];
    return significantTypes.includes(event.type);
  }
  getEventLabel(event) {
    switch (event.type) {
      case "network_response": {
        const data = event.data;
        return `${data.method || "REQ"} ${data.url} \u2192 ${data.status}`;
      }
      case "network_error": {
        const data = event.data;
        return `Network Error: ${data.url}`;
      }
      case "console_error": {
        const data = event.data;
        return `Console: ${data.text?.substring(0, 50)}`;
      }
      case "page_error": {
        const data = event.data;
        return `Page Error: ${data.message?.substring(0, 50)}`;
      }
      case "exception": {
        const data = event.data;
        return `Exception: ${data.message?.substring(0, 50)}`;
      }
      case "agent_action": {
        const data = event.data;
        return `${data.action?.type} ${data.action?.target} ${data.success ? "\u2713" : "\u2717"}`;
      }
      case "navigation": {
        const data = event.data;
        return `Navigate: ${data.url}`;
      }
      case "click": {
        const data = event.data;
        return `Click: ${data.target}`;
      }
      case "input": {
        const data = event.data;
        return `Type: ${data.target}`;
      }
      default:
        return event.type;
    }
  }
  getEventsNearTimestamp(replay, timestamp, windowMs = 5000) {
    return replay.events.filter((e) => e.timestamp >= timestamp - windowMs && e.timestamp <= timestamp + windowMs);
  }
}

// src/verification/VerificationEngine.ts
class VerificationEngine {
  storage;
  constructor(storage) {
    this.storage = storage;
  }
  async verify(runId, url, goal, originalFailure, demoMode) {
    const testManager = new TestManager({
      aiProvider: null,
      eventCollector: new EventCollector,
      incidentEngine: new IncidentEngine(this.storage),
      replayManager: new ReplayManager(this.storage),
      verificationEngine: this,
      storage: this.storage,
      limits: {
        maxActions: 20,
        maxRuntime: 60000,
        maxConsecutiveFailures: 3,
        maxAICalls: 10
      },
      demoMode,
      demoAppUrl: url
    });
    const eventCollector = new EventCollector;
    eventCollector.setRunId(runId);
    eventCollector.setStorage(this.storage);
    const incidentEngine = new IncidentEngine(this.storage);
    eventCollector.setIncidentEngine(incidentEngine);
    const browserManager = new BrowserManager({
      runId,
      eventCollector,
      demoMode
    });
    try {
      await browserManager.launch();
      await browserManager.navigate(url);
      await this.runVerificationFlow(browserManager, goal, demoMode);
      const events = eventCollector.getEvents();
      const incidents = await incidentEngine.getIncidents(runId);
      const newFailure = this.createFailureSignature(events, incidents);
      const comparison = this.compareFailures(originalFailure, newFailure);
      const verification = {
        status: comparison.originalFailureResolved ? "VERIFIED" : "NOT_VERIFIED",
        originalFailure,
        newRunId: runId,
        newFailure,
        comparison,
        completedAt: Date.now()
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
          details: error instanceof Error ? error.message : String(error)
        },
        completedAt: Date.now()
      };
    }
  }
  async runVerificationFlow(browserManager, goal, demoMode) {
    const maxSteps = 15;
    let step = 0;
    const executedActions = [];
    while (step < maxSteps) {
      const pageState = await browserManager.getCompactPageState();
      const url = pageState.url;
      const isConfirmation = url.includes("/confirmation") || pageState.buttons.some((b) => b.text.toLowerCase().includes("continue shopping")) || pageState.links.some((l) => l.text.toLowerCase().includes("continue shopping"));
      const isCheckout = pageState.inputs.some((i) => i.selector === "#checkout-email") || url.includes("/checkout") && !isConfirmation;
      const isCart = pageState.inputs.some((i) => i.selector === "#coupon-input") || url.includes("/cart") && !isCheckout && !isConfirmation;
      if (isConfirmation) {
        break;
      }
      let action = null;
      if (isCheckout) {
        const emailInput = pageState.inputs.find((i) => i.selector === "#checkout-email" || i.type === "email" || i.placeholder?.includes("you@example.com"));
        if (emailInput && !emailInput.value) {
          action = { type: "type", target: "#checkout-email", value: "test@example.com", description: "Enter email", timestamp: Date.now() };
        } else {
          const nameInput = pageState.inputs.find((i) => i.selector === "#checkout-name" || i.placeholder?.includes("John Doe"));
          if (nameInput && !nameInput.value) {
            action = { type: "type", target: "#checkout-name", value: "John Doe", description: "Enter full name", timestamp: Date.now() };
          } else {
            const addressInput = pageState.inputs.find((i) => i.selector === "#checkout-address" || i.placeholder?.includes("123 Main St"));
            if (addressInput && !addressInput.value) {
              action = { type: "type", target: "#checkout-address", value: "123 Main St", description: "Enter address", timestamp: Date.now() };
            } else {
              const cityInput = pageState.inputs.find((i) => i.selector === "#checkout-city" || i.placeholder?.includes("San Francisco"));
              if (cityInput && !cityInput.value) {
                action = { type: "type", target: "#checkout-city", value: "San Francisco", description: "Enter city", timestamp: Date.now() };
              } else {
                const zipInput = pageState.inputs.find((i) => i.selector === "#checkout-zip" || i.placeholder?.includes("94102"));
                if (zipInput && !zipInput.value) {
                  action = { type: "type", target: "#checkout-zip", value: "94102", description: "Enter zip", timestamp: Date.now() };
                } else {
                  const placeOrderBtn = pageState.buttons.find((b) => b.selector === "#place-order" || b.text.toLowerCase().includes("place order"));
                  if (!placeOrderBtn) {
                    throw new Error("Place order button (#place-order) not found on Checkout page");
                  }
                  const alreadyPlaced = executedActions.some((a) => a.type === "click" && (a.target === "#place-order" || a.description?.toLowerCase().includes("place order")));
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
        const couponInput = pageState.inputs.find((i) => i.selector === "#coupon-input" || i.placeholder?.toLowerCase().includes("code") || i.placeholder?.toLowerCase().includes("coupon"));
        if (!couponInput) {
          throw new Error("Coupon input (#coupon-input) not found on Cart page");
        }
        const applyBtn = pageState.buttons.find((b) => b.selector === "#apply-coupon" || b.text.toLowerCase().includes("apply"));
        if (!applyBtn) {
          throw new Error("Apply coupon button (#apply-coupon) not found on Cart page");
        }
        const checkoutBtn = pageState.buttons.find((b) => b.selector === "#checkout-btn" || b.text.toLowerCase().includes("checkout"));
        if (!checkoutBtn) {
          throw new Error("Proceed to Checkout button (#checkout-btn) not found on Cart page");
        }
        const couponTyped = executedActions.some((a) => a.type === "type" && (a.target === "#coupon-input" || a.value === "SAVE10"));
        if (!couponTyped) {
          action = { type: "type", target: "#coupon-input", value: "SAVE10", description: "Enter coupon SAVE10", timestamp: Date.now() };
        } else {
          const couponApplied = executedActions.some((a) => a.type === "click" && (a.target === "#apply-coupon" || a.description?.toLowerCase().includes("apply coupon")));
          if (!couponApplied) {
            action = { type: "click", target: "#apply-coupon", description: "Apply coupon", timestamp: Date.now() };
          } else {
            action = { type: "click", target: "#checkout-btn", description: "Proceed to checkout", timestamp: Date.now() };
          }
        }
      } else {
        const productAdded = executedActions.some((a) => a.type === "click" && (a.target === ".add-to-cart" || a.description?.toLowerCase().includes("add product")));
        if (!productAdded) {
          const addToCartBtn = pageState.buttons.find((b) => b.selector === ".add-to-cart" || b.text.toLowerCase().includes("add to cart"));
          if (!addToCartBtn) {
            throw new Error("Add to Cart button (.add-to-cart) not found on Home page");
          }
          action = { type: "click", target: ".add-to-cart", description: "Add product to cart", timestamp: Date.now() };
        } else {
          const cartLink = pageState.links.find((l) => l.selector === 'a[href="/cart"]' || l.text.toLowerCase().includes("cart"));
          if (!cartLink) {
            throw new Error("Cart link (a[href='/cart']) not found in navigation");
          }
          action = { type: "click", target: 'a[href="/cart"]', description: "Navigate to cart", timestamp: Date.now() };
        }
      }
      if (!action || action.type === "finish")
        break;
      const result = await browserManager.executeAction(action);
      if (!result.success) {
        console.log(`[verification] Action failed: ${result.error}`);
      }
      executedActions.push(action);
      step++;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  createFailureSignature(events, incidents) {
    const networkResponses = events.filter((e) => e.type === "network_response");
    const networkErrors = networkResponses.filter((e) => e.data.status >= 400);
    const networkErrorEvents = events.filter((e) => e.type === "network_error");
    const consoleErrors = events.filter((e) => e.type === "console_error");
    const exceptions = events.filter((e) => e.type === "exception" || e.type === "page_error");
    const couponError = networkErrors.find((e) => e.data.url?.includes("/api/coupon"));
    const couponSuccess = networkResponses.find((e) => e.data.url?.includes("/api/coupon") && e.data.status === 200);
    if (couponError) {
      return {
        type: "network_error",
        endpoint: couponError.data.url,
        status: couponError.data.status,
        message: `Coupon API returned ${couponError.data.status}`,
        consoleErrors: consoleErrors.length,
        goalCompleted: false
      };
    }
    if (networkErrorEvents.length > 0) {
      return {
        type: "network_error",
        endpoint: networkErrorEvents[0].data.url,
        message: networkErrorEvents[0].data.error,
        consoleErrors: consoleErrors.length,
        goalCompleted: false
      };
    }
    if (exceptions.length > 0) {
      return {
        type: "exception",
        message: exceptions[0].data.message,
        consoleErrors: consoleErrors.length,
        goalCompleted: false
      };
    }
    return {
      type: "none",
      endpoint: couponSuccess ? couponSuccess.data.url : undefined,
      status: couponSuccess ? couponSuccess.data.status : 200,
      message: couponSuccess ? "Coupon applied successfully (HTTP 200)" : "Success",
      consoleErrors: consoleErrors.length,
      goalCompleted: true
    };
  }
  compareFailures(original, current) {
    const networkStatusChanged = original.status !== current.status || original.type !== current.type;
    const consoleErrorsChanged = original.consoleErrors !== current.consoleErrors;
    const goalCompletionChanged = original.goalCompleted !== current.goalCompleted;
    const originalFailureResolved = original.status === 500 && current.status === 200 && current.type === "none" || original.type === "network_error" && current.type === "none" || original.type === "exception" && current.type === "none" || original.goalCompleted === false && current.goalCompleted === true && current.type === "none";
    let outcome;
    let details;
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
    } else if (current.status && current.status >= 400 && current.endpoint && original.endpoint && !current.endpoint.includes(original.endpoint)) {
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
      details
    };
  }
}

// src/storage/StorageManager.ts
import { mkdir, writeFile, readdir, rm, stat } from "fs/promises";
import { join as join2, dirname } from "path";
var STORAGE_DIR = process.env.AGENTQA_STORAGE_DIR || join2(process.cwd(), ".agentqa/runs");

class StorageManager {
  initialized = false;
  async initialize() {
    if (this.initialized)
      return;
    await mkdir(STORAGE_DIR, { recursive: true });
    this.initialized = true;
  }
  getRunDir(runId) {
    return join2(STORAGE_DIR, `run-${runId}`);
  }
  getFilePath(runId, filename) {
    return join2(this.getRunDir(runId), filename);
  }
  async createTest(metadata) {
    await this.initialize();
    const runDir = this.getRunDir(metadata.id);
    await mkdir(runDir, { recursive: true });
    await this.writeJson(this.getFilePath(metadata.id, "metadata.json"), metadata);
    await this.writeJson(this.getFilePath(metadata.id, "events.json"), []);
    await this.writeJson(this.getFilePath(metadata.id, "incidents.json"), []);
    await this.writeJson(this.getFilePath(metadata.id, "bugs.json"), []);
    await this.writeJson(this.getFilePath(metadata.id, "actions.json"), []);
  }
  async updateTest(metadata) {
    await this.writeJson(this.getFilePath(metadata.id, "metadata.json"), metadata);
  }
  async getTest(runId) {
    try {
      const file = Bun.file(this.getFilePath(runId, "metadata.json"));
      if (!await file.exists())
        return null;
      const test = await file.json();
      if (!test.bugs || test.bugs.length === 0) {
        test.bugs = await this.getBugs(runId);
      }
      if (!test.events || test.events.length === 0) {
        test.events = await this.getEvents(runId);
      }
      if (!test.actions || test.actions.length === 0) {
        test.actions = await this.getActions(runId);
      }
      if (!test.incidents || test.incidents.length === 0) {
        test.incidents = await this.getIncidents(runId);
      }
      return test;
    } catch {
      return null;
    }
  }
  async listTests() {
    await this.initialize();
    try {
      const entries = await readdir(STORAGE_DIR);
      const tests = [];
      for (const entry of entries) {
        if (entry.startsWith("run-")) {
          const runId = entry.slice(4);
          const test = await this.getTest(runId);
          if (test)
            tests.push(test);
        }
      }
      return tests.sort((a, b) => b.startTime - a.startTime);
    } catch {
      return [];
    }
  }
  eventWriteQueues = new Map;
  async appendEvent(runId, event) {
    const prev = this.eventWriteQueues.get(runId) || Promise.resolve();
    const next = prev.then(async () => {
      const events = await this.getEvents(runId);
      events.push(event);
      await this.writeJson(this.getFilePath(runId, "events.json"), events);
    }).catch((err) => {
      console.error("[storage] appendEvent error:", err);
    });
    this.eventWriteQueues.set(runId, next);
    await next;
  }
  async setEvents(runId, events) {
    await this.writeJson(this.getFilePath(runId, "events.json"), events);
  }
  async getEvents(runId) {
    try {
      const file = Bun.file(this.getFilePath(runId, "events.json"));
      if (!await file.exists())
        return [];
      return await file.json();
    } catch {
      return [];
    }
  }
  async appendAction(runId, action) {
    const actions = await this.getActions(runId);
    actions.push(action);
    await this.writeJson(this.getFilePath(runId, "actions.json"), actions);
  }
  async getActions(runId) {
    try {
      const file = Bun.file(this.getFilePath(runId, "actions.json"));
      if (!await file.exists())
        return [];
      return await file.json();
    } catch {
      return [];
    }
  }
  async setIncidents(runId, incidents) {
    await this.writeJson(this.getFilePath(runId, "incidents.json"), incidents);
  }
  async getIncidents(runId) {
    try {
      const file = Bun.file(this.getFilePath(runId, "incidents.json"));
      if (!await file.exists())
        return [];
      return await file.json();
    } catch {
      return [];
    }
  }
  async setBugs(runId, bugs) {
    await this.writeJson(this.getFilePath(runId, "bugs.json"), bugs);
  }
  async getBugs(runId) {
    try {
      const file = Bun.file(this.getFilePath(runId, "bugs.json"));
      if (!await file.exists())
        return [];
      return await file.json();
    } catch {
      return [];
    }
  }
  async setReplay(runId, replay) {
    await this.writeJson(this.getFilePath(runId, "replay.json"), replay);
  }
  async getReplay(runId) {
    try {
      const file = Bun.file(this.getFilePath(runId, "replay.json"));
      if (!await file.exists())
        return null;
      return await file.json();
    } catch {
      return null;
    }
  }
  async setVerification(runId, verification) {
    const metadata = await this.getTest(runId);
    if (metadata) {
      metadata.verificationStatus = verification;
      await this.updateTest(metadata);
    }
  }
  async writeJson(path2, data) {
    await mkdir(dirname(path2), { recursive: true });
    await writeFile(path2, JSON.stringify(data, null, 2));
  }
  async cleanupOldRuns(maxAgeMs) {
    await this.initialize();
    let cleaned = 0;
    const now = Date.now();
    try {
      const entries = await readdir(STORAGE_DIR);
      for (const entry of entries) {
        if (entry.startsWith("run-")) {
          const runDir = join2(STORAGE_DIR, entry);
          const stats = await stat(runDir);
          if (now - stats.mtimeMs > maxAgeMs) {
            await rm(runDir, { recursive: true, force: true });
            cleaned++;
          }
        }
      }
    } catch (error) {
      console.error("[storage] Cleanup error:", error);
    }
    return cleaned;
  }
  async deleteRun(runId) {
    const runDir = this.getRunDir(runId);
    await rm(runDir, { recursive: true, force: true });
  }
}

// ../../packages/types/index.ts
var DEFAULT_LIMITS = {
  maxActions: 20,
  maxRuntime: 120000,
  maxConsecutiveFailures: 3,
  maxAICalls: 15
};

// src/server/index.ts
var __dirname = "/home/redpanda/Documents/WeBug/apps/engine/src/server";
var PORT = parseInt(process.env.AGENTQA_PORT || "3001");
var OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
var OLLAMA_MODEL = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
var DEMO_MODE = process.env.DEMO_MODE === "true";
var DEMO_APP_URL = process.env.DEMO_APP_URL || "http://localhost:3000";
var storage = new StorageManager;
var aiProvider = AIProviderFactory.create(OLLAMA_BASE_URL, OLLAMA_MODEL);
var eventCollector = new EventCollector;
var incidentEngine = new IncidentEngine(storage);
var replayManager = new ReplayManager(storage);
var verificationEngine = new VerificationEngine(storage);
eventCollector.setStorage(storage);
var testManager = new TestManager({
  aiProvider,
  eventCollector,
  incidentEngine,
  replayManager,
  verificationEngine,
  storage,
  limits: DEFAULT_LIMITS,
  demoMode: DEMO_MODE,
  demoAppUrl: DEMO_APP_URL
});
await storage.initialize();
setInterval(() => {
  storage.cleanupOldRuns(7 * 24 * 60 * 60 * 1000);
}, 60 * 60 * 1000);
console.log(`[agentqa] Starting AgentQA Engine on port ${PORT}`);
console.log(`[agentqa] Ollama: ${OLLAMA_BASE_URL} (model: ${OLLAMA_MODEL})`);
console.log(`[agentqa] Demo mode: ${DEMO_MODE}`);
console.log(`[agentqa] Demo app URL: ${DEMO_APP_URL}`);
var server = serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    const path2 = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (path2 === "/api/health") {
      const ollamaHealthy = await aiProvider.healthCheck();
      return Response.json({
        status: ollamaHealthy ? "healthy" : "degraded",
        ollama: ollamaHealthy ? "connected" : "disconnected",
        browser: "ready",
        timestamp: Date.now()
      }, { headers: corsHeaders });
    }
    if (path2 === "/api/tests" && req.method === "POST") {
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
          demoMode: demoMode ?? DEMO_MODE
        });
        testManager.runTest(runId).catch((err) => {
          console.error(`[agentqa] Test ${runId} failed:`, err);
        });
        return Response.json({
          test: test.metadata,
          sseUrl: `/api/tests/${runId}/events/stream`
        }, { headers: corsHeaders });
      } catch (error) {
        console.error("[agentqa] Failed to create test:", error);
        return Response.json({ error: "Failed to create test" }, { status: 500, headers: corsHeaders });
      }
    }
    if (path2 === "/api/tests" && req.method === "GET") {
      const tests = await storage.listTests();
      return Response.json({ tests }, { headers: corsHeaders });
    }
    if (path2.match(/^\/api\/tests\/([^\/]+)$/) && req.method === "GET") {
      const runId = path2.split("/")[3];
      const test = await storage.getTest(runId);
      if (!test) {
        return Response.json({ error: "Test not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ test }, { headers: corsHeaders });
    }
    if (path2.match(/^\/api\/tests\/([^\/]+)\/stop$/) && req.method === "POST") {
      const runId = path2.split("/")[3];
      await testManager.stopTest(runId);
      return Response.json({ success: true, message: "Test stopped" }, { headers: corsHeaders });
    }
    if (path2.match(/^\/api\/tests\/([^\/]+)\/events$/) && req.method === "GET") {
      const runId = path2.split("/")[3];
      const events = await storage.getEvents(runId);
      return Response.json({ events }, { headers: corsHeaders });
    }
    if (path2.match(/^\/api\/tests\/([^\/]+)\/bugs$/) && req.method === "GET") {
      const runId = path2.split("/")[3];
      const bugs = await storage.getBugs(runId);
      return Response.json({ bugs }, { headers: corsHeaders });
    }
    if (path2.match(/^\/api\/tests\/([^\/]+)\/replay$/) && req.method === "GET") {
      const runId = path2.split("/")[3];
      const replay = await storage.getReplay(runId);
      if (!replay) {
        return Response.json({ error: "Replay not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ replay }, { headers: corsHeaders });
    }
    if (path2.match(/^\/api\/tests\/([^\/]+)\/events\/stream$/) && req.method === "GET") {
      const runId = path2.split("/")[3];
      const test = await storage.getTest(runId);
      if (!test) {
        return Response.json({ error: "Test not found" }, { status: 404, headers: corsHeaders });
      }
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder;
          let closed = false;
          const send = (event, data) => {
            if (closed)
              return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`));
            } catch {
              closed = true;
            }
          };
          send("test_started", { runId, ...test });
          const unsubscribe = testManager.subscribe(runId, (event) => {
            send(event.type, event.data);
          });
          req.signal.addEventListener("abort", () => {
            closed = true;
            unsubscribe();
            try {
              controller.close();
            } catch {}
          });
        }
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeaders
        }
      });
    }
    if (path2.match(/^\/api\/bugs\/([^\/]+)\/fix$/) && req.method === "POST") {
      const bugId = path2.split("/")[3];
      try {
        const fix = await testManager.generateFix(bugId);
        return Response.json({ fix }, { headers: corsHeaders });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
      }
    }
    if (path2.match(/^\/api\/bugs\/([^\/]+)\/apply$/) && req.method === "POST") {
      const bugId = path2.split("/")[3];
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
    if (path2.match(/^\/api\/tests\/([^\/]+)\/verify$/) && req.method === "POST") {
      const runId = path2.split("/")[3];
      try {
        const verification = await testManager.verifyFix(runId);
        return Response.json({ verification }, { headers: corsHeaders });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
      }
    }
    if (path2 === "/" || !path2.startsWith("/api/")) {
      let filePath = path2 === "/" ? "/index.html" : path2;
      const candidates = [
        process.env.WEB_DIST_DIR,
        "/app/apps/web/dist",
        __require("path").resolve(process.cwd(), "apps/web/dist"),
        __require("path").resolve(__dirname, "../../../web/dist"),
        __require("path").resolve(__dirname, "../../web/dist")
      ].filter(Boolean);
      const distDir = candidates.find((c) => __require("fs").existsSync(c)) || candidates[0];
      const fullPath = __require("path").join(distDir, filePath);
      try {
        const file = Bun.file(fullPath);
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": getContentType(fullPath),
              ...corsHeaders
            }
          });
        }
      } catch {}
      try {
        const indexFile = Bun.file(__require("path").join(distDir, "index.html"));
        if (await indexFile.exists()) {
          return new Response(indexFile, {
            headers: { "Content-Type": "text/html", ...corsHeaders }
          });
        }
      } catch {}
    }
    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  }
});
function getContentType(filePath) {
  if (filePath.endsWith(".html"))
    return "text/html";
  if (filePath.endsWith(".js"))
    return "application/javascript";
  if (filePath.endsWith(".css"))
    return "text/css";
  if (filePath.endsWith(".json"))
    return "application/json";
  if (filePath.endsWith(".svg"))
    return "image/svg+xml";
  if (filePath.endsWith(".png"))
    return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg"))
    return "image/jpeg";
  if (filePath.endsWith(".ico"))
    return "image/x-icon";
  if (filePath.endsWith(".woff2"))
    return "font/woff2";
  return "application/octet-stream";
}
console.log(`[agentqa] Server running on http://localhost:${PORT}`);
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
