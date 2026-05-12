import type {
  ArenaEvent,
  Choice,
  PersonaMessage,
  QuestionScenario,
  RoundResolution,
  RoundState,
} from "@mirofish/shared";
import { instantiateQuestion, pickTemplate } from "@mirofish/shared";
import { bus } from "./events.js";
import { config } from "./config.js";
import { simulate } from "./mirofish.js";
import {
  canonicalize,
  deriveKey,
  sha256Hex,
  settlePayload,
  sign,
} from "./sign.js";
import {
  emitEdgeBatch,
  getLatestLedger,
  getLedgerCloseHash,
  openRoundOnChain,
  settleOnChain,
  oraclePublicKey,
} from "./stellar.js";
import { recordRound } from "./history.js";
import {
  recordRoundOpened,
  recordResolution,
  recordSettled,
  recordPersonaMessage,
  recordAgentCommit,
  recordAgentReveal,
  recordTx,
  recordAiSummary,
  recordWorldNarrative,
  getWorldEvents,
  getRoundsSinceLastNarrative,
} from "./db.js";
import { callLlm } from "./llm.js";

/**
 * Round scheduler. Drives the round state machine; only one round is "live"
 * at a time. Five-minute cycle:
 *
 *   t=0:00  open  (publish question, open contract round)
 *   t=0:00–3:00   commit window (agents POST commits to the runner; runner
 *                 submits commit() to the contract; we re-emit on SSE)
 *   t=3:00  sealed (no more commits)
 *   t=3:00–4:30  simulate (MiroFish ticks, persona messages stream)
 *   t=4:30  reveal opens (agents reveal; verdict known from oracle resolution)
 *   t=5:00  settle (oracle posts signed verdict to contract)
 *
 * The simulator and reveal window overlap intentionally — runners can begin
 * agent inference the moment commits close, and persona chatter is the public
 * spectacle that runs alongside.
 */

let currentState: RoundState | null = null;
let _roundCounter = 0;
let _running = false;

export function getCurrent(): RoundState | null {
  return currentState;
}

export async function startScheduler(): Promise<void> {
  if (_running) return;
  _running = true;
  while (_running) {
    try {
      await runOneRound();
    } catch (err) {
      console.error("round error", err);
      await sleep(5000);
    }
  }
}

export function stopScheduler() {
  _running = false;
}

