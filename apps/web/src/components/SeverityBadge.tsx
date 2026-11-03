import React from "react";
import { clsx } from "clsx";

const config: Record<string, string> = {
  critical: "text-error bg-error/10 border-error/40",
  high:     "text-orange-400 bg-orange-400/10 border-orange-400/40",
  medium:   "text-warning bg-warning/10 border-warning/40",
  low:      "text-textMuted bg-surface border-border",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={clsx(
      "text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded border",
      config[severity] || config.low
    )}>
      {severity}
    </span>
  );
}
