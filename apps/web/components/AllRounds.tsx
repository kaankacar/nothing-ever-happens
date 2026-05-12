"use client";

import { useMemo } from "react";
import { useArena } from "../lib/store";
import type { Choice } from "@mirofish/shared";

const CHOICES: Choice[] = ["A", "B", "C", "D"];
const CONTRACT = process.env.NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID ?? "";

/**
 * Fullscreen-only view rendered by the Question panel. Shows the current
 * round (full scenario + options + verdict if known) followed by every
 * settled round we have in the history strip, with their summary stats.
 */
export function AllRounds() {
  const question = useArena((s) => s.question);
  const resolution = useArena((s) => s.resolution);
  const phase = useArena((s) => s.phase);
  const history = useArena((s) => s.history);
  const commits = useArena((s) => s.commits);
  const reveals = useArena((s) => s.reveals);

  // Combine the current round (if not already in history) with the history.
  const liveRoundId = question?.roundId;
  const liveAlreadyInHistory = useMemo(
    () => (liveRoundId ? history.some((h) => h.roundId === liveRoundId) : false),
    [liveRoundId, history],
  );

  return (
    <div className="rounds-explorer">
      {question && !liveAlreadyInHistory && (
        <div className="round-card round-card-live">
          <div className="round-card-head">
            <div>
              <div className="round-card-id">ROUND #{question.roundId} · LIVE</div>
              <div className="round-card-tag">{question.tags.join(" · ")}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className={`phase-pill ${phaseClass(phase)}`}>{phase}</div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 4 }}>
                {commits.filter((c) => c.roundId === question.roundId).length} commits ·{" "}
                {reveals.filter((r) => r.roundId === question.roundId).length} reveals
              </div>
            </div>
          </div>
          <p className="round-card-scenario">{question.scenario}</p>
          <div className="round-card-options">
            {CHOICES.map((k) => {
              const isVerdict = resolution?.verdict === k;
              const conf = resolution?.distribution[k];
              return (
                <div className={`round-card-option ${isVerdict ? "winner" : ""}`} key={k}>
                  <span className={`key ${k}`}>{k}</span>
                  <span style={{ flex: 1 }}>{question.options[k]}</span>
                  {conf !== undefined && (
                    <span className="round-card-conf">{(conf * 100).toFixed(1)}%</span>
                  )}
                </div>
              );
            })}
          </div>
          {resolution && (
            <div className="round-card-verdict">
              MiroFish verdict: <span className={`key ${resolution.verdict}`}>{resolution.verdict}</span>
              <span style={{ marginLeft: 8, color: "var(--fg-dim)", fontSize: 12 }}>
                seed{" "}
                <a
                  href={`https://stellar.expert/explorer/testnet/ledger/${question.seedLedger}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--fg-dim)", textDecoration: "underline" }}
                >
                  ledger {question.seedLedger}
                </a>
              </span>
            </div>
          )}
          {CONTRACT && (
            <div className="round-card-onchain">
              <a
                href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT}`}
                target="_blank"
                rel="noreferrer"
              >
                view contract on stellar.expert →
              </a>
            </div>
          )}
        </div>
      )}

      {history.length === 0 ? (
        <p className="empty">No past rounds yet — they'll appear here as they settle.</p>
      ) : (
        history.map((h) => (
          <div className="round-card" key={h.roundId}>
            <div className="round-card-head">
              <div>
                <div className="round-card-id">ROUND #{h.roundId}</div>
                <div className="round-card-tag">{h.templateId}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={`key ${h.verdict}`}>{h.verdict}</span>
                <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 4 }}>
                  {h.correct} / {h.revealed} correct · {h.txCount} tx
                </div>
              </div>
            </div>
            <p className="round-card-scenario round-card-blurb">{h.blurb}</p>
            <div className="round-card-foot">
              <span style={{ color: "var(--fg-dim)" }}>
                verdict confidence {(h.confidence * 100).toFixed(1)}%
              </span>
              <span style={{ color: "var(--fg-dim)" }}>
                resolved {new Date(h.resolvedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function phaseClass(phase: string): string {
  if (phase === "commit") return "live";
  if (phase === "simulate") return "simulate";
  if (phase === "reveal" || phase === "settled") return "reveal";
  return "";
}
