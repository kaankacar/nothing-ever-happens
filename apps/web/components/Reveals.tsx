"use client";

import { useMemo } from "react";
import { useArena } from "../lib/store";
import { Panel } from "./PanelHeader";

function shortAddr(a: string): string {
  if (!a) return "";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function agentLabel(addr: string, agents: { stellarAddress: string; displayName: string }[]): string {
  return agents.find((a) => a.stellarAddress === addr)?.displayName ?? shortAddr(addr);
}

export function Reveals() {
  const commits = useArena((s) => s.commits);
  const reveals = useArena((s) => s.reveals);
  const resolution = useArena((s) => s.resolution);
  const agents = useArena((s) => s.agents);
  const setDetailAgent = useArena((s) => s.setDetailAgent);

  const rows = useMemo(() => {
    const revealByAgent = new Map(reveals.map((r) => [r.agent, r]));
    return commits.map((c) => ({
      agent: c.agent,
      committedAt: c.submittedAt,
      reveal: revealByAgent.get(c.agent),
    }));
  }, [commits, reveals]);

  return (
    <Panel
      title="Agent commits & reveals"
      suffix={`${commits.length} / ${reveals.length}`}
      hint="Every registered agent commits a hash of its predicted answer, then reveals it after the commit window closes. ✓ means the agent matched the verdict."
      className="reveals-panel"
    >
      {rows.length === 0 ? (
        <p className="empty">Agents will commit here once the round opens.</p>
      ) : (
        rows.map((row) => {
          const label = agentLabel(row.agent, agents);
          const correct = resolution && row.reveal?.answer === resolution.verdict;
          return (
            <div className="reveal-item" key={row.agent}>
              <div className="reveal-head">
                <span className="reveal-name">{label}</span>
                {row.reveal ? (
                  <span className={`reveal-choice key ${row.reveal.answer}`}>
                    {row.reveal.answer}
                  </span>
                ) : (
                  <span className="reveal-pending">committed · awaiting reveal</span>
                )}
                {resolution && row.reveal && (
                  <span className={`reveal-score ${correct ? "good" : "bad"}`}>
                    {correct ? "✓" : "✗"}
                  </span>
                )}
                <button
                  className="panel-btn"
                  onClick={() => setDetailAgent(row.agent)}
                  aria-label="Show agent details"
                  title="Show full prompt, commit, reveal, reasoning"
                  style={{ marginLeft: resolution && row.reveal ? 0 : "auto" }}
                >
                  ⤢
                </button>
              </div>
              {row.reveal && row.reveal.reasoning && (
                <p className="reveal-reasoning">{row.reveal.reasoning}</p>
              )}
            </div>
          );
        })
      )}
    </Panel>
  );
}
