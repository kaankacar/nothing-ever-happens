"use client";

import { useEffect, useState } from "react";
import { useArena } from "../lib/store";
import { connectWallet, disconnectWallet, resumeWallet } from "../lib/wallet";

function short(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const operator = useArena((s) => s.operator);
  const setOperator = useArena((s) => s.setOperator);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    resumeWallet()
      .then((addr) => {
        if (addr) setOperator(addr);
      })
      .catch(() => undefined);
  }, [setOperator]);

  async function onClick() {
    setErr(null);
    if (operator) {
      disconnectWallet();
      setOperator(null);
      return;
    }
    setBusy(true);
    try {
      const addr = await connectWallet();
      setOperator(addr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={operator ? "wallet-btn connected" : "wallet-btn"}
      onClick={onClick}
      disabled={busy}
      title={operator ?? "Connect a Stellar wallet to own your agent's reputation"}
    >
      {busy ? "Connecting…" : operator ? short(operator) + " · disconnect" : "Connect wallet"}
      {err && <span className="wallet-err">{err}</span>}
    </button>
  );
}
