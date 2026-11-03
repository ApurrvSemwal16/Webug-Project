import React from "react";
import { clsx } from "clsx";

interface Props {
  status: string;
  size?: "sm" | "md";
}

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  CREATED:     { label: "Created",      color: "text-textMuted bg-surface border-border",         dot: "bg-textDim" },
  STARTING:    { label: "Starting",     color: "text-warning bg-warning/10 border-warning/30",    dot: "bg-warning animate-pulse" },
  RUNNING:     { label: "Running",      color: "text-primary bg-primary/10 border-primary/30",   dot: "bg-primary animate-pulse" },
  INVESTIGATING:{ label: "Investigating",color: "text-accent bg-accent/10 border-accent/30",      dot: "bg-accent animate-pulse" },
  COMPLETED:   { label: "Completed",    color: "text-success bg-success/10 border-success/30",   dot: "bg-success" },
  FAILED:      { label: "Failed",       color: "text-error bg-error/10 border-error/30",         dot: "bg-error" },
  STOPPED:     { label: "Stopped",      color: "text-textMuted bg-surface border-border",         dot: "bg-textDim" },
  healthy:     { label: "Connected",    color: "text-success bg-success/10 border-success/30",   dot: "bg-success" },
  degraded:    { label: "Degraded",     color: "text-warning bg-warning/10 border-warning/30",   dot: "bg-warning animate-pulse" },
  unhealthy:   { label: "Unavailable",  color: "text-error bg-error/10 border-error/30",         dot: "bg-error" },
};

export function StatusBadge({ status, size = "md" }: Props) {
  const cfg = statusConfig[status] || { label: status, color: "text-textMuted bg-surface border-border", dot: "bg-textDim" };
  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 rounded-full border font-medium",
      size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1",
      cfg.color
    )}>
      <span className={clsx("rounded-full", size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2", cfg.dot)} />
      {cfg.label}
    </span>
  );
}
