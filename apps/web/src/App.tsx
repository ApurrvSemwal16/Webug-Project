import React from "react";
import { Header } from "./components/Header";
import { NewTestPage } from "./pages/NewTestPage";
import { LiveTestPage } from "./pages/LiveTestPage";
import { BugReportPage } from "./pages/BugReportPage";
import { ReplayPage } from "./pages/ReplayPage";
import { VerificationPage } from "./pages/VerificationPage";
import { useTestStore } from "./stores/testStore";

export default function App() {
  const { activeView } = useTestStore();

  return (
    <div className="min-h-screen bg-background text-text">
      <Header />
      <main className="pt-20 pb-12 px-4">
        <div className="max-w-7xl mx-auto">
          {activeView === "new" && <NewTestPage />}
          {activeView === "live" && <LiveTestPage />}
          {activeView === "report" && <BugReportPage />}
          {activeView === "replay" && <ReplayPage />}
          {activeView === "verify" && <VerificationPage />}
        </div>
      </main>
    </div>
  );
}
