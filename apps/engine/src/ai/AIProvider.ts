/**
 * AI Provider Interface and Ollama Implementation
 */

import { AIProvider, AgentContext, AgentAction, InvestigationContext, BugAnalysis, FixContext, CodeFix } from "@agentqa/types";

export class OllamaProvider implements AIProvider {
  private baseUrl: string;
  private model: string;
  private timeout: number;

  constructor(baseUrl: string, model: string, timeout = 60000) {
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

  private async generate(prompt: string, systemPrompt?: string, jsonMode = false): Promise<string> {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const body: any = {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: 0.1,
        top_p: 0.9,
      },
    };

    if (jsonMode) {
      body.format = "json";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return data.message?.content || "";
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("AI request timeout");
      }
      throw error;
    }
  }

  async generateAction(context: AgentContext): Promise<AgentAction> {
    const systemPrompt = `You are an AI QA agent testing a web application. Your job is to decide the next action to take based on the testing goal and current page state.

Allowed actions:
- click: Click on an element (button, link, etc.)
- type: Type text into an input field
- navigate: Navigate to a URL
- scroll: Scroll the page (up, down, top, bottom)
- wait: Wait for a condition or time
- finish: Indicate the test goal is complete

Respond with ONLY a JSON object in this format:
{
  "type": "click|type|navigate|scroll|wait|finish",
  "target": "element description or URL",
  "value": "optional value for type/scroll/wait",
  "description": "human-readable description of the action"
}

Rules:
1. Target must match visible elements from the page state
2. Be specific - use button text, link text, input placeholder/label
3. For type actions, include the value to type
4. For wait, specify milliseconds or "networkidle"
5. Only use finish when the goal is genuinely complete`;

    const prompt = `Testing Goal: ${context.goal}

Current Page:
URL: ${context.pageState.url}
Title: ${context.pageState.title}

Interactive Elements:
Buttons: ${context.pageState.buttons.map(b => `"${b.text}" (${b.selector})`).join(", ") || "none"}
Inputs: ${context.pageState.inputs.map(i => `"${i.placeholder || i.text || i.selector}" (${i.selector})`).join(", ") || "none"}
Links: ${context.pageState.links.map(l => `"${l.text}" (${l.selector})`).join(", ") || "none"}

Recent Actions:
${context.recentActions.slice(-5).map(a => `- ${a.description}`).join("\n") || "none"}

Step: ${context.step}

What is the next action to achieve the goal?`;

    let response: string;
    try {
      response = await this.generate(prompt, systemPrompt, true);
    } catch (error) {
      // Fallback: try without json mode
      response = await this.generate(prompt, systemPrompt, false);
    }

    // Parse JSON response
    let action: AgentAction;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      action = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("[ai] Failed to parse action response:", response);
      throw new Error(`Invalid AI response format: ${response}`);
    }

    // Validate action
    if (!action.type || !["click", "type", "navigate", "scroll", "wait", "finish"].includes(action.type)) {
      throw new Error(`Invalid action type: ${action.type}`);
    }
    if (!action.target) {
      throw new Error("Action missing target");
    }
    if (!action.description) {
      action.description = `${action.type} ${action.target}`;
    }
    if (!action.timestamp) {
      action.timestamp = Date.now();
    }

    return action;
  }

  async analyzeBug(context: InvestigationContext): Promise<BugAnalysis> {
    const systemPrompt = `You are an AI bug investigator. Analyze the provided evidence and determine if there's a real bug.

Respond with ONLY a JSON object in this format:
{
  "isBug": true|false,
  "title": "Brief bug title",
  "severity": "low|medium|high|critical",
  "confidence": 0.0-1.0,
  "expected": "What should have happened",
  "actual": "What actually happened",
  "rootCause": "Likely root cause",
  "evidence": ["evidence1", "evidence2"]
}

Rules:
1. Only report bugs with actual evidence from browser events
2. isBug=false if the behavior seems expected or evidence is insufficient
3. Be conservative - don't invent bugs
4. Reference specific events (network errors, exceptions, etc.)`;

    const prompt = `Testing Goal: ${context.goal}
Current URL: ${context.currentUrl}

Recent Actions:
${context.recentActions.map(a => `- ${a.description}`).join("\n")}

Suspicious Event:
Type: ${context.suspiciousEvent.type}
Data: ${JSON.stringify(context.suspiciousEvent.data, null, 2)}
Timestamp: ${new Date(context.suspiciousEvent.timestamp).toISOString()}

Relevant Network Events:
${context.relevantNetworkEvents.map(e => `- ${e.type}: ${JSON.stringify(e.data)}`).join("\n") || "none"}

Console Errors:
${context.consoleErrors.map(e => `- ${JSON.stringify(e.data)}`).join("\n") || "none"}

JavaScript Exceptions:
${context.exceptions.map(e => `- ${JSON.stringify(e.data)}`).join("\n") || "none"}

Visible Elements:
Buttons: ${context.visibleElements.buttons.map(b => b.text).join(", ") || "none"}
Inputs: ${context.visibleElements.inputs.map(i => i.placeholder || i.text || i.selector).join(", ") || "none"}

Is this a bug? Analyze the evidence.`;

    let response: string;
    try {
      response = await this.generate(prompt, systemPrompt, true);
    } catch (error) {
      response = await this.generate(prompt, systemPrompt, false);
    }

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const analysis = JSON.parse(jsonStr);

      // Validate required fields
      if (typeof analysis.isBug !== "boolean") throw new Error("Missing isBug");
      if (!analysis.title) throw new Error("Missing title");
      if (!["low", "medium", "high", "critical"].includes(analysis.severity)) {
        analysis.severity = "medium";
      }
      if (typeof analysis.confidence !== "number") analysis.confidence = 0.5;
      if (!analysis.expected) analysis.expected = "Unknown";
      if (!analysis.actual) analysis.actual = "Unknown";
      if (!analysis.rootCause) analysis.rootCause = "Unknown";
      if (!Array.isArray(analysis.evidence)) analysis.evidence = [];

      return analysis;
    } catch (parseError) {
      console.error("[ai] Failed to parse bug analysis:", response);
      throw new Error(`Invalid AI analysis format: ${response}`);
    }
  }

  async generateFix(context: FixContext): Promise<CodeFix> {
    const systemPrompt = `You are an AI code fixer. Given a bug report and relevant source code, generate a minimal fix.

Respond with ONLY a JSON object in this format:
{
  "file": "path/to/file.js",
  "explanation": "What the bug is and how the fix addresses it",
  "patch": "Unified diff format patch"
}

Rules:
1. Only modify the specific file related to the bug
2. Make minimal, focused changes
3. Use unified diff format (@@ -line,count +line,count @@)
4. Don't modify unrelated code
5. If no source code available, provide explanation only`;

    const sourceCodeInfo = context.sourceCode?.length
      ? context.sourceCode.map(f => `=== ${f.path} ===\n${f.content}`).join("\n\n")
      : "No source code available";

    const prompt = `Bug Report:
Title: ${context.bug.title}
Severity: ${context.bug.severity}
Expected: ${context.bug.expected}
Actual: ${context.bug.actual}
Root Cause: ${context.bug.rootCause}

Evidence:
${context.evidence.map(e => `- ${e.description} (${e.type})`).join("\n")}

Relevant Source Code:
${sourceCodeInfo}

Generate a fix for this bug.`;

    let response: string;
    try {
      response = await this.generate(prompt, systemPrompt, true);
    } catch (error) {
      response = await this.generate(prompt, systemPrompt, false);
    }

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const fix = JSON.parse(jsonStr);

      if (!fix.explanation) fix.explanation = "No explanation provided";
      if (!fix.patch) fix.patch = "";
      if (!fix.file) fix.file = undefined;

      return fix;
    } catch (parseError) {
      console.error("[ai] Failed to parse fix response:", response);
      throw new Error(`Invalid AI fix format: ${response}`);
    }
  }
}