async function runOneRound(): Promise<void> {
  const roundId = ++_roundCounter;
  const openedAt = new Date();
  // Per-round counters: tx count and reveals.
  let txCount = 0;
  const reveals: Array<{ agent: string; answer: "A" | "B" | "C" | "D" }> = [];
  const unsubAccount = bus.subscribe((ev) => {
    if (ev.type === "tx") txCount++;
    else if (ev.type === "agent.reveal") reveals.push({ agent: ev.data.agent, answer: ev.data.answer });
  });
  // Seed ledger: current latest ledger + ~5 minutes worth of ledgers (~60 ledgers).
  const latest = await getLatestLedger().catch(() => 0);
  const seedLedger = latest + config.seedLedgerOffset;
  // Use the current latest ledger seq as the question-instantiation seed
  // (we don't know the seedLedger close hash yet — that's the resolution seed).
  const questionSeed = sha256Hex(`q:${roundId}:${latest}`);
  const template = pickTemplate(questionSeed);
  const question = instantiateQuestion(
    template,
    questionSeed,
    roundId,
    openedAt,
    seedLedger,
    config.commitWindowSeconds,
    config.revealWindowSeconds,
  );
  const questionHash = sha256Hex(canonicalize(question));
  const closeTs = Math.floor(openedAt.getTime() / 1000) + config.commitWindowSeconds;
  const revealCloseTs = closeTs + config.revealWindowSeconds;

  let onChainRoundId = roundId;
  try {
    if (config.contractId && config.oracleStellarSecret) {
      const r = await openRoundOnChain(questionHash, seedLedger, closeTs, revealCloseTs);
      onChainRoundId = r.roundId || roundId;
    }
  } catch (err) {
    console.warn("open_round on-chain failed (continuing in dry-run)", err);
  }

  question.roundId = onChainRoundId;
  currentState = {
    question,
    phase: "commit",
    commits: [],
    reveals: {},
  };
  // Persist to SQLite before publishing — that way any subscriber that
  // immediately writes to the DB sees the round row already exists.
  try {
    recordRoundOpened(question, questionHash);
  } catch (err) {
    console.warn("[oracle] failed to persist round.opened to db", err);
  }
  bus.publish({ type: "round.opened", data: question });
  bus.publish({ type: "round.phase", data: { roundId: onChainRoundId, phase: "commit" } });

  // Wait for the commit window to close — or for all known agents to commit,
  // whichever comes first. Lookup the agent count from the runner; while
  // sleeping, watch the bus for agent.commit events and short-circuit when
  // we hit the count (with a 5s minimum so the UI has time to show "commit"
  // before flipping to "sealed").
  await waitForCommits(onChainRoundId);
  currentState.phase = "sealed";
  bus.publish({ type: "round.phase", data: { roundId: onChainRoundId, phase: "sealed" } });

  // Run the simulation.
  currentState.phase = "simulate";
  bus.publish({ type: "round.phase", data: { roundId: onChainRoundId, phase: "simulate" } });

  // Resolve the seed: wait until the target ledger has closed, then fetch hash.
  // If the ledger isn't there yet, use a deterministic fallback so the round
  // can still settle in the demo.
  const seedHex = await resolveSeed(seedLedger);
  const edgeBatch: { from: string; to: string; seq: number; content: string }[] = [];
  const totalSimMs = config.revealWindowSeconds * 1000 * 0.75;
  const expectedMessages = config.mirofish.personas * config.mirofish.ticks;
  const pacingMs = Math.max(20, Math.floor(totalSimMs / Math.max(1, expectedMessages)));

  const onMessage = (m: PersonaMessage) => {
    bus.publish({ type: "persona.message", data: m });
    try { recordPersonaMessage(m); } catch { /* best-effort */ }
    edgeBatch.push({ from: m.from, to: m.to, seq: m.seq, content: m.content });
    if (edgeBatch.length >= 100) {
      const batch = edgeBatch.splice(0, edgeBatch.length);
      // Fire-and-forget; tx emission is best-effort.
      emitEdgeBatch(batch).catch((e) => console.warn("edge batch failed", e));
    }
  };
  const sim = await simulate({
    scenario: question,
    seed: seedHex,
    personaCount: config.mirofish.personas,
    ticks: config.mirofish.ticks,
    maxLlmCalls: config.mirofish.maxLlmPerRound,
    onMessage,
    onSnapshot: (g) => {
      bus.publish({ type: "graph.snapshot", data: g });
    },
    pacingMs,
  });
  if (edgeBatch.length > 0) {
    await emitEdgeBatch(edgeBatch.splice(0, edgeBatch.length)).catch(() => undefined);
  }

  currentState.phase = "reveal";
  bus.publish({ type: "round.phase", data: { roundId: onChainRoundId, phase: "reveal" } });

  // Hold the reveal window open so agents have time to reveal AND so the
  // contract's `now > reveal_close_ts` guard is satisfied at settle time.
  const revealCloseMs = revealCloseTs * 1000 + 3000; // +3s buffer for ledger close
  const waitForReveal = Math.max(0, revealCloseMs - Date.now());
  if (waitForReveal > 0) await sleep(waitForReveal);

  // Sign verdict and settle.
  const key = config.oracleSigningSecret ? deriveKey(config.oracleSigningSecret) : null;
  let resolution: RoundResolution;
  let settledOnChain = false;
  if (key) {
    const payload = settlePayload(onChainRoundId, questionHash, seedHex, sim.verdict);
    const signature = sign(payload, key);
    resolution = {
      roundId: onChainRoundId,
      questionId: question.id,
      verdict: sim.verdict,
      distribution: sim.distribution,
      seed: seedHex,
      signature,
      oraclePubkey: key.pubkey,
      resolvedAt: new Date().toISOString(),
    };
    if (config.contractId && config.oracleStellarSecret) {
      // Retry settle up to 3× — transient ledger-timing or RPC issues
      // shouldn't leave a round stuck in "Sealed" forever.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await settleOnChain(onChainRoundId, sim.verdict, seedHex, signature);
          settledOnChain = true;
          break;
        } catch (err) {
          console.warn(
            `[oracle] settle on-chain attempt ${attempt + 1}/3 failed:`,
            (err as Error).message,
          );
          if (attempt < 2) await sleep(5000);
        }
      }
      if (!settledOnChain) {
        console.error(
          `[oracle] settle on-chain EXHAUSTED for round ${onChainRoundId}; rep not distributed. Verdict=${sim.verdict}, seed=${seedHex.slice(0, 12)}…`,
        );
      }
    }
  } else {
    resolution = {
      roundId: onChainRoundId,
      questionId: question.id,
      verdict: sim.verdict,
      distribution: sim.distribution,
      seed: seedHex,
      signature: "",
      oraclePubkey: "",
      resolvedAt: new Date().toISOString(),
    };
  }
  currentState.resolution = resolution;
  try { recordResolution(resolution); } catch { /* best-effort */ }
  bus.publish({ type: "round.resolved", data: resolution });
  // ONLY mark this round as "settled" in the local DB if the on-chain
  // settle() tx actually succeeded. Otherwise it's still "resolved" (verdict
  // known) but not "settled" (rep not distributed), so the UI doesn't lie.
  if (settledOnChain || !config.contractId) {
    currentState.phase = "settled";
    try { recordSettled(onChainRoundId); } catch { /* best-effort */ }
    bus.publish({ type: "round.phase", data: { roundId: onChainRoundId, phase: "settled" } });
  } else {
    // Stay in "reveal" phase rather than promoting to "settled"; the next
    // round will move things forward anyway.
    console.warn(`[oracle] round ${onChainRoundId} resolved but NOT settled on-chain — leaving phase=reveal`);
    bus.publish({ type: "round.phase", data: { roundId: onChainRoundId, phase: "reveal" } });
  }

  // Generate an AI narrative summary in the background. We don't await — it
  // can finish a few seconds after the round is technically settled and the
  // detail-modal will pick it up on the next fetch.
  generateAiSummary(onChainRoundId, question, sim, reveals).catch((err) =>
    console.warn(`[oracle] ai summary failed for round ${onChainRoundId}`, err),
  );
  // Refresh the world narrative every 3 settled rounds (cheap on Gemini
  // quota, fresh enough to feel alive). Also re-runs on round 1 so users
  // get a narrative the first time they open the page.
  const sinceLast = getRoundsSinceLastNarrative();
  if (sinceLast >= 3 || sinceLast === 1) {
    generateWorldNarrative().catch((err) =>
      console.warn("[oracle] world narrative failed", err),
    );
  }

  // Hold the final state on screen briefly before opening the next round.
  await sleep(Math.max(0, config.roundSeconds * 1000 - elapsedSince(openedAt)));

  unsubAccount();
  const summary = {
    roundId: onChainRoundId,
    templateId: question.templateId,
    blurb: question.scenario.length > 90 ? question.scenario.slice(0, 87) + "…" : question.scenario,
    verdict: sim.verdict,
    confidence: sim.distribution[sim.verdict],
    correct: reveals.filter((r) => r.answer === sim.verdict).length,
    revealed: reveals.length,
    txCount,
    resolvedAt: resolution.resolvedAt,
  };
  recordRound(summary);
  bus.publish({ type: "round.history", data: summary });
}

