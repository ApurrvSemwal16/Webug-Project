/**
 * Incident Engine - Groups related failures into incidents
 */

import { BrowserEvent, Incident, IncidentSeverity, EventType } from "@agentqa/types";
import { StorageManager } from "../storage/StorageManager";
import { nanoid } from "nanoid";

interface PendingIncident {
  eventIds: string[];
  firstTimestamp: number;
  lastTimestamp: number;
  severity: IncidentSeverity;
  url: string;
  relatedActions: string[];
  description: string;
}

export class IncidentEngine {
  private storage: StorageManager;
  private pendingIncidents: Map<string, PendingIncident> = new Map();
  private incidentTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private finalizedIncidents: Map<string, Incident[]> = new Map();

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  async processEvent(runId: string, event: BrowserEvent): Promise<void> {
    // Determine if this event should start or join an incident
    const incidentKey = this.getIncidentKey(event);
    if (!incidentKey) return;

    let pending = this.pendingIncidents.get(incidentKey);

    if (!pending) {
      // Create new pending incident
      pending = {
        eventIds: [event.id],
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp,
        severity: this.getEventSeverity(event),
        url: this.extractUrl(event),
        relatedActions: [],
        description: this.generateDescription(event),
      };
      this.pendingIncidents.set(incidentKey, pending);
    } else {
      // Add to existing pending incident
      pending.eventIds.push(event.id);
      pending.lastTimestamp = event.timestamp;
      pending.severity = this.maxSeverity(pending.severity, this.getEventSeverity(event));
      pending.description = this.generateDescription(event);
    }

    // Reset debounce timer
    this.resetIncidentTimer(runId, incidentKey, pending);
  }

  private normalizePath(rawUrl: string): string {
    try {
      const u = new URL(rawUrl);
      return u.pathname;
    } catch {
      return (rawUrl || "").split("?")[0];
    }
  }

  private getIncidentKey(event: BrowserEvent): string | null {
    switch (event.type) {
      case "network_response": {
        const data = event.data as any;
        if (data.status >= 400) {
          const path = this.normalizePath(data.url);
          return "failure:url:" + path;
        }
        return null;
      }
      case "network_error": {
        const data = event.data as any;
        const path = this.normalizePath(data.url);
        return "failure:url:" + path;
      }
      case "console_error": {
        const data = event.data as any;
        const text = String(data.text || "");
        const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) {
          const path = this.normalizePath(urlMatch[0]);
          return "failure:url:" + path;
        }
        // If console error occurs within 5s of an active network failure, correlate to that incident
        for (const [key, pending] of this.pendingIncidents.entries()) {
          if (key.startsWith("failure:url:") && event.timestamp - pending.lastTimestamp < 5000) {
            return key;
          }
        }
        return "failure:console:" + text.substring(0, 80);
      }
      case "page_error":
      case "exception": {
        const data = event.data as any;
        const message = String(data.message || "").substring(0, 80);
        return "failure:exception:" + message;
      }
      case "agent_action": {
        const data = event.data as any;
        if (!data.success) {
          return "failure:action:" + (data.action?.target || "unknown");
        }
        return null;
      }
      case "timeout": {
        const data = event.data as any;
        return "failure:timeout:" + (data.action?.target || "unknown");
      }
      default:
        return null;
    }
  }

  private getEventSeverity(event: BrowserEvent): IncidentSeverity {
    switch (event.type) {
      case "network_response": {
        const data = event.data as any;
        if (data.status >= 500) return "critical";
        if (data.status >= 400) return "high";
        return "low";
      }
      case "network_error":
      case "page_error":
      case "exception":
        return "critical";
      case "console_error":
        return "high";
      case "agent_action": {
        const data = event.data as any;
        return data.success ? "low" : "medium";
      }
      case "timeout":
        return "high";
      default:
        return "low";
    }
  }

  private extractUrl(event: BrowserEvent): string {
    switch (event.type) {
      case "network_response":
      case "network_error":
        return (event.data as any).url || "unknown";
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

  private generateDescription(event: BrowserEvent): string {
    switch (event.type) {
      case "network_response": {
        const data = event.data as any;
        return `${data.method || "REQUEST"} ${data.url} → ${data.status} ${data.statusText}`;
      }
      case "network_error": {
        const data = event.data as any;
        return `Network error: ${data.url} - ${data.error || "Unknown"}`;
      }
      case "console_error": {
        const data = event.data as any;
        return `Console error: ${data.text?.substring(0, 100)}`;
      }
      case "page_error": {
        const data = event.data as any;
        return `Page error: ${data.message?.substring(0, 100)}`;
      }
      case "exception": {
        const data = event.data as any;
        return `JavaScript exception: ${data.message?.substring(0, 100)}`;
      }
      case "agent_action": {
        const data = event.data as any;
        return `Action failed: ${data.action?.type} ${data.action?.target} - ${data.error}`;
      }
      case "timeout": {
        const data = event.data as any;
        return `Timeout: ${data.action?.type} ${data.action?.target}`;
      }
      default:
        return `Event: ${event.type}`;
    }
  }

  private maxSeverity(a: IncidentSeverity, b: IncidentSeverity): IncidentSeverity {
    const order: IncidentSeverity[] = ["low", "medium", "high", "critical"];
    return order.indexOf(a) > order.indexOf(b) ? a : b;
  }

  private resetIncidentTimer(runId: string, incidentKey: string, pending: PendingIncident): void {
    // Clear existing timer
    const existingTimer = this.incidentTimeouts.get(incidentKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer - finalize incident after 2 seconds of no new related events
    const timer = setTimeout(async () => {
      await this.finalizeIncident(runId, incidentKey);
    }, 2000);

    this.incidentTimeouts.set(incidentKey, timer);
  }

  private async finalizeIncident(runId: string, incidentKey: string): Promise<void> {
    const pending = this.pendingIncidents.get(incidentKey);
    if (!pending) return;

    // Remove from pending
    this.pendingIncidents.delete(incidentKey);
    this.incidentTimeouts.delete(incidentKey);

    // Create incident
    const incident: Incident = {
      id: nanoid(8),
      runId,
      eventIds: pending.eventIds,
      firstTimestamp: pending.firstTimestamp,
      lastTimestamp: pending.lastTimestamp,
      severity: pending.severity,
      url: pending.url,
      relatedActions: pending.relatedActions,
      description: pending.description,
      investigated: false,
    };

    // Save incident to in-memory map and persist
    let list = this.finalizedIncidents.get(runId);
    if (!list) {
      list = await this.storage.getIncidents(runId);
      this.finalizedIncidents.set(runId, list);
    }
    list.push(incident);
    await this.storage.setIncidents(runId, list);

    console.log(`[incidents] Created incident ${incident.id}: ${incident.description} (${incident.severity})`);
  }

  async finalizeAll(runId: string): Promise<void> {
    // Finalize all pending incidents
    for (const incidentKey of this.pendingIncidents.keys()) {
      await this.finalizeIncident(runId, incidentKey);
    }
  }

  async getIncidents(runId: string): Promise<Incident[]> {
    const mem = this.finalizedIncidents.get(runId);
    if (mem && mem.length > 0) return [...mem];
    const loaded = await this.storage.getIncidents(runId);
    this.finalizedIncidents.set(runId, loaded);
    return loaded;
  }

  async markInvestigated(runId: string, incidentId: string): Promise<void> {
    const incidents = await this.getIncidents(runId);
    const incident = incidents.find(i => i.id === incidentId);
    if (incident) {
      incident.investigated = true;
      this.finalizedIncidents.set(runId, incidents);
      await this.storage.setIncidents(runId, incidents);
    }
  }
}