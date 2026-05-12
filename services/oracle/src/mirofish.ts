import type {
  Choice,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  PersonaMessage,
  QuestionScenario,
} from "@mirofish/shared";
import { makeRng } from "@mirofish/shared";
import {
  aggregateVerdict,
  spawnPersonas,
  topChoice,
  type Persona,
} from "./personas.js";
import { renderMessage } from "./dialogue.js";
import { callPersonaLlm } from "./llm.js";

export interface SimulateOptions {
  scenario: QuestionScenario;
  seed: string;
  personaCount: number;
  ticks: number;
  /** Hard cap on real LLM calls per round. After this many, fall back to
   *  templated dialogue + deterministic stance update for the remainder. */
  maxLlmCalls: number;
  /** Called for each persona-to-persona message. */
  onMessage: (m: PersonaMessage) => Promise<void> | void;
  /** Called once per tick with the current graph snapshot. */
  onSnapshot: (g: GraphSnapshot) => Promise<void> | void;
  /** Inter-message pacing (ms). Ignored when LLM mode throttles itself. */
  pacingMs: number;
}

export interface SimulationResult {
  verdict: Choice;
  distribution: Record<Choice, number>;
  totalMessages: number;
}

/**
 * Run the simulation. Each persona-to-persona exchange asks the configured
 * LLM (OpenRouter → nvidia/nemotron-3-super-120b-a12b:free) for both the
 * dialogue line AND the receiver's updated stance vector. If the LLM call
 * fails (rate-limit, network), we fall back to the deterministic template so
 * the round still completes — but the verdict aggregates whatever stances
 * the LLM did produce, so non-determinism is preserved across runs.
 *
 * Naming note: the upstream MiroFish project (github.com/666ghj/MiroFish,
 * AGPL-3.0) pioneered the "multi-agent simulated reality" framing. This
 * oracle is a lightweight reimplementation; the persona dialogue + stance
 * update is now LLM-backed so the verdict reflects real reasoning, not a
 * deterministic templated walk.
 */
export async function simulate(opts: SimulateOptions): Promise<SimulationResult> {
  const { scenario, seed, personaCount, ticks, maxLlmCalls, onMessage, onSnapshot } = opts;
  const personas = spawnPersonas(seed, personaCount);
  const rng = makeRng(`${seed}:sim`);
  const edges = new Map<string, GraphEdge>();
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  let seq = 0;
  let llmCalls = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const pairs = scheduleTick(personas, rng);
    for (const [src, dst] of pairs) {
      const useLlm = llmCalls < maxLlmCalls;
      if (useLlm) llmCalls++;
      const { content, argued } = useLlm
        ? await llmExchange(scenario, src, dst, seed, seq)
        : fallbackExchange(scenario, src, dst, topChoice(src.stance), seed, seq);
      const key = edgeKey(src.id, dst.id);
      const edge = edges.get(key) ?? { from: src.id, to: dst.id, weight: 0, settled: false };
      edge.weight += 1;
      edges.set(key, edge);

      const message: PersonaMessage = {
        roundId: scenario.roundId,
        seq: seq++,
        tick,
        from: src.id,
        to: dst.id,
        content,
        sentiment: { ...dst.stance },
        emittedAt: new Date().toISOString(),
      };
      await onMessage(message);
      void argued; // currently unused — could be surfaced as edge metadata later
      // Emit a snapshot every few messages too, so the graph visibly grows
      // during the simulation instead of jumping in just twice per round.
      if (seq % 5 === 0) {
        await onSnapshot(buildSnapshot(scenario.roundId, tick, personas, edges));
      }
    }
    await onSnapshot(buildSnapshot(scenario.roundId, tick, personas, edges));
  }
  const { verdict, distribution } = aggregateVerdict(personas);
  return { verdict, distribution, totalMessages: seq };
}

interface ExchangeResult {
  content: string;
  argued: Choice;
}

/** One LLM-driven exchange. Updates `dst.stance` in place. */
async function llmExchange(
  scenario: QuestionScenario,
  src: Persona,
  dst: Persona,
  seed: string,
  seq: number,
): Promise<ExchangeResult> {
  const argued = topChoice(src.stance);
  const prompt = buildPrompt(scenario, src, dst, argued);
  // Retry up to 3× with exponential backoff before reaching for the
  // templated fallback. Most Gemini errors are transient (503/429), and one
  // extra second on a 200ms call is cheap insurance against fake dialogue.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text } = await callPersonaLlm(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        { maxTokens: 220, temperature: 0.9 },
      );
      const parsed = parseExchange(text);
      if (parsed) {
        dst.stance = parsed.stance;
        return { content: parsed.line, argued };
      }
      // Unparseable response — retry with the same prompt; the model is
      // non-deterministic and the next sample usually emits the format.
      lastErr = new Error("unparseable LLM response");
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 2) {
      // 1s, 2s backoff
      await sleep(1000 * (attempt + 1));
    }
  }
  console.warn(
    `[oracle] llm exchange exhausted retries at seq ${seq}:`,
    lastErr instanceof Error ? lastErr.message : String(lastErr),
  );
  return fallbackExchange(scenario, src, dst, argued, seed, seq);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const SYSTEM_PROMPT = `You are simulating a townsperson in a fictional scenario. You will be given:
- the scenario
- the four possible outcomes (A/B/C/D)
- your role + name
- the person you're talking to
- the option you currently lean toward (the one you'll argue for)
- the listener's current stance distribution

Respond with EXACTLY this format (no markdown, no extra commentary):

LINE: <one sentence the speaker says to the listener, max 200 chars, in-character>
LISTENER_STANCE: A=<float 0-1> B=<float 0-1> C=<float 0-1> D=<float 0-1>

The listener's stance should shift slightly toward what the speaker is arguing, in proportion to how persuasive the speaker is. It must still sum to ~1.0.`;