/**
 * Generate a 3-4 sentence Gemini narrative for a settled round. Best-effort:
 * if Gemini errors or the result is empty, we leave the column null and the
 * UI just shows a fallback line.
 */
async function generateAiSummary(
  roundId: number,
  question: QuestionScenario,
  sim: { verdict: "A" | "B" | "C" | "D"; distribution: Record<"A" | "B" | "C" | "D", number>; totalMessages: number },
  reveals: Array<{ agent: string; answer: "A" | "B" | "C" | "D" }>,
): Promise<void> {
  const sample = bus.snapshot()
    .filter((e) => e.type === "persona.message" && e.data.roundId === roundId)
    .slice(0, 5)
    .map((e) => `${e.type === "persona.message" ? `${e.data.from}→${e.data.to}: ${e.data.content}` : ""}`)
    .join("\n");
  const correct = reveals.filter((r) => r.answer === sim.verdict).length;
  const total = reveals.length;
  const prompt = [
    `SCENARIO: ${question.scenario}`,
    "",
    "OPTIONS:",
    `  A) ${question.options.A}`,
    `  B) ${question.options.B}`,
    `  C) ${question.options.C}`,
    `  D) ${question.options.D}`,
    "",
    `VERDICT: ${sim.verdict} (confidence ${(sim.distribution[sim.verdict] * 100).toFixed(1)}%)`,
    `DISTRIBUTION: A=${(sim.distribution.A * 100).toFixed(0)}% B=${(sim.distribution.B * 100).toFixed(0)}% C=${(sim.distribution.C * 100).toFixed(0)}% D=${(sim.distribution.D * 100).toFixed(0)}%`,
    `AGENT RESULTS: ${correct} of ${total} agents picked the verdict`,
    `SIMULATION SIZE: ${sim.totalMessages} persona messages exchanged`,
    "",
    "SAMPLE PERSONA EXCHANGES:",
    sample || "(none recorded)",
  ].join("\n");
  const system = [
    "You're summarizing a single round of a multi-agent reasoning game where",
    "AI agents predict what a simulated society of personas will decide about",
    "a real-world kale-farming dilemma. Write a tight 3-4 sentence narrative",
    "summary in plain English that explains:",
    "  1. What MiroFish (the simulator) decided and why",
    "  2. How the agents did vs the verdict",
    "  3. One concrete theme or argument from the persona dialogue",
    "Be factual, no filler, no hedging, no headers. Return plain text only.",
  ].join(" ");
  try {
    const { text } = await callLlm(
      [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      { maxTokens: 600, temperature: 0.5 },
    );
    const clean = text.trim().replace(/^summary:\s*/i, "");
    if (clean.length > 20) {
      recordAiSummary(roundId, clean.slice(0, 1200));
    }
  } catch (err) {
    console.warn(`[oracle] gemini summary failed for round ${roundId}`, err);
  }
}

/**
 * Generate the cumulative "world state" narrative — what's happened across
 * every settled round so far, woven into a 4-6 sentence story. Gemini.
 * Stored in the world_state table; the /world endpoint exposes it.
 */
async function generateWorldNarrative(): Promise<void> {
  const events = getWorldEvents();
  if (events.length === 0) return;
  const lines = events
    .map(
      (e, i) =>
        `${i + 1}. [Round ${e.roundId}, ${e.templateId}] Verdict ${e.verdict}: ${e.outcome}`,
    )
    .join("\n");
  const system =
    "You write the running newsreel of a simulated US kale-farming reality. " +
    "Each round below already happened — chain them into a 4-6 sentence " +
    "narrative ('the world so far') in present tense, third person, plain " +
    "text. Make it feel like a kale-industry trade-publication recap. No " +
    "headers, no bullet points, no hedging, no preamble. Mention specific " +
    "regions, regulations, or actors from the events where it sharpens the " +
    "story. End with a one-line forward look at what tomorrow's growers face.";
  const user = `EVENTS (in order):\n${lines}\n\nRound count so far: ${events.length}`;
  try {
    const { text } = await callLlm(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 700, temperature: 0.6 },
    );
    const clean = text.trim().replace(/^narrative:\s*/i, "");
    if (clean.length > 30) {
      recordWorldNarrative(clean.slice(0, 2000), events.length);
    }
  } catch (err) {
    console.warn("[oracle] world narrative call failed", err);
  }
}

