import React, { useEffect, useState } from "react";
import { clsx } from "clsx";
import { getHealth } from "../api/client";
import { useTestStore } from "../stores/testStore";

export function Header() {
  const { activeView, setActiveView, currentRunId } = useTestStore();
  const [health, setHealth] = useState<{ ollama: string; status: string } | null>(null);

  useEffect(() => {
    const check = async () => {
      try { setHealth(await getHealth()); } catch { setHealth({ ollama: "disconnected", status: "unhealthy" }); }
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  const navItems = [
    { key: "new", label: "New Test" },
    ...(currentRunId ? [
      { key: "live", label: "Live Test" },
      { key: "report", label: "Bug Report" },
      { key: "replay", label: "Replay" },
      { key: "verify", label: "Verification" },
    ] : []),
  ] as { key: typeof activeView; label: string }[];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border glass">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="white" strokeWidth="1.5" />
              <path d="M4 7l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-bold text-text tracking-tight">
            <span className="gradient-text">WeBug</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveView(item.key)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeView === item.key
                  ? "bg-primary/20 text-primary"
                  : "text-textMuted hover:text-text hover:bg-surface"
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Ollama status */}
        <div className="flex items-center gap-2 text-xs">
          <span className={clsx(
            "w-2 h-2 rounded-full",
            health?.ollama === "connected" ? "bg-success animate-pulse" :
            health ? "bg-error" : "bg-textDim"
          )} />
          <span className="text-textMuted hidden sm:inline">
            {health?.ollama === "connected" ? "Ollama connected" : "Ollama offline"}
          </span>
        </div>
      </div>
    </header>
  );
}
