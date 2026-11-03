import React, { useEffect } from "react";
import { clsx } from "clsx";
import { useTestStore } from "../stores/testStore";
import { useSSE } from "../hooks/useSSE";
import { StatusBadge } from "../components/StatusBadge";
import { EventTimeline } from "../components/EventTimeline";
import { stopTest, getTest } from "../api/client";

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function LiveTestPage() {
  const { currentRunId, currentTest, liveEvents, setCurrentTest, setActiveView, bugs } = useTestStore();
  useSSE(currentRunId);

  // Refresh test metadata every 3s while running
  useEffect(() => {
    if (!currentRunId || !currentTest) return;
    if (["COMPLETED","FAILED","STOPPED"].includes(currentTest.status)) return;
    const t = setInterval(async () => {
      try {
        const res = await getTest(currentRunId);
        if (res.test) setCurrentTest(res.test);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [currentRunId, currentTest?.status]);

  if (!currentRunId || !currentTest) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-textMuted">
        <p>No active test. Start a test first.</p>
        <button onClick={() => setActiveView("new")} className="mt-3 text-primary text-sm hover:underline">
          New Test →
        </button>
      </div>
    );
  }

  const isRunning = ["STARTING","RUNNING","INVESTIGATING"].includes(currentTest.status);
  const duration = currentTest.endTime
    ? formatDuration(currentTest.endTime - currentTest.startTime)
    : formatDuration(Date.now() - currentTest.startTime);

  const _actionEvs = liveEvents.filter(e => e.type === "agent_action"); const recentAction = _actionEvs[_actionEvs.length - 1];
  const _navEvs = liveEvents.filter(e => e.type === "navigation"); const currentUrl = (_navEvs[_navEvs.length - 1]?.data as Record<string,string>)?.url || currentTest.url;

  const steps = liveEvents.filter(e => ["navigation","agent_action","bug_found","incident_detected"].includes(e.type));

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Status bar */}
      <div className="bg-surface border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-text text-sm mb-1 truncate max-w-lg">
              {currentTest.goal}
            </h2>
            <p className="text-xs text-textDim font-mono truncate">{currentUrl}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={currentTest.status} />
            {isRunning && (
              <button
                onClick={() => stopTest(currentRunId)}
                className="text-xs px-3 py-1.5 rounded-lg border border-error/40 text-error hover:bg-error/10 transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Duration", value: duration },
            { label: "Events", value: liveEvents.length },
            { label: "Bugs Found", value: bugs.length, accent: bugs.length > 0 },
            { label: "Status", value: currentTest.status },
          ].map(stat => (
            <div key={stat.label} className="bg-background rounded-xl p-3">
              <div className="text-xs text-textDim mb-1">{stat.label}</div>
              <div className={clsx("text-sm font-semibold font-mono", stat.accent ? "text-error" : "text-text")}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Agent steps */}
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-4">
            Agent Progress
          </h3>
          {steps.length === 0 ? (
            <div className="flex items-center gap-2 text-textDim text-sm">
              {isRunning && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
              {isRunning ? "Agent starting..." : "No steps recorded"}
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {steps.map((ev, i) => {
                const d = ev.data as Record<string, unknown>;
                const isError = ev.type === "bug_found" || ev.type === "incident_detected";
                const isDone = i === steps.length - 1 && !isRunning;
                const isActive = i === steps.length - 1 && isRunning;
                let label = "";
                if (ev.type === "navigation") label = `🌐 ${d.url}`;
                else if (ev.type === "agent_action") {
                  const a = d.action as Record<string,unknown>;
                  label = a ? String(a.description || `${a.type} ${a.target}`) : "Action";
                }
                else if (ev.type === "bug_found") label = `🐛 Bug: ${d.title}`;
                else if (ev.type === "incident_detected") label = `⚠️ ${d.description}`;
                return (
                  <div key={i} className={clsx("flex items-center gap-2 text-xs py-1",
                    isError ? "text-error" : isActive ? "text-primary" : isDone ? "text-success" : "text-textMuted"
                  )}>
                    <span className="font-bold flex-shrink-0">{isActive ? "→" : isDone ? "✓" : isError ? "✗" : "✓"}</span>
                    <span className="truncate">{label || ev.type}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live events feed */}
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-4">
            Event Feed
          </h3>
          <EventTimeline events={liveEvents} maxHeight="256px" />
        </div>
      </div>

      {/* Action footer */}
      {currentTest.status === "COMPLETED" && bugs.length > 0 && (
        <div className="bg-gradient-to-r from-error/5 to-orange-400/5 border border-error/30 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text">{bugs.length} bug{bugs.length > 1 ? "s" : ""} detected</p>
            <p className="text-xs text-textMuted">View the full bug report and generate a fix</p>
          </div>
          <button
            onClick={() => setActiveView("report")}
            className="px-4 py-2 rounded-xl bg-error text-white text-sm font-medium hover:bg-error/80 transition-colors"
          >
            View Report →
          </button>
        </div>
      )}

      {currentTest.status === "COMPLETED" && bugs.length === 0 && (
        <div className="bg-success/5 border border-success/30 rounded-2xl p-5 text-center">
          <p className="text-success font-semibold">✓ No bugs detected</p>
          <p className="text-xs text-textMuted mt-1">The testing goal completed without errors</p>
        </div>
      )}
    </div>
  );
}
