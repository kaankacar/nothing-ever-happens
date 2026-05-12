/**
 * Shared protocol types for the MiroFish Arena.
 *
 * These types are the contract between:
 *   - Soroban contract (LiveRound)   - emits round/payout events
 *   - Oracle service                 - publishes question + signs result
 *   - Agent runner                   - executes hosted-prompt agents
 *   - Web frontend                   - subscribes to live state via SSE
 *
 * Keep this file dependency-free; it is imported by both Node and browser code.
 */

export type Choice = "A" | "B" | "C" | "D";

export const CHOICES: readonly Choice[] = ["A", "B", "C", "D"] as const;

export interface QuestionScenario {
  /** Stable id derived from the seed: round_id + template_id. */
  id: string;
  /** Round number this question belongs to. */
  roundId: number;
  /** Template the question was instantiated from. */
  templateId: string;
  /** 3-5 sentence fictional scenario. */
  scenario: string;
  /** Four mutually exclusive outcomes the agents must rank. */
  options: Record<Choice, string>;
  /** Domain tag for filtering / theming (economy, social, technology, ...). */
  tags: string[];
  /** When the round opened. ISO-8601. */
  openedAt: string;
  /** When submissions close (3 min after openedAt). */
  closesAt: string;
  /** When MiroFish resolves and reveal opens (5 min after openedAt). */
  resolvesAt: string;
  /** Stellar ledger sequence whose close hash will be the resolution seed. */
  seedLedger: number;
}

export interface AgentSubmission {
  /** Agent's on-chain public key (Stellar address). */
  agent: string;
  /** Round id this submission belongs to. */
  roundId: number;
  /** SHA256(answer || nonce) — submitted during the commit window. */
  commitHash: string;
  /** Stellar tx hash that contained the commit. */
  commitTx: string;
  /** Submitted at. ISO-8601. */
  submittedAt: string;
}

export interface AgentReveal {
  agent: string;
  roundId: number;
  /** The chosen option. */
  answer: Choice;
  /** Nonce used in the commit hash. */
  nonce: string;
  /** Free-form reasoning trace, displayed in the UI but not scored. */
  reasoning: string;
  /** Stellar tx hash that contained the reveal. */
  revealTx: string;
  revealedAt: string;
}

/** A persona-to-persona message inside the MiroFish simulation. */
export interface PersonaMessage {
  /** Round id. */
  roundId: number;
  /** Monotonically increasing within a round. */
  seq: number;
  /** Simulation tick (0..MIROFISH_TICKS-1). */
  tick: number;
  /** Persona id (stable within a round). */
  from: string;
  /** Persona id receiving the message. */
  to: string;
  /** The actual message content the personas exchange. */
  content: string;
  /** Sentiment toward each option, used by the graph viz to color clusters. */
  sentiment: Record<Choice, number>;
  /** Stellar tx hash if this interaction was settled on-chain (MPP edge). */
  tx?: string;
  emittedAt: string;
}

/** Aggregate state of the MiroFish graph at a point in time. */
export interface GraphSnapshot {
  roundId: number;
  tick: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  /** Persona id (matches PersonaMessage.from/to). */
  id: string;
  /** Display label (e.g. "Mayor", "Farmer #3"). */
  label: string;
  /** Cluster identifier — personas leaning toward the same option share a cluster. */
  cluster: Choice | "neutral";
  /** Persuasion strength 0..1, used for node radius. */
  influence: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Number of messages exchanged so far. */
  weight: number;
  /** True once this edge has settled an MPP charge. */
  settled: boolean;
}

/** Oracle's final, signed verdict for a round. */
export interface RoundResolution {
  roundId: number;
  questionId: string;
  /** The simulation's verdict — the option agents are scored against. */
  verdict: Choice;
  /** Probability distribution MiroFish assigned to each option. */
  distribution: Record<Choice, number>;
  /** Resolution seed (ledger close hash) — anyone can replay with this. */
  seed: string;
  /** Oracle Ed25519 signature over the canonical JSON of this object minus `signature`. */
  signature: string;
  /** Oracle public key for verification. */
  oraclePubkey: string;
  resolvedAt: string;
}

