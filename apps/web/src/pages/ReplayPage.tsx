import React, { useEffect, useState, useRef } from "react";
import { clsx } from "clsx";
import { useTestStore } from "../stores/testStore";
import { getReplay, getEvents } from "../api/client";
import type { ReplayData, BrowserEvent } from "@agentqa/types";

interface Marker {
  timestamp: number;
  type: string;
  label: string;
  eventId: string;
}

function getMarkerColor(type: string) {
  if (type === "network_error" || type === "network_response") return "bg-error";
  if (type === "console_error") return "bg-warning";
  if (type === "exception" || type === "page_error") return "bg-orange-400";
  if (type === "agent_action") return "bg-primary";
  if (type === "navigation") return "bg-accent";
  return "bg-textDim";
}

export function ReplayPage() {
  const { currentRunId, bugs, setActiveView } = useTestStore();
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayerRef = useRef<unknown>(null);

  useEffect(() => {
    if (!currentRunId) return;
    setLoading(true);
    Promise.all([
      getReplay(currentRunId).catch(() => null),
      getEvents(currentRunId).catch(() => ({ events: [] })),
    ]).then(([replayRes, eventsRes]) => {
      if (replayRes?.replay) {
        setReplay(replayRes.replay);
        const evs = replayRes.replay.events;
        if (evs.length > 1) {
          setDuration(evs[evs.length - 1].timestamp - evs[0].timestamp);
        }
      }
      const allEvents: BrowserEvent[] = eventsRes?.events || [];
      setEvents(allEvents);
      // Create markers from significant events
      const ms: Marker[] = allEvents
        .filter(e => ["network_response","network_error","console_error","page_error","exception","agent_action","navigation"].includes(e.type))
        .filter(e => {
          if (e.type === "network_response") return (e.data as Record<string,number>).status >= 400;
          if (e.type === "agent_action") return !(e.data as Record<string,boolean>).success;
          return true;
        })
        .slice(0, 50)
        .map(e => ({
          timestamp: e.timestamp,
          type: e.type,
          eventId: e.id,
          label: formatEventLabel(e),
        }));
      setMarkers(ms);
    }).catch(e => {
      setError("Failed to load replay data");
    }).finally(() => setLoading(false));
  }, [currentRunId]);

  function formatEventLabel(e: BrowserEvent) {
    const d = e.data as Record<string, unknown>;
    if (e.type === "navigation") return `Navigate: ${d.url}`;
    if (e.type === "network_response") return `HTTP ${d.status}: ${String(d.url).split("?")[0]}`;
    if (e.type === "console_error") return `Error: ${String(d.text).slice(0, 60)}`;
    if (e.type === "agent_action") {
      const a = d.action as Record<string,unknown>;
      return a ? String(a.description || `${a.type} ${a.target}`).slice(0, 60) : "Action";
    }
    return e.type.replace(/_/g, " ");
  }

  // Simulated playback
  useEffect(() => {
    if (!replay || !isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setCurrentTime(t => {
        if (t >= duration) { setIsPlaying(false); return duration; }
        return t + 250;
      });
    }, 250);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, replay, duration]);

  // rrweb playback (if available in browser)
  useEffect(() => {
    if (!replay || !iframeRef.current) return;
    // The iframe approach: inject rrweb player into iframe
    const iframe = iframeRef.current;
    const replayEvents = replay.events;
    if (!replayEvents.length) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css">
  <style>
    body { margin: 0; background: #0a0f1a; overflow: hidden; }
    .rr-player { width: 100% !important; height: 100% !important; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script src="https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js"><\/script>
  <script>
    try {
      const events = ${JSON.stringify(replayEvents)};
      if (events.length > 0) {
        new rrwebPlayer({ target: document.getElementById('player'), props: { events, width: 800, height: 500, autoPlay: false } });
      }
    } catch(e) {
      document.body.innerHTML = '<div style="color:#94a3b8;padding:20px;font-family:monospace">Replay player unavailable: ' + e.message + '</div>';
    }
  <\/script>
</body>
</html>`);
    doc.close();
  }, [replay]);

  if (!currentRunId) {
    return (
      <div className="text-center text-textMuted py-20">
        No test selected.
        <button onClick={() => setActiveView("new")} className="text-primary text-sm ml-2 hover:underline">Start a test →</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-textMuted">
        <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading replay...
      </div>
    );
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const startTs = replay?.events[0]?.timestamp || 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text">Session Replay</h2>
        <button onClick={() => setActiveView("report")} className="text-xs text-primary hover:underline">← Bug Report</button>
      </div>

      {/* Replay iframe */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {replay?.events.length ? (
          <iframe ref={iframeRef} className="w-full" style={{ height: "500px" }} title="Session Replay" />
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-textMuted gap-3">
            <div className="text-4xl">📹</div>
            <div className="text-sm">
              {error ? error : "No replay data available for this test."}
            </div>
            <p className="text-xs text-textDim max-w-xs text-center">
              rrweb recording is embedded in the browser session. Events will appear here when the agent runs.
            </p>
          </div>
        )}
      </div>

      {/* Timeline with markers */}
      {markers.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-4">Event Timeline</h3>

          {/* Timeline bar */}
          <div className="relative h-8 bg-background rounded-full mb-4 cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              setCurrentTime(Math.round(ratio * duration));
            }}
          >
            {/* Progress */}
            <div className="absolute top-0 left-0 h-full bg-primary/30 rounded-full transition-all" style={{ width: `${pct}%` }} />
            {/* Playhead */}
            <div className="absolute top-0 w-0.5 h-full bg-primary rounded-full transition-all" style={{ left: `${pct}%` }} />
            {/* Markers */}
            {markers.map((m, i) => {
              const mPct = duration > 0 ? ((m.timestamp - startTs) / duration) * 100 : 0;
              return (
                <div
                  key={i}
                  title={m.label}
                  className={clsx("absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-background cursor-pointer hover:scale-150 transition-transform z-10", getMarkerColor(m.type))}
                  style={{ left: `${mPct}%` }}
                  onClick={e => { e.stopPropagation(); setCurrentTime(m.timestamp - startTs); }}
                />
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setCurrentTime(0); setIsPlaying(false); }}
              className="p-1.5 rounded-lg hover:bg-surfaceHover text-textMuted hover:text-text transition-colors"
              title="Rewind"
            >⏮</button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors font-bold"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <span className="text-xs font-mono text-textMuted">
              {(currentTime / 1000).toFixed(1)}s / {(duration / 1000).toFixed(1)}s
            </span>
          </div>

          {/* Marker list */}
          <div className="mt-4 space-y-1.5 max-h-48 overflow-y-auto">
            {markers.map((m, i) => (
              <button
                key={i}
                onClick={() => setCurrentTime(m.timestamp - startTs)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background text-left transition-colors group"
              >
                <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", getMarkerColor(m.type))} />
                <span className="text-xs text-textMuted group-hover:text-text transition-colors truncate">{m.label}</span>
                <span className="text-xs font-mono text-textDim ml-auto flex-shrink-0">
                  {((m.timestamp - startTs) / 1000).toFixed(1)}s
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
