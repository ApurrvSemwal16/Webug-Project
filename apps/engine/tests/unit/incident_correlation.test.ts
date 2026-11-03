import { describe, test, expect, beforeEach } from "bun:test";
import { IncidentEngine } from "../../src/incidents/IncidentEngine";
import { StorageManager } from "../../src/storage/StorageManager";
import { BrowserEvent } from "@agentqa/types";

describe("IncidentEngine - Failure Correlation and Grouping", () => {
  let storage: StorageManager;
  let incidentEngine: IncidentEngine;

  beforeEach(async () => {
    storage = new StorageManager();
    await storage.initialize();
    incidentEngine = new IncidentEngine(storage);
  });

  test("Correlates HTTP 500 response, network error, and console error into a single incident", async () => {
    const runId = "test-corr-1-" + Date.now();
    const timestamp = Date.now();

    const netResponseEvent: BrowserEvent = {
      id: "ev-1",
      runId,
      timestamp,
      type: "network_response",
      data: {
        url: "http://localhost:3000/api/coupon",
        method: "POST",
        status: 500,
        statusText: "Internal Server Error",
      },
    };

    const netErrorEvent: BrowserEvent = {
      id: "ev-2",
      runId,
      timestamp: timestamp + 10,
      type: "network_error",
      data: {
        url: "http://localhost:3000/api/coupon",
        error: "net::ERR_HTTP_RESPONSE_CODE_FAILURE",
      },
    };

    const consoleErrorEvent: BrowserEvent = {
      id: "ev-3",
      runId,
      timestamp: timestamp + 20,
      type: "console_error",
      data: {
        text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error) at http://localhost:3000/api/coupon",
      },
    };

    await incidentEngine.processEvent(runId, netResponseEvent);
    await incidentEngine.processEvent(runId, netErrorEvent);
    await incidentEngine.processEvent(runId, consoleErrorEvent);
    await incidentEngine.finalizeAll(runId);

    const incidents = await incidentEngine.getIncidents(runId);

    // One underlying failure MUST correlate into one logical incident
    expect(incidents.length).toBe(1);

    const incident = incidents[0];
    expect(incident.severity).toBe("critical");
    expect(incident.eventIds.length).toBe(3);
    expect(incident.eventIds).toContain("ev-1");
    expect(incident.eventIds).toContain("ev-2");
    expect(incident.eventIds).toContain("ev-3");
  });

  test("Maintains distinct incidents for distinct unrelated failures", async () => {
    const runId = "test-corr-2-" + Date.now();
    const timestamp = Date.now();

    const couponError: BrowserEvent = {
      id: "ev-coupon",
      runId,
      timestamp,
      type: "network_response",
      data: {
        url: "http://localhost:3000/api/coupon",
        method: "POST",
        status: 500,
      },
    };

    const checkoutError: BrowserEvent = {
      id: "ev-checkout",
      runId,
      timestamp: timestamp + 50,
      type: "network_response",
      data: {
        url: "http://localhost:3000/api/checkout",
        method: "POST",
        status: 502,
      },
    };

    await incidentEngine.processEvent(runId, couponError);
    await incidentEngine.processEvent(runId, checkoutError);
    await incidentEngine.finalizeAll(runId);

    const incidents = await incidentEngine.getIncidents(runId);
    expect(incidents.length).toBe(2);
  });
});
