import { create } from "zustand";
import type { TestMetadata, BrowserEvent, BugReport, VerificationStatus } from "@agentqa/types";

export interface LiveEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface TestState {
  // Current test
  currentRunId: string | null;
  currentTest: TestMetadata | null;
  liveEvents: LiveEvent[];
  bugs: BugReport[];
  verificationStatus: VerificationStatus | null;

  // All tests history
  testHistory: TestMetadata[];

  // UI State
  activeView: "new" | "live" | "report" | "replay" | "verify";
  selectedBugId: string | null;
  isGeneratingFix: boolean;
  isVerifying: boolean;

  // Actions
  setCurrentRunId: (id: string | null) => void;
  setCurrentTest: (test: TestMetadata | null) => void;
  addLiveEvent: (event: LiveEvent) => void;
  clearLiveEvents: () => void;
  setBugs: (bugs: BugReport[]) => void;
  setVerificationStatus: (status: VerificationStatus | null) => void;
  setTestHistory: (tests: TestMetadata[]) => void;
  setActiveView: (view: TestState["activeView"]) => void;
  setSelectedBugId: (id: string | null) => void;
  setIsGeneratingFix: (v: boolean) => void;
  setIsVerifying: (v: boolean) => void;
  reset: () => void;
}

export const useTestStore = create<TestState>((set) => ({
  currentRunId: null,
  currentTest: null,
  liveEvents: [],
  bugs: [],
  verificationStatus: null,
  testHistory: [],
  activeView: "new",
  selectedBugId: null,
  isGeneratingFix: false,
  isVerifying: false,

  setCurrentRunId: (id) => set({ currentRunId: id }),
  setCurrentTest: (test) => set({ currentTest: test }),
  addLiveEvent: (event) => set((s) => ({ liveEvents: [...s.liveEvents.slice(-200), event] })),
  clearLiveEvents: () => set({ liveEvents: [] }),
  setBugs: (bugs) => set({ bugs }),
  setVerificationStatus: (status) => set({ verificationStatus: status }),
  setTestHistory: (tests) => set({ testHistory: tests }),
  setActiveView: (view) => set({ activeView: view }),
  setSelectedBugId: (id) => set({ selectedBugId: id }),
  setIsGeneratingFix: (v) => set({ isGeneratingFix: v }),
  setIsVerifying: (v) => set({ isVerifying: v }),
  reset: () => set({
    currentRunId: null,
    currentTest: null,
    liveEvents: [],
    bugs: [],
    verificationStatus: null,
    activeView: "new",
    selectedBugId: null,
    isGeneratingFix: false,
    isVerifying: false,
  }),
}));