async function waitForCommits(roundId: number): Promise<void> {
  const expected = await getExpectedCommitterCount();
  if (expected <= 0) {
    await sleep(config.commitWindowSeconds * 1000);
    return;
  }
  let committed = 0;
  const unsub = bus.subscribe((ev) => {
    if (ev.type === "agent.commit" && ev.data.roundId === roundId) committed++;
  });
  const start = Date.now();
  const deadline = start + config.commitWindowSeconds * 1000;
  // Minimum 5s commit phase so the UI has a chance to show the phase pill.
  const minPhase = start + 5_000;
  try {
    while (true) {
      if (committed >= expected && Date.now() >= minPhase) return;
      if (Date.now() >= deadline) return;
      await sleep(500);
    }
  } finally {
    unsub();
  }
}

async function getExpectedCommitterCount(): Promise<number> {
  try {
    const res = await fetch(`${config.runnerUrl}/agents`);
    if (!res.ok) return 0;
    const body = (await res.json()) as { agents?: unknown[] };
    return Array.isArray(body.agents) ? body.agents.length : 0;
  } catch {
    return 0;
  }
}

async function resolveSeed(targetLedger: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const hash = await getLedgerCloseHash(targetLedger).catch(() => undefined);
    if (hash) return hash;
    await sleep(2000);
  }
  // Fallback: deterministic from round + clock to avoid stalling the demo.
  return sha256Hex(`fallback:${targetLedger}:${Date.now()}`);
}

function elapsedSince(d: Date): number {
  return Date.now() - d.getTime();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function oracleInfo() {
  return {
    stellarAddress: safe(() => oraclePublicKey()),
    signingPubkey: safe(() => deriveKey(config.oracleSigningSecret).pubkey),
    network: config.network,
    contractId: config.contractId,
  };
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
