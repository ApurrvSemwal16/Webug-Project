/**
 * Browser Manager - Handles Playwright browser lifecycle and page interactions
 */

import { chromium, Browser, BrowserContext, Page, CDPSession } from "playwright";
import { CompactPageState, InteractiveElement, AgentAction, BrowserEvent, EventType } from "@agentqa/types";
import { EventCollector } from "../events/EventCollector";
import { nanoid } from "nanoid";

export interface BrowserManagerOptions {
  runId: string;
  eventCollector: EventCollector;
  demoMode?: boolean;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private runId: string;
  private eventCollector: EventCollector;
  private demoMode: boolean;
  private rrwebEvents: any[] = [];
  private rrwebRecording = false;

  constructor(options: BrowserManagerOptions) {
    this.runId = options.runId;
    this.eventCollector = options.eventCollector;
    this.demoMode = options.demoMode ?? false;
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `/tmp/agentqa-videos/${this.runId}`, size: { width: 1280, height: 720 } },
    });

    this.page = await this.context.newPage();

    // Set up CDP session for rrweb
    this.cdpSession = await this.context.newCDPSession(this.page);

    // Set up event listeners
    this.setupEventListeners();

    // Inject rrweb recorder
    await this.injectRRWeb();
  }

  private setupEventListeners(): void {
    if (!this.page) return;

    // Navigation events
    this.page.on("framenavigated", (frame) => {
      if (frame === this.page?.mainFrame()) {
        this.recordEvent("navigation", {
          url: frame.url(),
          title: "",
          referrer: "",
        });
      }
    });

    this.page.on("load", async () => {
      if (this.page) {
        const title = await this.page.title();
        this.recordEvent("navigation", {
          url: this.page.url(),
          title,
          referrer: "",
        });
      }
    });

    // Console events
    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.recordEvent("console_error", {
          text: msg.text(),
          location: msg.location(),
        });
      } else if (msg.type() === "warning") {
        this.recordEvent("console_warning", {
          text: msg.text(),
          location: msg.location(),
        });
      }
    });

    // Page errors
    this.page.on("pageerror", (error) => {
      this.recordEvent("page_error", {
        message: error.message,
        stack: error.stack,
      });
    });

    // Network events
    this.page.on("request", (request) => {
      this.recordEvent("network_request", {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() || undefined,
      });
    });

    this.page.on("response", async (response) => {
      const timing = response.timing();
      this.recordEvent("network_response", {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        fromCache: response.fromCache(),
        timing: {
          startTime: timing?.startTime || 0,
          domainLookupStart: timing?.domainLookupStart || 0,
          domainLookupEnd: timing?.domainLookupEnd || 0,
          connectStart: timing?.connectStart || 0,
          connectEnd: timing?.connectEnd || 0,
          requestStart: timing?.requestStart || 0,
          responseStart: timing?.responseStart || 0,
          responseEnd: timing?.responseEnd || 0,
        },
      });

      // Check for error responses
      if (response.status() >= 400) {
        this.recordEvent("network_error", {
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
        });
      }
    });

    // Request failed
    this.page.on("requestfailed", (request) => {
      this.recordEvent("network_error", {
        url: request.url(),
        error: request.failure()?.errorText,
      });
    });

    // Click events (we'll also capture these via our own action execution)
    this.page.on("click", async (event) => {
      // This is for native clicks not triggered by our actions
    });
  }

  private async injectRRWeb(): Promise<void> {
    if (!this.page) return;

    // Inject rrweb snapshot and record
    await this.page.addInitScript(() => {
      // rrweb will be injected via the snapshot script
      (window as any).__rrweb_events = [];
    });

    // We'll use rrweb-snapshot to capture snapshots periodically
    this.startRRWebRecording();
  }

  private startRRWebRecording(): void {
    if (!this.page) return;
    this.rrwebRecording = true;

    const recordSnapshot = async () => {
      if (!this.rrwebRecording || !this.page) return;

      try {
        // Capture snapshot using rrweb-snapshot approach
        const snapshot = await this.page.evaluate(() => {
          // Simple DOM snapshot for replay
          return {
            timestamp: Date.now(),
            html: document.documentElement.outerHTML,
            url: window.location.href,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          };
        });

        this.rrwebEvents.push({
          type: 2, // Full snapshot
          timestamp: snapshot.timestamp,
          data: {
            node: snapshot.html,
            initialOffset: { x: snapshot.scrollX, y: snapshot.scrollY },
          },
        });
      } catch (error) {
        console.error("[browser] RRWeb snapshot error:", error);
      }

      // Schedule next snapshot
      if (this.rrwebRecording) {
        setTimeout(recordSnapshot, 1000); // Every 1 second
      }
    };

    // Start recording after a short delay
    setTimeout(recordSnapshot, 500);
  }

  stopRRWebRecording(): any[] {
    this.rrwebRecording = false;
    return this.rrwebEvents;
  }

  getRRWebEvents(): any[] {
    return this.rrwebEvents;
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }

  async getCompactPageState(): Promise<CompactPageState> {
    if (!this.page) throw new Error("Browser not launched");

    return await this.page.evaluate(() => {
      const getSelector = (element: Element): string => {
        if (element.id) return `#${element.id}`;
        if (element.className) {
          const classes = element.className.split(" ").filter(c => c).join(".");
          if (classes) return `.${classes}`;
        }
        return element.tagName.toLowerCase();
      };

      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      const isEnabled = (element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean => {
        return !element.disabled && !element.readOnly;
      };

      const buttons: InteractiveElement[] = [];
      document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a.btn, .btn").forEach((el) => {
        const element = el as HTMLElement;
        if (isVisible(element)) {
          buttons.push({
            selector: getSelector(element),
            text: element.textContent?.trim() || element.getAttribute("aria-label") || "Button",
            tag: element.tagName.toLowerCase(),
            visible: true,
            enabled: isEnabled(element as any),
            boundingBox: element.getBoundingClientRect(),
          });
        }
      });

      const inputs: InteractiveElement[] = [];
      document.querySelectorAll("input:not([type='hidden']), textarea, select").forEach((el) => {
        const element = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (isVisible(element)) {
          inputs.push({
            selector: getSelector(element),
            text: element.labels?.[0]?.textContent?.trim() || element.getAttribute("placeholder") || element.name || "Input",
            tag: element.tagName.toLowerCase(),
            type: (element as HTMLInputElement).type,
            placeholder: element.getAttribute("placeholder") || undefined,
            value: element.value,
            visible: true,
            enabled: isEnabled(element),
            boundingBox: element.getBoundingClientRect(),
          });
        }
      });

      const links: InteractiveElement[] = [];
      document.querySelectorAll("a[href]").forEach((el) => {
        const element = el as HTMLAnchorElement;
        if (isVisible(element)) {
          links.push({
            selector: getSelector(element),
            text: element.textContent?.trim() || element.href,
            tag: "a",
            visible: true,
            enabled: true,
            boundingBox: element.getBoundingClientRect(),
          });
        }
      });

      return {
        url: window.location.href,
        title: document.title,
        buttons,
        inputs,
        links,
        forms: [],
      };
    });
  }

  async executeAction(action: AgentAction): Promise<{ success: boolean; error?: string }> {
    if (!this.page) throw new Error("Browser not launched");

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

      // Record the action as an event
      this.recordEvent("agent_action", {
        action,
        success: true,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.recordEvent("agent_action", {
        action,
        success: false,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  private async clickElement(target: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    // Try multiple selector strategies
    const strategies = [
      target, // Direct selector
      `text="${target}"`, // Text content
      `[aria-label="${target}"]`, // ARIA label
      `button:has-text("${target}")`, // Button with text
      `a:has-text("${target}")`, // Link with text
      `[placeholder="${target}"]`, // Placeholder
      `[name="${target}"]`, // Name attribute
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
      } catch {
        // Try next strategy
      }
    }

    if (!clicked) {
      throw new Error(`Could not find clickable element: ${target}`);
    }

    // Wait for any navigation or network activity
    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }

  private async typeText(target: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    const strategies = [
      target,
      `[placeholder="${target}"]`,
      `[name="${target}"]`,
      `[aria-label="${target}"]`,
      `input[type="text"]`,
      `input[type="email"]`,
      `input[type="password"]`,
      `textarea`,
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
      } catch {
        // Try next strategy
      }
    }

    if (!typed) {
      throw new Error(`Could not find input element: ${target}`);
    }
  }

  private async scrollPage(direction: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    const scrollMap: Record<string, number> = {
      up: -500,
      down: 500,
      top: -999999,
      bottom: 999999,
    };

    const amount = scrollMap[direction] || parseInt(direction) || 500;
    await this.page.evaluate((amt) => window.scrollBy(0, amt), amount);
    await this.page.waitForTimeout(500);
  }

  private async waitFor(condition: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    if (condition === "networkidle") {
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    } else {
      const ms = parseInt(condition) || 1000;
      await this.page.waitForTimeout(ms);
    }
  }

  private recordEvent(type: EventType, data: unknown): void {
    const event: BrowserEvent = {
      id: nanoid(8),
      runId: this.runId,
      timestamp: Date.now(),
      type,
      data,
    };
    this.eventCollector.collect(event);
  }

  async close(): Promise<void> {
    this.stopRRWebRecording();
    if (this.cdpSession) await this.cdpSession.detach();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  getPage(): Page | null {
    return this.page;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }
}