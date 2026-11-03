import React, { useState } from "react";
import { clsx } from "clsx";
import { useTestStore } from "../stores/testStore";
import { SeverityBadge } from "../components/SeverityBadge";
import { generateFix, applyFix } from "../api/client";
import type { BugReport, Evidence } from "@agentqa/types";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-error";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
        <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-textMuted">{pct}%</span>
    </div>
  );
}

function EvidenceItem({ ev, onJump }: { ev: Evidence; onJump: () => void }) {
  const typeColors: Record<string, string> = {
    network_response: "border-error/40 bg-error/5",
    network_error: "border-error/40 bg-error/5",
    console_error: "border-warning/40 bg-warning/5",
    exception: "border-orange-400/40 bg-orange-400/5",
    page_error: "border-orange-400/40 bg-orange-400/5",
  };
  const color = typeColors[ev.type] || "border-border bg-surface";
  return (
    <button
      onClick={onJump}
      className={clsx("w-full text-left p-3 rounded-xl border transition-all hover:brightness-110", color)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-mono text-textMuted mb-1">{ev.eventId}</div>
          <div className="text-xs text-text">{ev.description}</div>
        </div>
        <div className="text-xs text-textDim flex-shrink-0 font-mono">
          {new Date(ev.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </button>
  );
}

function BugCard({ bug, isSelected, onClick, onGenerateFix, isGenerating, onApplyFix, isApplying, onGoToReplay }: {
  bug: BugReport;
  isSelected: boolean;
  onClick: () => void;
  onGenerateFix: () => void;
  isGenerating: boolean;
  onApplyFix: () => void;
  isApplying: boolean;
  onGoToReplay: (ts: number) => void;
}) {
  const { setActiveView } = useTestStore();
  return (
    <div
      className={clsx(
        "bg-surface border rounded-2xl transition-all cursor-pointer",
        isSelected ? "border-primary/50 shadow-lg shadow-primary/10" : "border-border hover:border-primary/20"
      )}
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-text leading-snug">{bug.title}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <SeverityBadge severity={bug.severity} />
          </div>
        </div>

        <ConfidenceBar value={bug.confidence} />

        {isSelected && (
          <div className="mt-4 space-y-4 animate-fade-in">
            {/* Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded-xl p-3">
                <div className="text-xs text-textDim mb-1">Expected</div>
                <div className="text-xs text-success">{bug.expected}</div>
              </div>
              <div className="bg-background rounded-xl p-3">
                <div className="text-xs text-textDim mb-1">Actual</div>
                <div className="text-xs text-error">{bug.actual}</div>
              </div>
            </div>

            <div className="bg-background rounded-xl p-3">
              <div className="text-xs text-textDim mb-1">Root Cause</div>
              <div className="text-xs text-text">{bug.rootCause}</div>
            </div>

            {/* Evidence */}
            {bug.evidence.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-2">Evidence</div>
                <div className="space-y-2">
                  {bug.evidence.map(ev => (
                    <EvidenceItem
                      key={ev.eventId}
                      ev={ev}
                      onJump={() => {
                        setActiveView("replay");
                        onGoToReplay(ev.replayTimestamp);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Suggested Fix */}
            {bug.suggestedFix ? (
              <div className="bg-background border border-success/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-success">✓ Suggested Fix</span>
                  {bug.suggestedFix.file && (
                    <span className="text-xs font-mono text-textDim">{bug.suggestedFix.file}</span>
                  )}
                </div>
                <p className="text-xs text-textMuted mb-3">{bug.suggestedFix.explanation}</p>
                {bug.suggestedFix.patch && (
                  <pre className="text-xs font-mono bg-black/40 rounded-lg p-3 overflow-x-auto text-green-400 whitespace-pre-wrap">
                    {bug.suggestedFix.patch}
                  </pre>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard?.writeText(bug.suggestedFix!.patch || "");
                  }}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Copy patch
                </button>
                <div className="mt-4">
                  <button
                    onClick={(e) => { e.stopPropagation(); onApplyFix(); }}
                    disabled={isApplying}
                    className="w-full py-2 rounded-xl bg-success/20 text-success border border-success/30 font-medium
                               hover:bg-success/30 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {isApplying ? "Applying..." : "🛠 Apply Fix to Demo App"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onGenerateFix(); }}
                disabled={isGenerating}
                className="w-full py-2 rounded-xl border border-primary/40 text-primary text-xs font-medium
                           hover:bg-primary/10 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Generating fix...
                  </>
                ) : "✨ Generate Suggested Fix"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function BugReportPage() {
  const { bugs, currentRunId, selectedBugId, setSelectedBugId,
          isGeneratingFix, setIsGeneratingFix, setActiveView, setBugs, currentTest } = useTestStore();
  const [replayTimestamp, setReplayTimestamp] = useState<number>(0);
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null);

  if (!currentRunId) {
    return (
      <div className="text-center text-textMuted py-20">
        <p>No test selected.</p>
        <button onClick={() => setActiveView("new")} className="text-primary text-sm mt-2 hover:underline">Start a test →</button>
      </div>
    );
  }

  if (bugs.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">✅</div>
        <p className="text-text font-semibold">No bugs detected</p>
        <p className="text-textMuted text-sm mt-1">The AI found no issues during the test</p>
      </div>
    );
  }

  const handleGenerateFix = async (bugId: string) => {
    setIsGeneratingFix(true);
    try {
      const res = await generateFix(bugId);
      // Refresh bugs to get the updated one with fix
      const { getBugs } = await import("../api/client");
      const bugsRes = await getBugs(currentRunId);
      if (bugsRes.bugs) setBugs(bugsRes.bugs);
    } catch (e) {
      console.error("Fix generation failed:", e);
    } finally {
      setIsGeneratingFix(false);
    }
  };

  const handleApplyFix = async (bugId: string) => {
    setApplyingFixId(bugId);
    try {
      await applyFix(bugId);
      alert("Fix successfully applied to the demo application!");
      setActiveView("verify");
    } catch (e) {
      console.error("Failed to apply fix:", e);
      alert("Failed to apply fix.");
    } finally {
      setApplyingFixId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text">Bug Report</h2>
          <p className="text-xs text-textMuted">{bugs.length} issue{bugs.length > 1 ? "s" : ""} detected · Run {currentRunId}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView("replay")}
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-textMuted hover:text-text hover:border-primary/30 transition-colors"
          >
            View Replay
          </button>
          <button
            onClick={() => setActiveView("verify")}
            className="text-xs px-3 py-1.5 rounded-lg bg-success/20 text-success border border-success/30 hover:bg-success/30 transition-colors"
          >
            Verify Fix →
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {bugs.map(bug => (
          <BugCard
            key={bug.id}
            bug={bug}
            isSelected={selectedBugId === bug.id}
            onClick={() => setSelectedBugId(selectedBugId === bug.id ? null : bug.id)}
            onGenerateFix={() => handleGenerateFix(bug.id)}
            isGenerating={isGeneratingFix && selectedBugId === bug.id}
            onApplyFix={() => handleApplyFix(bug.id)}
            isApplying={applyingFixId === bug.id}
            onGoToReplay={(ts) => { setReplayTimestamp(ts); setActiveView("replay"); }}
          />
        ))}
      </div>
    </div>
  );
}
