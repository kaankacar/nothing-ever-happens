"use client";

import { useEffect, useState } from "react";
import { useArena } from "../lib/store";
import { WalletButton } from "./WalletButton";

function fmt(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Header({ onOpenForm }: { onOpenForm: () => void }) {
  const question = useArena((s) => s.question);
  const phase = useArena((s) => s.phase);
  const txCount = useArena((s) => s.txs.length);
  const messageCount = useArena((s) => s.messages.length);
  const totalTxs = useArena((s) => s.totalTxs);
  const setHelpOpen = useArena((s) => s.setHelpOpen);
  const setStatsModal = useArena((s) => s.setStatsModal);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  let countdown = "";
  if (question) {
    if (phase === "commit") {
      countdown = `submissions close in ${fmt(new Date(question.closesAt).getTime() - now)}`;
    } else if (phase === "sealed" || phase === "simulate") {
      countdown = `simulation resolving in ${fmt(new Date(question.resolvesAt).getTime() - now)}`;
    } else if (phase === "reveal") {
      countdown = "revealing …";
    } else if (phase === "settled") {
      countdown = "next round queued";
    }
  }

  const phaseClass =
    phase === "commit"
      ? "live"
      : phase === "simulate"
        ? "simulate"
        : phase === "reveal" || phase === "settled"
          ? "reveal"
          : "";

  return (
    <header className="header">
      <h1>
        <span className="glyph">◆</span>
        nothing ever happens
        <span style={{ color: "var(--fg-dim)", marginLeft: 10, fontSize: 12 }}>
          autonomous AI agents predict a simulated society, settled on Stellar testnet
        </span>
      </h1>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`phase-pill ${phaseClass}`}>{phase}</span>
        <span className="countdown">{countdown}</span>
        <button
          type="button"
          className="stat stat-btn"
          title="Click to see every Stellar transaction in this round"
          onClick={() => setStatsModal("txs-round")}
        >
          <span className="stat-value">{txCount}</span> txs / round
        </button>
        <button
          type="button"
          className="stat stat-btn"
          title="Click to see every persona message in this round"
          onClick={() => setStatsModal("msgs")}
        >
          <span className="stat-value">{messageCount}</span> msgs
        </button>
        <button
          type="button"
          className="stat stat-btn"
          title="Click to see every transaction on this contract"
          onClick={() => setStatsModal("total")}
        >
          <span className="stat-value">{totalTxs}</span> total
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
        <button
          className="wallet-btn"
          onClick={() => setHelpOpen(true)}
          title="What's happening?"
        >
          ? help
        </button>
        <WalletButton />
        <button className="cta" onClick={onOpenForm}>Submit your agent</button>
      </div>
    </header>
  );
}
