"use client";

import { useMemo } from "react";
import { useArena } from "../lib/store";

function short(s: string, head = 6, tail = 4): string {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function shortModel(m: string): string {
  if (m.startsWith("nvidia/")) return "Nemotron 120B";
  if (m.startsWith("gemini")) return "Gemini Flash Lite";
  return m;
}

const CHOICE_LABEL: Record<string, string> = {
  A: "Option A",
  B: "Option B",
  C: "Option C",
  D: "Option D",
};

export function AgentDetailModal() {
  const detailAgent = useArena((s) => s.detailAgent);
  const setDetailAgent = useArena((s) => s.setDetailAgent);
  const agents = useArena((s) => s.agents);
  const commits = useArena((s) => s.commits);
  const reveals = useArena((s) => s.reveals);
  const resolution = useArena((s) => s.resolution);
  const question = useArena((s) => s.question);

  const agent = useMemo(
    () => agents.find((a) => a.stellarAddress === detailAgent),
    [agents, detailAgent],
  );
  const commit = useMemo(
    () => commits.find((c) => c.agent === detailAgent),
    [commits, detailAgent],
  );
  const reveal = useMemo(
    () => reveals.find((r) => r.agent === detailAgent),
    [reveals, detailAgent],
  );

  if (!detailAgent) return null;

  const correct = resolution && reveal && reveal.answer === resolution.verdict;

  return (
    <div className="modal-backdrop" onClick={() => setDetailAgent(null)}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{agent?.displayName ?? short(detailAgent)}</h2>
            <p style={{ margin: "4px 0 0", color: "var(--fg-dim)", fontSize: 12 }}>
              {agent ? shortModel(agent.model) : ""}
              {agent && " · "}
              <a
                href={`https://stellar.expert/explorer/testnet/account/${detailAgent}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--fg-dim)", textDecoration: "underline" }}
              >
                {short(detailAgent, 8, 6)}
              </a>
            </p>
          </div>
          <button className="panel-btn" onClick={() => setDetailAgent(null)} aria-label="Close">×</button>
        </div>

        {agent && (
          <Row label="System prompt">
            <div className="agent-prompt">{agent.systemPrompt}</div>
          </Row>
        )}

        {question && (
          <Row label="Scenario this agent saw">
            <div className="agent-prompt">{question.scenario}</div>
          </Row>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="round-stat">
            <div className="round-stat-label">Commit</div>
            <div className="round-stat-value" style={{ fontSize: 11.5 }}>
              {commit ? (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${commit.commitTx}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  {short(commit.commitHash, 10, 6)}
                </a>
              ) : (
                <span style={{ color: "var(--fg-dim)" }}>pending</span>
              )}
            </div>
          </div>
          <div className="round-stat">
            <div className="round-stat-label">Reveal</div>
            <div className="round-stat-value">
              {reveal ? (
                <span className={`key ${reveal.answer}`}>{reveal.answer}</span>
              ) : (
                <span style={{ color: "var(--fg-dim)", fontSize: 12 }}>awaiting</span>
              )}
              {reveal && CHOICE_LABEL[reveal.answer] && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--fg-dim)" }}>
                  {CHOICE_LABEL[reveal.answer]}
                </span>
              )}
            </div>
          </div>
        </div>

        {reveal && reveal.reasoning && (
          <Row label="Agent's reasoning">
            <div className="agent-prompt" style={{ borderLeft: "2px solid var(--accent)" }}>
              {reveal.reasoning}
            </div>
          </Row>
        )}

        {resolution && reveal && (
          <div
            className="round-stat"
            style={{
              marginTop: 10,
              borderColor: correct ? "rgba(107, 242, 164, 0.5)" : "rgba(255, 115, 115, 0.5)",
              color: correct ? "var(--good)" : "var(--bad)",
            }}
          >
            <div className="round-stat-label" style={{ color: "inherit" }}>
              Result vs simulator verdict {resolution.verdict}
            </div>
            <div className="round-stat-value" style={{ color: "inherit" }}>
              {correct ? "✓ Correct — rep credited at settle" : "✗ Missed — no rep this round"}
            </div>
          </div>
        )}

        {reveal && reveal.revealTx && (
          <p style={{ marginTop: 12, color: "var(--fg-dim)", fontSize: 11 }}>
            Reveal tx:{" "}
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${reveal.revealTx}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--fg-dim)", textDecoration: "underline" }}
            >
              {short(reveal.revealTx, 10, 6)}
            </a>
          </p>
        )}

        <div className="modal-actions">
          <button className="cta" onClick={() => setDetailAgent(null)}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="round-stat-label" style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
