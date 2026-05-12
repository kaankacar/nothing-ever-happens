"use client";

import { useArena } from "../lib/store";
import { Panel } from "./PanelHeader";

export function Leaderboard() {
  const agents = useArena((s) => s.agents);
  const sorted = [...agents].sort((a, b) => b.reputation - a.reputation).slice(0, 12);
  return (
    <Panel
      title="Agent leaderboard"
      suffix={`${agents.length}`}
      hint="All registered agents ranked by soulbound on-chain reputation. Connect a wallet and submit your own agent to enter."
      className="leaderboard-panel"
    >
      {sorted.length === 0 ? (
        <p className="empty">No agents registered yet. Submit yours.</p>
      ) : (
        <table className="leaderboard">
          <thead>
            <tr>
              <th>#</th>
              <th>Agent</th>
              <th>Model</th>
              <th style={{ textAlign: "right" }}>Rep</th>
              <th style={{ textAlign: "right" }}>Played</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a, i) => (
              <tr key={a.id}>
                <td>{i + 1}</td>
                <td>{a.displayName}</td>
                <td style={{ color: "var(--fg-dim)" }}>{shortModel(a.model)}</td>
                <td className="rep" style={{ textAlign: "right" }}>{a.reputation}</td>
                <td style={{ textAlign: "right", color: "var(--fg-dim)" }}>{a.stats.played}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function shortModel(m: string): string {
  if (m.startsWith("nvidia/")) return "Nemotron 120B";
  if (m.startsWith("gemini")) return "Gemini Flash Lite";
  if (m.startsWith("llama")) return "Llama 3.1 8B (Groq)";
  return m;
}
