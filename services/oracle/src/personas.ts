import type { Choice } from "@mirofish/shared";
import { makeRng, pick } from "@mirofish/shared";

/**
 * Lightweight persona model. Each persona has:
 *   - a stable identity (role + name)
 *   - prior beliefs that bias their stance on the four options
 *   - a small social network (who they tend to talk to)
 *
 * The full MiroFish project uses LLM-backed agents with memory and a GraphRAG
 * substrate. This MVP uses a small templated reasoning model so we can run a
 * dense simulation cheaply and deterministically; LLM-backed personas can be
 * swapped in later by replacing `respond()` in this module.
 */

export interface Persona {
  id: string;
  role: string;
  name: string;
  /** Initial bias (will mutate during simulation). Sums to ~1.0. */
  stance: Record<Choice, number>;
  /** 0..1 — how persuadable. High = flips often. */
  openness: number;
  /** 0..1 — how loudly they argue. High = bigger influence on neighbours. */
  charisma: number;
  /** Neighbour ids (initial small-world graph). */
  neighbours: string[];
}

// Roles drawn from the modern US kale-industry value chain. Each simulated
// persona represents a real stakeholder: growers, packers, buyers, inspectors,
// chefs, investors, etc.
const ROLES = [
  "Grower",
  "Field Manager",
  "Co-op Director",
  "Whole Foods Buyer",
  "USDA Organic Inspector",
  "Agronomist",
  "Crew Lead",
  "Marketing Lead",
  "Restaurant Chef",
  "CSA Coordinator",
  "Seed Sales Rep",
  "Extension Officer",
  "Ag Investor",
  "Regional Distributor",
  "Packing-Shed Foreman",
  "Greenhouse Operator",
  "Truck Driver",
  "Land Trust Officer",
  "Farm Labor Organizer",
  "County Ag Commissioner",
] as const;

const FIRST_NAMES = [
  "Aisha", "Brandon", "Carlos", "Daniela", "Ethan", "Fatima", "Gus",
  "Hannah", "Imani", "Jason", "Kira", "Luis", "Mia", "Noah", "Olivia",
  "Priya", "Quinn", "Rocco", "Sage", "Tomas", "Una", "Vince", "Wendy",
  "Xander", "Yusra", "Zane", "Alex", "Maria", "Devon", "Harper",
];

/** Normalize a stance vector to sum to 1. */
function normalize(s: Record<Choice, number>): Record<Choice, number> {
  const sum = s.A + s.B + s.C + s.D || 1;
  return { A: s.A / sum, B: s.B / sum, C: s.C / sum, D: s.D / sum };
}

export function spawnPersonas(seed: string, count: number): Persona[] {
  const rng = makeRng(seed);
  const personas: Persona[] = [];
  for (let i = 0; i < count; i++) {
    const role = pick(rng, ROLES);
    const name = pick(rng, FIRST_NAMES);
    const initial: Record<Choice, number> = {
      A: rng(),
      B: rng(),
      C: rng(),
      D: rng(),
    };
    personas.push({
      id: `P${i.toString().padStart(3, "0")}`,
      role,
      name,
      stance: normalize(initial),
      openness: 0.2 + rng() * 0.5,
      charisma: 0.2 + rng() * 0.7,
      neighbours: [],
    });
  }
  // Small-world wiring: each persona connects to a few others by index
  // proximity plus a couple of long-range links. Cap proximity so we never
  // wrap further than `count` (JS `%` of a negative number stays negative,
  // and undersized populations + large proximity were producing negative
  // indices and undefined neighbours).
  for (let i = 0; i < count; i++) {
    const p = personas[i]!;
    const maxProx = Math.max(1, Math.floor((count - 1) / 2));
    const proximityCount = Math.min(maxProx, 3 + Math.floor(rng() * 3));
    const set = new Set<string>();
    for (let k = 1; k <= proximityCount; k++) {
      const left = ((i - k) % count + count) % count;
      const right = (i + k) % count;
      const leftP = personas[left];
      const rightP = personas[right];
      if (leftP) set.add(leftP.id);
      if (rightP) set.add(rightP.id);
    }
    // Long-range
    const r1 = personas[Math.floor(rng() * count)];
    const r2 = personas[Math.floor(rng() * count)];
    if (r1) set.add(r1.id);
    if (r2) set.add(r2.id);
    set.delete(p.id);
    p.neighbours = [...set];
  }
  return personas;
}

/**
 * Belief-update step. `src` "argues" toward its highest-stance option; `dst`
 * shifts toward that option in proportion to src's charisma and dst's openness.
 */
export function updateStance(src: Persona, dst: Persona, rng: () => number): {
  argued: Choice;
  before: Record<Choice, number>;
  after: Record<Choice, number>;
} {
  const argued = topChoice(src.stance);
  const before = { ...dst.stance };
  const pull = src.charisma * dst.openness * (0.2 + rng() * 0.3);
  const after: Record<Choice, number> = { ...dst.stance };
  // Move pull mass from the other three options into `argued`, weighted by
  // how much mass they currently hold.
  const others: Choice[] = (["A", "B", "C", "D"] as Choice[]).filter((c) => c !== argued);
  const otherSum = others.reduce((s, c) => s + after[c], 0);
  if (otherSum > 0) {
    for (const c of others) {
      const take = (after[c] / otherSum) * pull;
      after[c] = Math.max(0, after[c] - take);
    }
    after[argued] += pull;
  }
  dst.stance = normalize(after);
  return { argued, before, after: dst.stance };
}

export function topChoice(stance: Record<Choice, number>): Choice {
  let best: Choice = "A";
  let bestVal = -Infinity;
  for (const c of ["A", "B", "C", "D"] as Choice[]) {
    if (stance[c] > bestVal) {
      bestVal = stance[c];
      best = c;
    }
  }
  return best;
}

export function aggregateVerdict(personas: Persona[]): {
  verdict: Choice;
  distribution: Record<Choice, number>;
} {
  const acc: Record<Choice, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of personas) {
    for (const c of ["A", "B", "C", "D"] as Choice[]) {
      acc[c] += p.stance[c] * (0.5 + p.charisma * 0.5);
    }
  }
  const total = acc.A + acc.B + acc.C + acc.D || 1;
  const distribution: Record<Choice, number> = {
    A: acc.A / total,
    B: acc.B / total,
    C: acc.C / total,
    D: acc.D / total,
  };
  let verdict: Choice = "A";
  let bestVal = -Infinity;
  for (const c of ["A", "B", "C", "D"] as Choice[]) {
    if (distribution[c] > bestVal) {
      bestVal = distribution[c];
      verdict = c;
    }
  }
  return { verdict, distribution };
}