function buildPrompt(
  scenario: QuestionScenario,
  src: Persona,
  dst: Persona,
  argued: Choice,
): string {
  const dstStance = stanceLine(dst.stance);
  return [
    `SCENARIO: ${scenario.scenario}`,
    `OPTIONS:`,
    `  A) ${scenario.options.A}`,
    `  B) ${scenario.options.B}`,
    `  C) ${scenario.options.C}`,
    `  D) ${scenario.options.D}`,
    ``,
    `SPEAKER: ${src.role} ${src.name} (charisma=${src.charisma.toFixed(2)})`,
    `LISTENER: ${dst.role} ${dst.name} (openness=${dst.openness.toFixed(2)})`,
    `SPEAKER ARGUES FOR: ${argued}`,
    `LISTENER CURRENT STANCE: ${dstStance}`,
  ].join("\n");
}

function stanceLine(s: Record<Choice, number>): string {
  return (["A", "B", "C", "D"] as Choice[]).map((c) => `${c}=${s[c].toFixed(2)}`).join(" ");
}

interface ParsedExchange {
  line: string;
  stance: Record<Choice, number>;
}

function parseExchange(text: string): ParsedExchange | null {
  // Reasoning models often paraphrase their chain-of-thought before the final
  // structured output, so we always parse the LAST occurrence of each marker.
  // Accept variations: "LISTENER_STANCE" or "Listener Stance" or "LISTENER STANCE".
  const lineMatches = [...text.matchAll(/LINE:\s*(.+)/gi)];
  const stanceMatches = [...text.matchAll(
    /LISTENER[_\s]STANCE:\s*A\s*=\s*([\d.]+)[\s,]+B\s*=\s*([\d.]+)[\s,]+C\s*=\s*([\d.]+)[\s,]+D\s*=\s*([\d.]+)/gi,
  )];
  const lineMatch = lineMatches[lineMatches.length - 1];
  const stanceMatch = stanceMatches[stanceMatches.length - 1];
  if (!lineMatch || !stanceMatch || !lineMatch[1] || !stanceMatch[1] || !stanceMatch[2] || !stanceMatch[3] || !stanceMatch[4]) return null;
  // Skip the placeholder echo the model often emits ("LINE: <one sentence>").
  const rawLine = lineMatch[1].trim();
  const line = rawLine.startsWith("<") ? "" : rawLine.slice(0, 300);
  if (!line) return null;
  const a = Number(stanceMatch[1]);
  const b = Number(stanceMatch[2]);
  const c = Number(stanceMatch[3]);
  const d = Number(stanceMatch[4]);
  if (![a, b, c, d].every((x) => Number.isFinite(x) && x >= 0)) return null;
  const sum = a + b + c + d || 1;
  return {
    line,
    stance: { A: a / sum, B: b / sum, C: c / sum, D: d / sum },
  };
}

export function fallbackExchange(
  scenario: QuestionScenario,
  src: Persona,
  dst: Persona,
  argued: Choice,
  seed: string,
  seq: number,
): ExchangeResult {
  // Deterministic templated dialogue + a gentle stance pull toward `argued`.
  const content = renderMessage(scenario, src, dst, argued, seed, seq);
  const pull = src.charisma * dst.openness * 0.25;
  const others = (["A", "B", "C", "D"] as Choice[]).filter((c) => c !== argued);
  const next: Record<Choice, number> = { ...dst.stance };
  const otherSum = others.reduce((s, c) => s + next[c], 0);
  if (otherSum > 0) {
    for (const c of others) {
      const take = (next[c] / otherSum) * pull;
      next[c] = Math.max(0, next[c] - take);
    }
    next[argued] += pull;
  }
  const sum = next.A + next.B + next.C + next.D || 1;
  dst.stance = {
    A: next.A / sum,
    B: next.B / sum,
    C: next.C / sum,
    D: next.D / sum,
  };
  return { content, argued };
}

function scheduleTick(personas: Persona[], rng: () => number): [Persona, Persona][] {
  const out: [Persona, Persona][] = [];
  for (const src of personas) {
    if (rng() < 0.15) continue;
    const partnerId = chooseNeighbour(src, rng);
    const dst = personas.find((p) => p.id === partnerId);
    if (dst && dst.id !== src.id) out.push([src, dst]);
  }
  return out;
}

function chooseNeighbour(p: Persona, rng: () => number): string | undefined {
  if (p.neighbours.length === 0) return undefined;
  return p.neighbours[Math.floor(rng() * p.neighbours.length)];
}

function buildSnapshot(
  roundId: number,
  tick: number,
  personas: Persona[],
  edges: Map<string, GraphEdge>,
): GraphSnapshot {
  const nodes: GraphNode[] = personas.map((p) => ({
    id: p.id,
    label: `${p.role} ${p.name}`,
    cluster: topChoice(p.stance),
    influence: p.charisma,
  }));
  return {
    roundId,
    tick,
    nodes,
    edges: [...edges.values()],
  };
}
