"use client";

import { useEffect, useState } from "react";
import { useArena } from "../lib/store";
import { Header } from "../components/Header";
import { RoundHistory } from "../components/RoundHistory";
import { Question } from "../components/Question";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Graph } from "../components/Graph";
import { NodeInspector } from "../components/NodeInspector";
import { Conversations } from "../components/Conversations";
import { Reveals } from "../components/Reveals";
import { TxStream } from "../components/TxStream";
import { Leaderboard } from "../components/Leaderboard";
import { AgentForm } from "../components/AgentForm";
import { HelpModal } from "../components/HelpModal";
import { RoundDetailModal } from "../components/RoundDetailModal";
import { AgentDetailModal } from "../components/AgentDetailModal";
import { WorldBanner } from "../components/WorldBanner";
import { WorldModal } from "../components/WorldModal";
import { StatsModal } from "../components/StatsModal";
import { Panel } from "../components/PanelHeader";

export default function Home() {
  const connect = useArena((s) => s.connect);
  const setHelpOpen = useArena((s) => s.setHelpOpen);
  const helpOpen = useArena((s) => s.helpOpen);
  const [showForm, setShowForm] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);

  useEffect(() => {
    connect();
    // Show the help modal on first visit (no localStorage gate yet — easy to
    // dismiss; we just don't want to keep popping it).
    if (firstLoad) {
      const seen = typeof window !== "undefined" && window.localStorage.getItem("neh:seen-help");
      if (!seen) setHelpOpen(true);
      setFirstLoad(false);
    }
  }, [connect, firstLoad, setHelpOpen]);

  // Persist help-seen flag after first close
  useEffect(() => {
    if (!helpOpen && !firstLoad && typeof window !== "undefined") {
      window.localStorage.setItem("neh:seen-help", "1");
    }
  }, [helpOpen, firstLoad]);

  return (
    <div className="app">
      <Header onOpenForm={() => setShowForm(true)} />
      <ErrorBoundary label="history" fallback={null}>
        <RoundHistory />
      </ErrorBoundary>
      <ErrorBoundary label="world" fallback={null}>
        <WorldBanner />
      </ErrorBoundary>
      <main className="layout">
        <ErrorBoundary label="question" fallback={<div className="panel question-panel"><p className="empty">Question panel unavailable.</p></div>}>
          <Question />
        </ErrorBoundary>
        <ErrorBoundary
          label="graph"
          fallback={
            <Panel title="Simulation graph" className="graph-panel" hint="Graph renderer crashed.">
              <p className="empty">Graph renderer crashed (likely react-force-graph-2d on React 19).</p>
            </Panel>
          }
        >
          <Panel
            title="MiroFish simulation graph · live"
            hint="Each node is a persona in the simulated society. Colour = which option (A/B/C/D) they currently lean toward. Edges = conversations. Click a node to see what it said and to whom."
            className="graph-panel"
          >
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
              <Graph />
              <NodeInspector />
            </div>
          </Panel>
        </ErrorBoundary>
        <ErrorBoundary label="conversations" fallback={<div className="panel conversation-panel"><p className="empty">Conversations panel unavailable.</p></div>}>
          <Conversations />
        </ErrorBoundary>
        <ErrorBoundary label="reveals" fallback={<div className="panel reveals-panel"><p className="empty">Reveals panel unavailable.</p></div>}>
          <Reveals />
        </ErrorBoundary>
        <ErrorBoundary label="tx-stream" fallback={<div className="panel tx-panel"><p className="empty">Tx stream unavailable.</p></div>}>
          <TxStream />
        </ErrorBoundary>
        <ErrorBoundary label="leaderboard" fallback={<div className="panel leaderboard-panel"><p className="empty">Leaderboard unavailable.</p></div>}>
          <Leaderboard />
        </ErrorBoundary>
      </main>
      {showForm && <AgentForm onClose={() => setShowForm(false)} />}
      <HelpModal />
      <RoundDetailModal />
      <AgentDetailModal />
      <WorldModal />
      <StatsModal />
    </div>
  );
}
