/**
 * Replay Manager - Handles rrweb replay recording and playback
 */

import { ReplayData, ReplayEvent } from "@agentqa/types";
import { StorageManager } from "../storage/StorageManager";

export class ReplayManager {
  private storage: StorageManager;

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  async saveReplay(runId: string, events: ReplayEvent[], metadata: ReplayData["metadata"]): Promise<void> {
    const replay: ReplayData = {
      events,
      metadata,
    };
    await this.storage.setReplay(runId, replay);
  }

  async getReplay(runId: string): Promise<ReplayData | null> {
    return this.storage.getReplay(runId);
  }

  // Convert browser events to rrweb-compatible format for timeline markers
  createTimelineMarkers(events: any[]): Array<{ timestamp: number; type: string; label: string; eventId: string }> {
    const markers: Array<{ timestamp: number; type: string; label: string; eventId: string }> = [];

    for (const event of events) {
      if (this.isSignificantEvent(event)) {
        markers.push({
          timestamp: event.timestamp,
          type: event.type,
          label: this.getEventLabel(event),
          eventId: event.id,
        });
      }
    }

    return markers;
  }

  private isSignificantEvent(event: any): boolean {
    const significantTypes = [
      "network_response",
      "network_error",
      "console_error",
      "page_error",
      "exception",
      "agent_action",
      "navigation",
      "click",
      "input",
    ];
    return significantTypes.includes(event.type);
  }

  private getEventLabel(event: any): string {
    switch (event.type) {
      case "network_response": {
        const data = event.data;
        return `${data.method || "REQ"} ${data.url} → ${data.status}`;
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
        return `${data.action?.type} ${data.action?.target} ${data.success ? "✓" : "✗"}`;
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

  // Get events around a specific timestamp (for jumping to incident)
  getEventsNearTimestamp(replay: ReplayData, timestamp: number, windowMs = 5000): ReplayEvent[] {
    return replay.events.filter(
      e => e.timestamp >= timestamp - windowMs && e.timestamp <= timestamp + windowMs
    );
  }
}