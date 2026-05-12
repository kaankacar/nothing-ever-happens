import { EventSource } from "eventsource";
import type { ArenaEvent, HostedAgent, QuestionScenario } from "@mirofish/shared";
import { config } from "./config.js";
import { listAgents, listAgentsWithSecrets, updateAgentStats } from "./store.js";
import { answer } from "./llm.js";
import { commitHash, getReputation, newNonce, submitCommit, submitReveal } from "./stellar.js";

type SseHandler = (raw: MessageEvent) => unknown;

interface PendingReveal {
  agentId: string;
  stellarAddress: string;
  secret: string;
  choice: "A" | "B" | "C" | "D";
  nonceHex: string;
  commitHashHex: string;
  reasoning: string;
}

const pending: Map<number, PendingReveal[]> = new Map();

async function pushOracleEvent(type: "agent.commit" | "agent.reveal", data: unknown): Promise<void> {
  try {
    await fetch(`${config.oracleUrl}/internal/agent-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
  } catch {
    /* best-effort */
  }
}

async function refreshAllReputations(): Promise<void> {
  if (!config.contractId) return;
  const agents = await listAgents();
  // Run in parallel but cap concurrency to 5 to stay nice to the RPC.
  const queue = [...agents];
  const work = async () => {
    while (queue.length > 0) {
      const a = queue.shift();
      if (!a) return;
      try {
        const rep = await getReputation(a.operator);
        if (rep !== a.reputation) {
          await updateAgentStats(a.id, (cur) => {
            const wasWin = rep > cur.reputation;
            return {
              reputation: rep,
              stats: {
                ...cur.stats,
                top3: cur.stats.top3 + (wasWin ? 1 : 0),
                firsts: cur.stats.firsts + (wasWin && rep - cur.reputation >= 500 ? 1 : 0),
              },
            };
          });
        }
      } catch {
        /* per-agent failures aren't fatal */
      }
    }
  };
  await Promise.all([work(), work(), work(), work(), work()]);
}

export function startAgentLoop(): void {
  const url = `${config.oracleUrl}/events`;
  console.log(`[runner] connecting to oracle SSE: ${url}`);
  const es = new EventSource(url);

  const handle = async (raw: MessageEvent) => {
    try {
      const ev = JSON.parse(raw.data) as ArenaEvent;
      if (ev.type === "round.opened") {
        await onRoundOpened(ev.data);
      } else if (ev.type === "round.phase" && ev.data.phase === "settled") {
        pending.delete(ev.data.roundId);
        // Refresh every agent's reputation from the contract — the settle
        // tx just credited any winners. Best-effort; don't block.
        refreshAllReputations().catch((e) =>
          console.warn("[runner] reputation refresh failed", e),
        );
      }
    } catch (err) {
      console.warn("agent loop handler error", err);
    }
  };

  // Belt-and-suspenders: refresh every 30s in case we missed a settle event
  // (SSE reconnect, etc.).
  setInterval(() => {
    refreshAllReputations().catch(() => undefined);
  }, 30_000);

  // Subscribe to specific event types we care about. We deliberately do NOT
  // subscribe to phase=reveal: reveals are triggered on a timer driven by
  // the round's own `closesAt` so they land inside the contract's reveal
  // window even if the oracle's simulator is still running.
  for (const type of ["round.opened", "round.phase"]) {
    es.addEventListener(type, handle as SseHandler);
  }
  // Fallback for runtimes that route everything through onmessage.
  es.onmessage = handle as SseHandler;
  es.onerror = (e: unknown) => console.warn("[runner] SSE error", e);
}

async function onRoundOpened(scenario: QuestionScenario): Promise<void> {
  // Skip rounds whose commit window has already closed — happens when the
  // runner subscribes to SSE mid-round and gets the buffer replay.
  const closesAt = new Date(scenario.closesAt).getTime();
  const headroomMs = 5000;
  if (Date.now() + headroomMs >= closesAt) {
    console.log(`[runner] round ${scenario.roundId}: commit window already closed, skipping`);
    return;
  }
  const agents = await listAgentsWithSecrets();
  if (agents.length === 0) {
    console.log(`[runner] round ${scenario.roundId}: no agents registered`);
    return;
  }
  console.log(`[runner] round ${scenario.roundId}: running ${agents.length} agents`);
  // Serialize commits: the contract maintains a per-round Vec<Address> of
  // committers, so parallel submissions all simulate against an empty list
  // and blow the resource budget once they apply on-chain in sequence.
  const ready: PendingReveal[] = [];
  for (const a of agents) {
    const r = await runAgent(a, scenario);
    if (r) ready.push(r);
  }
  pending.set(scenario.roundId, ready);

  // Schedule the reveal phase as soon as the contract's commit window closes,
  // independent of the oracle's simulation progress. Buffer +5s to let the
  // ledger that closes the commit window finalize first.
  const revealAt = closesAt + 5000;
  const wait = Math.max(0, revealAt - Date.now());
  setTimeout(() => {
    onRevealOpen(scenario.roundId).catch((err) =>
      console.warn(`[runner] timer reveal failed for round ${scenario.roundId}`, err),
    );
  }, wait);
}

async function runAgent(
  a: HostedAgent & { stellarSecret: string },
  scenario: QuestionScenario,
): Promise<PendingReveal | null> {
  try {
    const llm = await answer(a, scenario);
    const nonce = newNonce();
    const hash = commitHash(llm.choice, nonce.bytes);
    let commitTx = "";
    if (config.contractId) {
      commitTx = await submitCommit(a.stellarSecret, scenario.roundId, hash);
    }
    await pushOracleEvent("agent.commit", {
      agent: a.stellarAddress,
      roundId: scenario.roundId,
      commitHash: hash,
      commitTx,
      submittedAt: new Date().toISOString(),
    });
    return {
      agentId: a.id,
      stellarAddress: a.stellarAddress,
      secret: a.stellarSecret,
      choice: llm.choice,
      nonceHex: nonce.hex,
      commitHashHex: hash,
      reasoning: llm.reasoning,
    };
  } catch (err) {
    console.warn(`agent ${a.id} commit failed`, (err as Error).message);
    return null;
  }
}

async function onRevealOpen(roundId: number): Promise<void> {
  const items = pending.get(roundId);
  if (!items?.length) return;
  console.log(`[runner] revealing ${items.length} agents for round ${roundId}`);
  // Sequential for the same reason commits are sequential — the on-chain
  // revealers Vec grows as each tx applies.
  for (const p of items) {
    let revealTx = "";
    try {
      if (config.contractId) {
        revealTx = await submitReveal(p.secret, roundId, p.choice, p.nonceHex);
      }
      await pushOracleEvent("agent.reveal", {
        agent: p.stellarAddress,
        roundId,
        answer: p.choice,
        nonce: p.nonceHex,
        reasoning: p.reasoning,
        revealTx,
        revealedAt: new Date().toISOString(),
      });
      await updateAgentStats(p.agentId, (a) => ({
        stats: { ...a.stats, played: a.stats.played + 1 },
      }));
    } catch (err) {
      console.warn(`agent ${p.agentId} reveal failed`, (err as Error).message);
    }
  }
  pending.delete(roundId);
}
