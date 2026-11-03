import React from "react";
import { clsx } from "clsx";
import type { LiveEvent } from "../stores/testStore";

interface Props {
  events: LiveEvent[];
  maxHeight?: string;
}

function getEventStyle(type: string) {
  if (type === "bug_found" || type === "network_error")
    return { dot: "bg-error", text: "text-error", label: "🐛" };
  if (type === "incident_detected")
    return { dot: "bg-orange-400", text: "text-orange-400", label: "⚠️" };
  if (type === "console_error")
    return { dot: "bg-warning", text: "text-warning", label: "⚡" };
  if (type === "agent_action")
    return { dot: "bg-primary", text: "text-primary", label: "→" };
  if (type === "navigation")
    return { dot: "bg-accent", text: "text-accent", label: "🌐" };
  if (type === "test_completed")
    return { dot: "bg-success", text: "text-success", label: "✓" };
  return { dot: "bg-textDim", text: "text-textMuted", label: "·" };
}

function formatEventData(type: string, data: unknown): string {
  if (!data || typeof data !== "object") return type;
  const d = data as Record<string, unknown>;
  if (type === "agent_action") {
    const a = d.action as Record<string, unknown> | undefined;
    if (a) return `${a.description || `${a.type} ${a.target}`}`;
  }
  if (type === "navigation") return `→ ${d.url}`;
  if (type === "network_error") return `HTTP Error: ${d.url}`;
  if (type === "console_error") return `Console: ${d.text || JSON.stringify(d)}`;
  if (type === "incident_detected") return `Incident: ${d.description || d.severity}`;
  if (type === "bug_found") return `Bug: ${d.title || "Detected"}`;
  if (type === "agent_observing") return `Observing step ${d.step}`;
  if (type === "test_completed") return `Test completed`;
  if (type === "test_started") return `Test started`;
  return type.replace(/_/g, " ");
}

export function EventTimeline({ events, maxHeight = "400px" }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-textDim text-sm">
        Waiting for events...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="overflow-y-auto" style={{ maxHeight }}>
      <div className="relative">
        <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-1 pl-8">
          {events.map((ev, i) => {
            const style = getEventStyle(ev.type);
            return (
              <div key={i} className="relative flex items-start gap-3 py-1 group">
                <div className={clsx(
                  "absolute -left-5 w-2 h-2 rounded-full mt-1.5 ring-2 ring-background",
                  style.dot
                )} />
                <div className="flex-1 min-w-0">
                  <span className={clsx("text-xs font-medium", style.text)}>
                    {formatEventData(ev.type, ev.data)}
                  </span>
                  <span className="ml-2 text-xs text-textDim opacity-0 group-hover:opacity-100 transition-opacity">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
