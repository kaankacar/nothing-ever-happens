"use client";

import { create } from "zustand";
import type {
  AgentReveal,
  AgentSubmission,
  ArenaEvent,
  GraphSnapshot,
  HostedAgent,
  PersonaMessage,
  QuestionScenario,
  RoundPhase,
  RoundResolution,
  RoundSummary,
  TxEvent,
} from "@mirofish/shared";

interface WorldEvent {
  roundId: number;
  verdict: string;
  scenario: string;
  outcome: string;
  templateId: string;
  resolvedAt: string;
}

interface WorldState {
  settledCount: number;
  narrative: string;
  generatedAt: string;
  events: WorldEvent[];
}

interface ArenaState {
  question?: QuestionScenario;
  phase: RoundPhase | "idle";
  graph?: GraphSnapshot;
  messages: PersonaMessage[];
  txs: TxEvent[];
  resolution?: RoundResolution;
  agents: HostedAgent[];
  commits: AgentSubmission[];
  reveals: AgentReveal[];
  history: RoundSummary[];
  /** Connected wallet address (Tier 2 / 3). null when unconnected. */
  operator: string | null;
  /** Cumulative count of `tx` events since the page loaded — survives across
   *  rounds (per-round txs are reset on `round.opened`, this isn't). */
  totalTxs: number;
  /** Currently-inspected persona id from the graph (null = none). */
  selectedNode: string | null;
  /** Round summary currently shown in the detail modal (null = closed). */
  detailRound: RoundSummary | null;
  /** Agent address whose detail modal is currently open (null = closed). */
  detailAgent: string | null;
  /** When true, the "What's happening?" modal is open. */
  helpOpen: boolean;
  /** Running narrative + event list for the cumulative world state. */
  world: WorldState | null;
  /** When true, the world modal is open. */
  worldOpen: boolean;
  /** Which stats modal is open (clicked from header counters). */
  statsModal: "txs-round" | "msgs" | "total" | null;
  setOperator: (o: string | null) => void;
  setSelectedNode: (id: string | null) => void;
  setDetailRound: (r: RoundSummary | null) => void;
  setDetailAgent: (a: string | null) => void;
  setHelpOpen: (open: boolean) => void;
  setWorld: (w: WorldState | null) => void;
  setWorldOpen: (open: boolean) => void;
  setStatsModal: (m: "txs-round" | "msgs" | "total" | null) => void;
  connect: () => void;
  setAgents: (a: HostedAgent[]) => void;
  addHistory: (s: RoundSummary) => void;
}

const ORACLE = process.env.NEXT_PUBLIC_ORACLE_URL ?? "http://localhost:4000";
const RUNNER = process.env.NEXT_PUBLIC_RUNNER_URL ?? "http://localhost:4001";

export const useArena = create<ArenaState>((set, get) => ({
  phase: "idle",
  messages: [],
  txs: [],
  agents: [],
  commits: [],
  reveals: [],
  history: [],
  operator: null,
  totalTxs: 0,
  selectedNode: null,
  detailRound: null,
  detailAgent: null,
  helpOpen: false,
  world: null,
  worldOpen: false,
  statsModal: null,
  setOperator: (operator) => set({ operator }),
  setSelectedNode: (id) => set({ selectedNode: id }),
  setDetailRound: (r) => set({ detailRound: r }),
  setDetailAgent: (a) => set({ detailAgent: a }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setWorld: (w) => set({ world: w }),
  setWorldOpen: (open) => set({ worldOpen: open }),
  setStatsModal: (m) => set({ statsModal: m }),
  setAgents: (agents) => set({ agents }),
  addHistory: (s) => {
    const next = [s, ...get().history.filter((h) => h.roundId !== s.roundId)];
    if (next.length > 10) next.length = 10;
    set({ history: next });
  },
  connect: () => {
    if (typeof window === "undefined") return;
    const url = `${ORACLE}/events`;
    const es = new EventSource(url);
    const handler = (raw: MessageEvent) => {
      try {
        const e = JSON.parse(raw.data) as ArenaEvent;
        apply(set, get, e);
      } catch {
        /* ignore */
      }
    };
    for (const t of [
      "round.opened",
      "round.phase",
      "persona.message",
      "graph.snapshot",
      "round.resolved",
      "round.settled",
      "tx",
      "agent.commit",
      "agent.reveal",
    ]) {
      es.addEventListener(t, handler as EventListener);
    }
    es.onmessage = handler;

    // Initial fetch + periodic refresh so the leaderboard reflects on-chain
    // reputation as soon as the runner has polled it (within ~30s of settle).
    const fetchAgents = () => {
      fetch(`${RUNNER}/agents`)
        .then((r) => r.json())
        .then((j) => set({ agents: j.agents ?? [] }))
        .catch(() => undefined);
    };
    fetchAgents();
    if (typeof window !== "undefined") {
      window.setInterval(fetchAgents, 15_000);
    }
  },
}));

function apply(
  set: (partial: Partial<ArenaState> | ((state: ArenaState) => Partial<ArenaState>)) => void,
  get: () => ArenaState,
  e: ArenaEvent,
): void {
  switch (e.type) {
    case "round.opened":
      set({
        question: e.data,
        phase: "commit",
        graph: undefined,
        messages: [],
        commits: [],
        reveals: [],
        resolution: undefined,
        txs: [],
      });
      break;
    case "round.phase":
      set({ phase: e.data.phase });
      break;
    case "graph.snapshot":
      set({ graph: e.data });
      break;
    case "persona.message": {
      // Dedupe by (roundId, seq) — SSE replay on reconnect would otherwise
      // produce 100+ duplicate-key React warnings.
      const existing = get().messages;
      const newKey = `${e.data.roundId}-${e.data.seq}`;
      if (existing.some((m) => `${m.roundId}-${m.seq}` === newKey)) break;
      const next = [...existing, e.data];
      if (next.length > 200) next.splice(0, next.length - 200);
      set({ messages: next });
      break;
    }
    case "tx": {
      const next = [e.data, ...get().txs];
      if (next.length > 120) next.splice(120);
      set({ txs: next, totalTxs: get().totalTxs + 1 });
      break;
    }
    case "agent.commit": {
      // Dedupe by (roundId, agent) so SSE replay doesn't insert the same row
      // twice on reconnect — react would warn about duplicate keys.
      const existing = get().commits;
      const key = `${e.data.roundId}:${e.data.agent}`;
      if (existing.some((c) => `${c.roundId}:${c.agent}` === key)) break;
      set({ commits: [...existing, e.data] });
      break;
    }
    case "agent.reveal": {
      const existing = get().reveals;
      const key = `${e.data.roundId}:${e.data.agent}`;
      if (existing.some((r) => `${r.roundId}:${r.agent}` === key)) break;
      set({ reveals: [...existing, e.data] });
      break;
    }
    case "round.resolved":
      set({ resolution: e.data });
      break;
    case "round.history": {
      const next = [e.data, ...get().history.filter((h) => h.roundId !== e.data.roundId)];
      if (next.length > 10) next.length = 10;
      set({ history: next });
      break;
    }
    case "round.settled":
      // Could refresh leaderboard here.
      break;
  }
}

export { ORACLE, RUNNER };
