/**
 * Storage Manager - Handles local JSON file storage for test runs
 */

import { mkdir, writeFile, readdir, rm, stat } from "fs/promises";
import { join, dirname } from "path";
import { TestMetadata, BrowserEvent, Incident, BugReport, ReplayData, AgentAction } from "@agentqa/types";

const STORAGE_DIR = process.env.AGENTQA_STORAGE_DIR || join(process.cwd(), ".agentqa/runs");

export class StorageManager {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(STORAGE_DIR, { recursive: true });
    this.initialized = true;
  }

  private getRunDir(runId: string): string {
    return join(STORAGE_DIR, `run-${runId}`);
  }

  private getFilePath(runId: string, filename: string): string {
    return join(this.getRunDir(runId), filename);
  }

  async createTest(metadata: TestMetadata): Promise<void> {
    await this.initialize();
    const runDir = this.getRunDir(metadata.id);
    await mkdir(runDir, { recursive: true });
    await this.writeJson(this.getFilePath(metadata.id, "metadata.json"), metadata);
    await this.writeJson(this.getFilePath(metadata.id, "events.json"), []);
    await this.writeJson(this.getFilePath(metadata.id, "incidents.json"), []);
    await this.writeJson(this.getFilePath(metadata.id, "bugs.json"), []);
    await this.writeJson(this.getFilePath(metadata.id, "actions.json"), []);
  }

  async updateTest(metadata: TestMetadata): Promise<void> {
    await this.writeJson(this.getFilePath(metadata.id, "metadata.json"), metadata);
  }

  async getTest(runId: string): Promise<TestMetadata | null> {
    try {
      const file = Bun.file(this.getFilePath(runId, "metadata.json"));
      if (!(await file.exists())) return null;
      const test: TestMetadata = await file.json();
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

  async listTests(): Promise<TestMetadata[]> {
    await this.initialize();
    try {
      const entries = await readdir(STORAGE_DIR);
      const tests: TestMetadata[] = [];
      for (const entry of entries) {
        if (entry.startsWith("run-")) {
          const runId = entry.slice(4);
          const test = await this.getTest(runId);
          if (test) tests.push(test);
        }
      }
      return tests.sort((a, b) => b.startTime - a.startTime);
    } catch {
      return [];
    }
  }

  private eventWriteQueues: Map<string, Promise<void>> = new Map();

  async appendEvent(runId: string, event: BrowserEvent): Promise<void> {
    const prev = this.eventWriteQueues.get(runId) || Promise.resolve();
    const next = prev.then(async () => {
      const events = await this.getEvents(runId);
      events.push(event);
      await this.writeJson(this.getFilePath(runId, "events.json"), events);
    }).catch(err => {
      console.error("[storage] appendEvent error:", err);
    });
    this.eventWriteQueues.set(runId, next);
    await next;
  }

  async setEvents(runId: string, events: BrowserEvent[]): Promise<void> {
    await this.writeJson(this.getFilePath(runId, "events.json"), events);
  }

  async getEvents(runId: string): Promise<BrowserEvent[]> {
    try {
      const file = Bun.file(this.getFilePath(runId, "events.json"));
      if (!(await file.exists())) return [];
      return await file.json();
    } catch {
      return [];
    }
  }

  async appendAction(runId: string, action: AgentAction): Promise<void> {
    const actions = await this.getActions(runId);
    actions.push(action);
    await this.writeJson(this.getFilePath(runId, "actions.json"), actions);
  }

  async getActions(runId: string): Promise<AgentAction[]> {
    try {
      const file = Bun.file(this.getFilePath(runId, "actions.json"));
      if (!(await file.exists())) return [];
      return await file.json();
    } catch {
      return [];
    }
  }

  async setIncidents(runId: string, incidents: Incident[]): Promise<void> {
    await this.writeJson(this.getFilePath(runId, "incidents.json"), incidents);
  }

  async getIncidents(runId: string): Promise<Incident[]> {
    try {
      const file = Bun.file(this.getFilePath(runId, "incidents.json"));
      if (!(await file.exists())) return [];
      return await file.json();
    } catch {
      return [];
    }
  }

  async setBugs(runId: string, bugs: BugReport[]): Promise<void> {
    await this.writeJson(this.getFilePath(runId, "bugs.json"), bugs);
  }

  async getBugs(runId: string): Promise<BugReport[]> {
    try {
      const file = Bun.file(this.getFilePath(runId, "bugs.json"));
      if (!(await file.exists())) return [];
      return await file.json();
    } catch {
      return [];
    }
  }

  async setReplay(runId: string, replay: ReplayData): Promise<void> {
    await this.writeJson(this.getFilePath(runId, "replay.json"), replay);
  }

  async getReplay(runId: string): Promise<ReplayData | null> {
    try {
      const file = Bun.file(this.getFilePath(runId, "replay.json"));
      if (!(await file.exists())) return null;
      return await file.json();
    } catch {
      return null;
    }
  }

  async setVerification(runId: string, verification: TestMetadata["verificationStatus"]): Promise<void> {
    const metadata = await this.getTest(runId);
    if (metadata) {
      metadata.verificationStatus = verification;
      await this.updateTest(metadata);
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2));
  }

  async cleanupOldRuns(maxAgeMs: number): Promise<number> {
    await this.initialize();
    let cleaned = 0;
    const now = Date.now();

    try {
      const entries = await readdir(STORAGE_DIR);
      for (const entry of entries) {
        if (entry.startsWith("run-")) {
          const runDir = join(STORAGE_DIR, entry);
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

  async deleteRun(runId: string): Promise<void> {
    const runDir = this.getRunDir(runId);
    await rm(runDir, { recursive: true, force: true });
  }
}
