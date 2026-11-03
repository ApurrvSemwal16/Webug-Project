/**
 * AI Provider Interface and Ollama Implementation for Qwen3
 */

import {
  AIProvider,
  AgentContext,
  AgentAction,
  InvestigationContext,
  BugAnalysis,
  FixContext,
  CodeFix,
} from "@agentqa/types";

export class OllamaProvider implements AIProvider {
  private baseUrl: string;
  private model: string;
  private timeout: number;

  constructor(
    baseUrl: string,
    model: string,
    timeout = parseInt(process.env.OLLAMA_TIMEOUT || "60000")
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeout = timeout;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async generate(
    prompt: string,
    systemPrompt?: string,
    schema?: Record<string, unknown>,
    maxTokens = 250
  ): Promise<string> {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      think: false, // Disables extended reasoning tokens for rapid inference
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_predict: maxTokens,
      },
    };

    if (schema) {
      body.format = schema;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
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

    private summarizeEventData(data: unknown): string {
    if (!data || typeof data !== "object") return String(data || "");
    const d = data as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    if (d.url) summary.url = d.url;
    if (d.status) summary.status = d.status;
    if (d.statusText) summary.statusText = d.statusText;
    if (d.method) summary.method = d.method;
    if (d.error) summary.error = d.error;
    if (d.text) summary.text = String(d.text).substring(0, 150);
    if (d.message) summary.message = String(d.message).substring(0, 150);
    return JSON.stringify(summary);
  }

  async generateAction(context: AgentContext): Promise<AgentAction> {
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
${context.pageState.buttons.map(b => `- "${b.text}" -> selector: ${b.selector}`).join("\n") || "none"}

Visible Inputs:
${context.pageState.inputs.map(i => `- "${i.placeholder || i.text || i.selector}" (value: "${i.value || ""}") -> selector: ${i.selector}`).join("\n") || "none"}

Visible Links:
${context.pageState.links.map(l => `- "${l.text}" -> selector: ${l.selector}`).join("\n") || "none"}

Recent Actions Taken:
${context.recentActions.slice(-5).map(a => `- ${a.type} ${a.target}: ${a.description}`).join("\n") || "none"}

Step Number: ${context.step}

Respond with the next action object.`;

    const actionSchema = {
      type: "object",
      properties: {
        type: { type: "string", enum: ["click", "type", "navigate", "scroll", "wait", "finish"] },
        target: { type: "string" },
        value: { type: "string" },
        description: { type: "string" },
      },
      required: ["type", "target", "description"],
    };

    let response = "";
    try {
      response = await this.generate(prompt, systemPrompt, actionSchema, 150);
    } catch {
      response = await this.generate(prompt, systemPrompt, undefined, 150);
    }

    let action: AgentAction;
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
        timestamp: Date.now(),
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

  async analyzeBug(context: InvestigationContext): Promise<BugAnalysis> {
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
${context.recentActions.map(a => `- ${a.description}`).join("\n") || "none"}

Correlated Network Events:
${context.relevantNetworkEvents.map(e => `- ${e.type}: ${this.summarizeEventData(e.data)}`).join("\n") || "none"}

Correlated Console Errors:
${context.consoleErrors.map(e => `- ${this.summarizeEventData(e.data)}`).join("\n") || "none"}

Exceptions:
${context.exceptions.map(e => `- ${this.summarizeEventData(e.data)}`).join("\n") || "none"}`;

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
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["isBug", "title", "severity", "confidence", "expected", "actual", "rootCause", "evidence"],
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
      const analysis: BugAnalysis = JSON.parse(jsonStr);

      if (typeof analysis.isBug !== "boolean") analysis.isBug = true;
      if (!analysis.title) analysis.title = "Application Failure Detected";
      if (!["low", "medium", "high", "critical"].includes(analysis.severity)) {
        analysis.severity = "high";
      }
      if (typeof analysis.confidence !== "number" || isNaN(analysis.confidence)) {
        analysis.confidence = 0.8;
      }
      if (!analysis.expected) analysis.expected = "Expected normal application flow without server or script errors";
      if (!analysis.actual) analysis.actual = `Observed failure: ${context.suspiciousEvent.type}`;
      if (!analysis.rootCause) analysis.rootCause = "Unknown";
      if (!Array.isArray(analysis.evidence)) analysis.evidence = [];

      return analysis;
    } catch {
      // Conservative fallback preserving browser evidence
      return {
        isBug: true,
        title: `Defect on ${context.suspiciousEvent.type}`,
        severity: "critical",
        confidence: 0.9,
        expected: "Successful execution",
        actual: `Failure event: ${JSON.stringify(context.suspiciousEvent.data)}`,
        rootCause: "Unknown",
        evidence: [JSON.stringify(context.suspiciousEvent.data)],
      };
    }
  }

  async generateFix(context: FixContext): Promise<CodeFix> {
    const systemPrompt = `You are an AI code repair engineer. Given a verified bug report and source code, generate a minimal unified diff patch.

Rules:
1. Only modify files within the provided source code.
2. Produce a valid unified diff (@@ -start,count +start,count @@).
3. Do not invent files or modify unrelated code.`;

    const sourceCodeInfo = context.sourceCode?.length
      ? context.sourceCode.map(f => `=== ${f.path} ===\n${f.content}`).join("\n\n")
      : "No source code available";

    const prompt = `Bug Title: ${context.bug.title}
Severity: ${context.bug.severity}
Expected: ${context.bug.expected}
Actual: ${context.bug.actual}
Root Cause: ${context.bug.rootCause}

Evidence:
${context.evidence.map(e => `- ${e.description}`).join("\n")}

Relevant Source Code:
${sourceCodeInfo}

Provide a code fix with an explanation and unified diff patch.`;

    const fixSchema = {
      type: "object",
      properties: {
        file: { type: "string" },
        explanation: { type: "string" },
        patch: { type: "string" },
      },
      required: ["explanation", "patch"],
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
      const fix: CodeFix = JSON.parse(jsonStr);

      if (!fix.explanation) fix.explanation = "Fix proposed based on observed error evidence.";
      if (!fix.patch) fix.patch = "";
      return fix;
    } catch {
      return {
        explanation: "Fix generation could not produce a valid patch for this incident.",
        patch: "",
      };
    }
  }
}
