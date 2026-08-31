/**
 * Event Collector - Collects and filters browser events
 */

import { BrowserEvent, EventType } from "@agentqa/types";
import { IncidentEngine } from "../incidents/IncidentEngine";
import { TestManager } from "../test/TestManager";

type EventCallback = (event: BrowserEvent) => void;

export class EventCollector {
  private events: BrowserEvent[] = [];
  private callbacks: EventCallback[] = [];
  private incidentEngine: IncidentEngine | null = null;
  private testManager: TestManager | null = null;
  private runId: string | null = null;

  setRunId(runId: string): void {
    this.runId = runId;
  }

  setIncidentEngine(engine: IncidentEngine): void {
    this.incidentEngine = engine;
  }

  setTestManager(manager: TestManager): void {
    this.testManager = manager;
  }

  subscribe(callback: EventCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) this.callbacks.splice(index, 1);
    };
  }

  collect(event: BrowserEvent): void {
    // Add to local storage
    this.events.push(event);

    // Filter: determine if this event is suspicious
    const isSuspicious = this.isSuspiciousEvent(event);

    // Notify subscribers
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("[events] Callback error:", error);
      }
    }

    // If suspicious and we have an incident engine, process it
    if (isSuspicious && this.incidentEngine && this.runId) {
      this.incidentEngine.processEvent(this.runId, event).catch(err => {
        console.error("[events] Incident processing error:", err);
      });
    }
  }

  private isSuspiciousEvent(event: BrowserEvent): boolean {
    switch (event.type) {
      case "network_response": {
        const data = event.data as any;
        return data.status >= 400;
      }
      case "network_error":
      case "console_error":
      case "page_error":
      case "exception":
      case "timeout":
        return true;
      case "agent_action": {
        const data = event.data as any;
        return !data.success;
      }
      default:
        return false;
    }
  }

  getEvents(): BrowserEvent[] {
    return [...this.events];
  }

  getEventsByType(type: EventType): BrowserEvent[] {
    return this.events.filter(e => e.type === type);
  }

  getSuspiciousEvents(): BrowserEvent[] {
    return this.events.filter(e => this.isSuspiciousEvent(e));
  }

  clear(): void {
    this.events = [];
  }

  getEventCount(): number {
    return this.events.length;
  }
}