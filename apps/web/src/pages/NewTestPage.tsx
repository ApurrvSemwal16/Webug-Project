import React, { useState, useEffect } from "react";
import { createTest, listTests } from "../api/client";
import { useTestStore } from "../stores/testStore";
import { StatusBadge } from "../components/StatusBadge";

const DEMO_URL = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "http://demo-app:3000";
const DEMO_GOAL = "Test the checkout flow and coupon validation";

export function NewTestPage() {
  const { setCurrentRunId, setActiveView, setCurrentTest, clearLiveEvents, setBugs,
          setVerificationStatus, testHistory, setTestHistory } = useTestStore();
  const [url, setUrl] = useState(DEMO_URL);
  const [goal, setGoal] = useState(DEMO_GOAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTests().then(r => { if (r.tests) setTestHistory(r.tests); }).catch(() => {});
  }, []);

  const handleStart = async () => {
    if (!url.trim() || !goal.trim()) {
      setError("URL and goal are required");
      return;
    }
    setError(null);
    setLoading(true);
    clearLiveEvents();
    setBugs([]);
    setVerificationStatus(null);
    try {
      const result = await createTest({ url: url.trim(), goal: goal.trim() });
      setCurrentRunId(result.test.id);
      setCurrentTest(result.test);
      setActiveView("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start test");
    } finally {
      setLoading(false);
    }
  };

  const loadTest = async (runId: string) => {
    const { getTest: fetchTest, getBugs: fetchBugs } = await import("../api/client");
    try {
      const [testRes, bugsRes] = await Promise.all([fetchTest(runId), fetchBugs(runId)]);
      setCurrentRunId(runId);
      setCurrentTest(testRes.test);
      if (bugsRes.bugs) setBugs(bugsRes.bugs);
      clearLiveEvents();
      setVerificationStatus(testRes.test?.verificationStatus || null);
      setActiveView(bugsRes.bugs?.length > 0 ? "report" : "live");
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-medium mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Local-first AI QA Agent
        </div>
        <h1 className="text-3xl font-bold text-text mb-3">
          Find bugs <span className="gradient-text">automatically</span>
        </h1>
        <p className="text-textMuted text-sm max-w-md mx-auto">
          WeBug uses AI to explore your web app, detect failures, generate bug reports, and verify fixes - all locally.
        </p>
      </div>

      {/* Form Card */}
      <div className="bg-surface border border-border rounded-2xl p-6 mb-6">
        <h2 className="text-sm font-semibold text-text mb-5 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center text-primary">
            <svg width="12" height="12" fill="none" viewBox="0 0 12 12">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </span>
          New Test
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-textMuted mb-1.5">
              Target URL
            </label>
            <input
              id="test-url"
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-text placeholder-textDim
                         focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-textMuted mb-1.5">
              Testing Goal
            </label>
            <textarea
              id="test-goal"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              rows={3}
              placeholder="Test the checkout flow and coupon validation"
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-text placeholder-textDim
                         focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-none"
            />
          </div>

          {error && (
            <div className="text-xs text-error bg-error/10 border border-error/30 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          <button
            id="start-test-btn"
            onClick={handleStart}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-sm text-white
                       bg-gradient-to-r from-primary to-secondary
                       hover:from-primaryHover hover:to-secondary
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all transform hover:scale-[1.01] active:scale-[0.99]
                       shadow-lg shadow-primary/20"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Starting...
              </span>
            ) : "Start Test →"}
          </button>
        </div>
      </div>

      {/* Demo shortcut */}
      <div className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-2xl p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-base">🎬</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text mb-1">Demo Mode</h3>
            <p className="text-xs text-textMuted mb-3">
              Run the pre-configured demo that tests the coupon checkout flow. WeBug will detect the intentional HTTP 500 bug.
            </p>
            <button
              id="run-demo-btn"
              onClick={() => {
                setUrl(DEMO_URL);
                setGoal(DEMO_GOAL);
                setTimeout(handleStart, 100);
              }}
              disabled={loading}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/20 text-primary
                         hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              Run Demo →
            </button>
          </div>
        </div>
      </div>

      {/* Recent tests */}
      {testHistory.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-3">Recent Tests</h3>
          <div className="space-y-2">
            {testHistory.slice(0, 5).map(t => (
              <button
                key={t.id}
                onClick={() => loadTest(t.id)}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-surface border border-border
                           hover:border-primary/30 hover:bg-surfaceHover transition-all text-left group"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-text truncate">{t.goal}</div>
                  <div className="text-xs text-textDim font-mono truncate">{t.url}</div>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <StatusBadge status={t.status} size="sm" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
