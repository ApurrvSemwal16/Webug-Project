import { useEffect, useRef } from "react";
import { createSSEStream } from "../api/client";
import { useTestStore } from "../stores/testStore";
import { getBugs, getTest } from "../api/client";

export function useSSE(runId: string | null) {
  const closeRef = useRef<(() => void) | null>(null);
  const { addLiveEvent, setCurrentTest, setBugs, setActiveView } = useTestStore();

  useEffect(() => {
    if (!runId) return;

    const close = createSSEStream(runId, async (type, data) => {
      addLiveEvent({ type, data, timestamp: Date.now() });

      // Refresh test metadata on key events
      if (["test_started","test_completed","error","bug_found","incident_detected"].includes(type)) {
        try {
          const res = await getTest(runId);
          if (res.test) setCurrentTest(res.test);
        } catch { /* ignore */ }
      }

      if (type === "bug_found" || type === "test_completed") {
        try {
          const res = await getBugs(runId);
          if (res.bugs) {
            setBugs(res.bugs);
            if (res.bugs.length > 0 && type === "test_completed") {
              setActiveView("report");
            }
          }
        } catch { /* ignore */ }
      }
    });

    closeRef.current = close;
    return () => { close(); closeRef.current = null; };
  }, [runId]);
}