export type RoundPhase =
  | "opening"   // pre-commit, < 5s after openedAt
  | "commit"    // submissions accepted
  | "sealed"    // commits closed, awaiting seed ledger
  | "simulate"  // MiroFish is running, personas chattering
  | "reveal"    // agents reveal; verdict known
  | "settled";  // payouts done

export interface RoundState {
  question: QuestionScenario;
  phase: RoundPhase;
  /** Public-key list of agents who have committed. */
  commits: string[];
  /** Reveals (agent → reveal). */
  reveals: Record<string, AgentReveal>;
  resolution?: RoundResolution;
  /** Top-N agents who win reputation. Filled at settle. */
  winners?: WinnerEntry[];
}

export interface WinnerEntry {
  agent: string;
  rank: number;
  reputationDelta: number;
  payoutTx: string;
}

/** Live Stellar tx event for the right-side ticker in the UI. */
export interface TxEvent {
  hash: string;
  kind:
    | "agent_commit"
    | "agent_reveal"
    | "tool_charge"
    | "persona_edge"
    | "payout"
    | "tip";
  source: string;
  destination?: string;
  amount?: string;
  asset?: string;
  ledger: number;
  ts: string;
  /** Free-form display label, e.g. "P124 → P89". */
  label?: string;
}

/** Hosted-prompt agent record submitted via the onboarding form. */
export interface HostedAgent {
  id: string;
  /** Operator address — the user's wallet that owns the reputation. In the
   *  custodial fallback this equals `delegateAddress`. */
  operator: string;
  /** Delegate address — runner-custodied key that signs commit/reveal txs. */
  delegateAddress: string;
  /** Backward-compatible alias for `delegateAddress`. */
  stellarAddress: string;
  displayName: string;
  systemPrompt: string;
  /** The free-tier models the project supports. Selected at registration;
   *  the runner routes to the matching provider. */
  model:
    | "gemini-2.5-flash-lite"
    | "nvidia/nemotron-3-super-120b-a12b:free"
    | "llama-3.1-8b-instant";
  /** True if the operator is an external wallet (Freighter / passkey / etc). */
  walletConnected: boolean;
  createdAt: string;
  /** Soulbound rep token balance (credited to operator on-chain). */
  reputation: number;
  /** Rounds played / wins. */
  stats: { played: number; top3: number; firsts: number };
}

export interface PendingRegistration {
  id: string;
  operator: string;
  delegateAddress: string;
  displayName: string;
  systemPrompt: string;
  model: HostedAgent["model"];
  /** Unsigned, prepared register_agent tx XDR. */
  xdr: string;
  createdAt: string;
  /** Expires 15 minutes after createdAt. */
  expiresAt: string;
}

/** Compact summary of a completed round, used for the history strip. */
export interface RoundSummary {
  roundId: number;
  templateId: string;
  /** First 80 chars of the scenario, no markdown. */
  blurb: string;
  verdict: Choice;
  /** Confidence of the verdict in MiroFish's distribution. */
  confidence: number;
  /** Number of agents who got it right (top-3 cap). */
  correct: number;
  /** Total reveals. */
  revealed: number;
  /** Total Stellar transactions emitted during the round. */
  txCount: number;
  resolvedAt: string;
}

/** Server-Sent Event payload shape. The web app subscribes to one stream per round. */
export type ArenaEvent =
  | { type: "round.opened"; data: QuestionScenario }
  | { type: "round.phase"; data: { roundId: number; phase: RoundPhase } }
  | { type: "agent.commit"; data: AgentSubmission }
  | { type: "agent.reveal"; data: AgentReveal }
  | { type: "persona.message"; data: PersonaMessage }
  | { type: "graph.snapshot"; data: GraphSnapshot }
  | { type: "round.resolved"; data: RoundResolution }
  | { type: "round.settled"; data: { roundId: number; winners: WinnerEntry[] } }
  | { type: "round.history"; data: RoundSummary }
  | { type: "tx"; data: TxEvent };
