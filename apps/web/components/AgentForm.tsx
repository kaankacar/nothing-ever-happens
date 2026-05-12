"use client";

import { useState } from "react";
import { RUNNER, useArena } from "../lib/store";
import { connectWallet, signXdr } from "../lib/wallet";

const MODELS: { value: string; label: string }[] = [
  { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant (Groq · 14,400 RPD · fastest)" },
  { value: "gemini-2.5-flash-lite", label: "Gemini Flash Lite (Google AI Studio · 1,500 RPD)" },
  { value: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 120B (OpenRouter · 50 RPD)" },
];

interface PrepareResponse {
  pendingId: string;
  delegate: string;
  xdr: string;
  networkPassphrase: string;
}

export function AgentForm({ onClose }: { onClose: () => void }) {
  const operator = useArena((s) => s.operator);
  const setOperator = useArena((s) => s.setOperator);
  const [displayName, setDisplayName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0]!.value);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "preparing" | "signing" | "submitting">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submitConnected(op: string) {
    setStage("preparing");
    const prep = await fetch(`${RUNNER}/agents/connected/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator: op, displayName, systemPrompt, model }),
    });
    if (!prep.ok) {
      const body = await prep.json().catch(() => ({}));
      throw new Error(body.error ?? `prepare failed: HTTP ${prep.status}`);
    }
    const { pendingId, xdr } = (await prep.json()) as PrepareResponse;
    setStage("signing");
    const signedXdr = await signXdr(xdr, op);
    setStage("submitting");
    const confirm = await fetch(`${RUNNER}/agents/connected/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingId, signedXdr }),
    });
    if (!confirm.ok) {
      const body = await confirm.json().catch(() => ({}));
      throw new Error(body.error ?? `confirm failed: HTTP ${confirm.status}`);
    }
  }

  async function submitCustodial() {
    const r = await fetch(`${RUNNER}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, systemPrompt, model }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${r.status}`);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (operator) {
        await submitConnected(operator);
      } else {
        await submitCustodial();
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setStage("idle");
    }
  }

  async function connectAndContinue() {
    setErr(null);
    try {
      const addr = await connectWallet();
      setOperator(addr);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const stageLabel =
    stage === "preparing"
      ? "preparing tx…"
      : stage === "signing"
        ? "waiting for wallet…"
        : stage === "submitting"
          ? "submitting…"
          : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Submit an agent</h2>
        <p className="lead">
          {operator ? (
            <>
              Your wallet <strong>{operator.slice(0, 6)}…{operator.slice(-4)}</strong> will own this
              agent's reputation. The runner manages a delegate key that signs your commit and reveal
              transactions every round.
            </>
          ) : (
            <>
              You're submitting without a wallet — fully custodial. Reputation will live on a
              server-generated key.{" "}
              <button type="button" className="link-btn" onClick={connectAndContinue}>
                Connect a wallet
              </button>{" "}
              to own your agent on-chain instead.
            </>
          )}
        </p>
        <label className="field">
          <label>Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Pattern-Hunter"
            maxLength={40}
            required
          />
        </label>
        <label className="field">
          <label>System prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Describe how your agent should reason. e.g. 'Always think two moves ahead. Prefer status-quo outcomes when actors have something to lose.'"
            maxLength={2000}
            required
          />
        </label>
        <label className="field">
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option value={m.value} key={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        {err && <div style={{ color: "var(--bad)", fontSize: 12, marginBottom: 8 }}>{err}</div>}
        {stageLabel && (
          <div style={{ color: "var(--fg-dim)", fontSize: 12, marginBottom: 8 }}>{stageLabel}</div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="cta" disabled={busy}>
            {busy ? "Submitting…" : operator ? "Sign + enter the arena" : "Enter the arena"}
          </button>
        </div>
      </form>
    </div>
  );
}
