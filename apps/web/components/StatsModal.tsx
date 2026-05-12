"use client";

import { useEffect, useState } from "react";
import { useArena, ORACLE } from "../lib/store";
import type { TxEvent } from "@mirofish/shared";

type Mode = "txs-round" | "msgs" | "total";

function short(s: string): string {
  if (!s) return "";
  return s.length <= 12 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function StatsModal() {
  const mode = useArena((s) => s.statsModal);
  const setMode = useArena((s) => s.setStatsModal);
  const txs = useArena((s) => s.txs);
  const messages = useArena((s) => s.messages);
  const question = useArena((s) => s.question);

  const [cumulativeTxs, setCumulativeTxs] = useState<TxEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== "total") {
      setCumulativeTxs(null);
      return;
    }
    setLoading(true);
    fetch(`${ORACLE}/txs/recent?limit=1000`)
      .then((r) => r.json())
      .then((j) => setCumulativeTxs(j.txs ?? []))
      .catch(() => setCumulativeTxs([]))
      .finally(() => setLoading(false));
  }, [mode]);

  if (!mode) return null;

  let title = "";
  let body: React.ReactNode = null;

  if (mode === "txs-round") {
    title = `Transactions this round · ${txs.length}`;
    body = txs.length === 0 ? (
      <p className="empty">No transactions in this round yet.</p>
    ) : (
      <div className="stats-list">
        {txs.map((t, i) => (
          <a
            key={`${t.hash}-${i}`}
            href={`https://stellar.expert/explorer/testnet/tx/${t.hash}`}
            target="_blank"
            rel="noreferrer"
            className="tx-item tx-link"
          >
            <span className={`tx-kind ${t.kind}`}>{t.kind.replace("_", " ")}</span>
            <span className="tx-label">{t.label ?? ""}</span>
            <span className="tx-hash">{short(t.hash)}</span>
          </a>
        ))}
      </div>
    );
  } else if (mode === "msgs") {
    title = `Persona messages this round · ${messages.length}${question ? ` (round #${question.roundId})` : ""}`;
    body = messages.length === 0 ? (
      <p className="empty">No persona dialogue yet — the simulator hasn't reached this round's simulate phase.</p>
    ) : (
      <div className="stats-list">
        {messages.map((m) => (
          <div className="conversation-item" key={`${m.roundId}-${m.seq}`}>
            <div className="meta">
              <span className="from">{m.from}</span>
              <span className="arrow">→</span>
              <span className="to">{m.to}</span>
              <span style={{ marginLeft: "auto", color: "var(--fg-dim)" }}>tick {m.tick}</span>
            </div>
            <div>{m.content}</div>
          </div>
        ))}
      </div>
    );
  } else {
    // total
    const list = cumulativeTxs ?? [];
    title = loading
      ? "Loading cumulative transactions…"
      : `All transactions on this contract · ${list.length}${list.length >= 1000 ? "+ (showing latest 1000)" : ""}`;
    body = loading ? (
      <p className="empty">Loading…</p>
    ) : list.length === 0 ? (
      <p className="empty">No transactions recorded yet.</p>
    ) : (
      <div className="stats-list">
        {list.map((t, i) => (
          <a
            key={`${t.hash}-${i}`}
            href={`https://stellar.expert/explorer/testnet/tx/${t.hash}`}
            target="_blank"
            rel="noreferrer"
            className="tx-item tx-link"
          >
            <span className={`tx-kind ${t.kind}`}>{t.kind.replace("_", " ")}</span>
            <span className="tx-label">{t.label ?? ""}</span>
            <span className="tx-hash">{short(t.hash)}</span>
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => setMode(null)}>
      <div className="modal help-modal stats-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="panel-btn" onClick={() => setMode(null)} aria-label="Close">×</button>
        </div>
        {body}
        <div className="modal-actions">
          <button className="cta" onClick={() => setMode(null)}>Close</button>
        </div>
      </div>
    </div>
  );
}
