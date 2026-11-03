import React from "react";
import { clsx } from "clsx";
import { useTestStore } from "../stores/testStore";
import { verifyFix } from "../api/client";

function CompareRow({ label, before, after, improved }: {
  label: string; before: string; after: string; improved: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 items-center">
      <div className="text-xs text-textMuted">{label}</div>
      <div className={clsx("text-xs px-3 py-2 rounded-lg text-center font-mono", "bg-error/10 text-error border border-error/20")}>
        {before}
      </div>
      <div className={clsx("text-xs px-3 py-2 rounded-lg text-center font-mono",
        improved ? "bg-success/10 text-success border border-success/20" : "bg-error/10 text-error border border-error/20"
      )}>
        {after}
      </div>
    </div>
  );
}

export function VerificationPage() {
  const { currentRunId, currentTest, bugs, verificationStatus,
          setVerificationStatus, isVerifying, setIsVerifying, setActiveView } = useTestStore();

  const hasBugs = bugs.length > 0;
  const canVerify = currentRunId && hasBugs;

  const handleVerify = async () => {
    if (!currentRunId) return;
    setIsVerifying(true);
    try {
      const res = await verifyFix(currentRunId);
      setVerificationStatus(res.verification);
    } catch (e) {
      console.error("Verification failed:", e);
    } finally {
      setIsVerifying(false);
    }
  };

  const vs = verificationStatus;
  const isVerified = vs?.status === "VERIFIED";
  const isNotVerified = vs?.status === "NOT_VERIFIED";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text">Fix Verification</h2>
          <p className="text-xs text-textMuted">Re-run the test to check if the fix resolved the issue</p>
        </div>
        <button onClick={() => setActiveView("report")} className="text-xs text-primary hover:underline">← Bug Report</button>
      </div>

      {/* Instructions */}
      <div className="bg-surface border border-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-text mb-3">How Verification Works</h3>
        <ol className="space-y-2">
          {[
            "WeBug records the original failure signature (e.g. POST /api/coupon → 500)",
            "You fix the bug in your application code",
            "Click Verify Fix — WeBug reruns the same test automatically",
            "The original failure signature is checked against new browser events",
            "Deterministic pass/fail based on actual browser evidence (not AI opinion)",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-xs text-textMuted">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Original failure */}
      {hasBugs && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-3">Original Failure Signature</h3>
          <div className="space-y-2">
            {bugs.map(bug => (
              <div key={bug.id} className="bg-error/5 border border-error/20 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-error">BEFORE</span>
                  <span className="text-xs text-textDim">·</span>
                  <span className="text-xs text-textMuted">{bug.title}</span>
                </div>
                <div className="space-y-1">
                  {bug.evidence.slice(0, 3).map(ev => (
                    <div key={ev.eventId} className="text-xs font-mono text-error/80">{ev.description}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Verify button */}
      {!vs && (
        <div className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-2xl p-6 text-center">
          <p className="text-sm text-textMuted mb-4">
            {canVerify
              ? "Apply your fix to the application, then click Verify Fix"
              : "No bugs were found to verify"}
          </p>
          <button
            id="verify-btn"
            onClick={handleVerify}
            disabled={!canVerify || isVerifying}
            className={clsx(
              "px-8 py-3 rounded-xl font-semibold text-sm transition-all",
              canVerify && !isVerifying
                ? "bg-gradient-to-r from-primary to-accent text-white hover:brightness-110 shadow-lg shadow-primary/20 transform hover:scale-[1.02]"
                : "bg-surface border border-border text-textDim cursor-not-allowed"
            )}
          >
            {isVerifying ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Running verification test...
              </span>
            ) : "🔍 Verify Fix"}
          </button>
        </div>
      )}

      {/* Result */}
      {vs && (
        <div className={clsx(
          "rounded-2xl border p-8 text-center transition-all",
          isVerified
            ? "bg-success/5 border-success/30"
            : isNotVerified
            ? "bg-error/5 border-error/30"
            : "bg-surface border-border"
        )}>
          {isVerified && (
            <>
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-2xl font-bold text-success mb-2">FIX VERIFIED</h2>
              <p className="text-textMuted text-sm">The original failure was not reproduced in the new test run</p>
            </>
          )}
          {isNotVerified && (
            <>
              <div className="text-5xl mb-4">❌</div>
              <h2 className="text-2xl font-bold text-error mb-2">FIX NOT VERIFIED</h2>
              <p className="text-textMuted text-sm">The original failure was still detected in the new test run</p>
            </>
          )}
          {!isVerified && !isNotVerified && (
            <>
              <div className="text-5xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold text-warning mb-2">VERIFICATION ERROR</h2>
              <p className="text-textMuted text-sm">The verification run encountered an error</p>
            </>
          )}

          {/* Comparison */}
          {vs.comparison && vs.newFailure && (
            <div className="mt-6 bg-surface rounded-2xl border border-border p-5 text-left">
              <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-4 text-center">Before vs After</h3>
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="text-xs text-textDim" />
                  <div className="text-xs font-semibold text-error text-center">BEFORE</div>
                  <div className="text-xs font-semibold text-success text-center">AFTER</div>
                </div>
                {vs.originalFailure.endpoint && (
                  <CompareRow
                    label="API endpoint"
                    before={`${vs.originalFailure.endpoint} → ${vs.originalFailure.status || "ERR"}`}
                    after={vs.newFailure.type === "none" ? "✓ No error" : `${vs.newFailure.endpoint || "—"} → ${vs.newFailure.status || "ERR"}`}
                    improved={vs.comparison.networkStatusChanged}
                  />
                )}
                <CompareRow
                  label="Console errors"
                  before={String(vs.originalFailure.consoleErrors)}
                  after={String(vs.newFailure.consoleErrors)}
                  improved={vs.newFailure.consoleErrors < vs.originalFailure.consoleErrors}
                />
                <CompareRow
                  label="Goal completed"
                  before={vs.originalFailure.goalCompleted ? "Yes" : "No"}
                  after={vs.newFailure.goalCompleted ? "Yes" : "No"}
                  improved={vs.newFailure.goalCompleted && !vs.originalFailure.goalCompleted}
                />
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-3 justify-center">
            <button
              onClick={() => { setVerificationStatus(null); handleVerify(); }}
              disabled={isVerifying}
              className="text-xs px-4 py-2 rounded-lg border border-border text-textMuted hover:text-text hover:border-primary/30 transition-colors"
            >
              Re-run Verification
            </button>
            <button
              onClick={() => setActiveView("new")}
              className="text-xs px-4 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              New Test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
