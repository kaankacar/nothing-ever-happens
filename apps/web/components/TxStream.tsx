"use client";

import { useArena } from "../lib/store";
import { Panel } from "./PanelHeader";

function short(hash: string): string {
  if (!hash) return "";
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function TxStream() {
  const txs = useArena((s) => s.txs);
  return (
    <Panel
      title="Stellar tx stream · live"
      suffix={`${txs.length}`}
      hint="Every on-chain action this round produced: agent commits, agent reveals, persona-interaction edges, and the oracle settle that distributes reputation."
      className="tx-panel"
    >
      {txs.length === 0 ? (
        <p className="empty">Transactions will appear here as the round progresses.</p>
      ) : (
        txs.map((t, i) => (
          <a
            className="tx-item tx-link"
            key={`${t.hash}-${i}`}
            href={`https://stellar.expert/explorer/testnet/tx/${t.hash}`}
            target="_blank"
            rel="noreferrer"
            title="Open on stellar.expert"
          >
            <span className={`tx-kind ${t.kind}`}>{t.kind.replace("_", " ")}</span>
            <span className="tx-label">{t.label ?? ""}</span>
            <span className="tx-hash">{short(t.hash)}</span>
          </a>
        ))
      )}
    </Panel>
  );
}
