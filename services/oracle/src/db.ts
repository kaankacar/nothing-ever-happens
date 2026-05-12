import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  AgentReveal,
  AgentSubmission,
  PersonaMessage,
  QuestionScenario,
  RoundResolution,
  RoundSummary,
  TxEvent,
} from "@mirofish/shared";

const DB_PATH = process.env.ORACLE_DB_PATH ?? resolve(process.cwd(), "data/arena.db");

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS rounds (
  round_id      INTEGER PRIMARY KEY,
  template_id   TEXT    NOT NULL,
  scenario      TEXT    NOT NULL,
  options       TEXT    NOT NULL, -- JSON {A,B,C,D}
  tags          TEXT    NOT NULL, -- JSON array
  opened_at     TEXT    NOT NULL,
  closes_at     TEXT    NOT NULL,
  resolves_at   TEXT    NOT NULL,
  seed_ledger   INTEGER NOT NULL,
  question_hash TEXT    NOT NULL,
  seed          TEXT,
  verdict       TEXT,
  confidence    REAL,
  distribution  TEXT,             -- JSON {A,B,C,D}
  signature     TEXT,
  oracle_pubkey TEXT,
  resolved_at   TEXT,
  ai_summary    TEXT,             -- 3-4 sentence Gemini narrative
  state         TEXT    NOT NULL DEFAULT 'open' -- open|resolved|settled
);

CREATE TABLE IF NOT EXISTS persona_messages (
  round_id    INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  tick        INTEGER NOT NULL,
  from_id     TEXT    NOT NULL,
  to_id       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  sentiment   TEXT    NOT NULL,
  emitted_at  TEXT    NOT NULL,
  PRIMARY KEY (round_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_events (
  round_id  INTEGER NOT NULL,
  agent     TEXT    NOT NULL,
  kind      TEXT    NOT NULL, -- commit|reveal
  data      TEXT    NOT NULL, -- JSON of AgentSubmission or AgentReveal
  ts        TEXT    NOT NULL,
  PRIMARY KEY (round_id, agent, kind)
);

CREATE TABLE IF NOT EXISTS tx_events (
  hash        TEXT    NOT NULL,
  round_id    INTEGER,
  kind        TEXT    NOT NULL,
  label       TEXT,
  source      TEXT    NOT NULL,
  ledger      INTEGER,
  ts          TEXT    NOT NULL,
  PRIMARY KEY (hash)
);

CREATE INDEX IF NOT EXISTS idx_tx_round ON tx_events (round_id);
CREATE INDEX IF NOT EXISTS idx_msg_round ON persona_messages (round_id);
CREATE INDEX IF NOT EXISTS idx_agent_round ON agent_events (round_id);

CREATE TABLE IF NOT EXISTS world_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  narrative    TEXT    NOT NULL DEFAULT '',
  generated_at TEXT    NOT NULL,
  rounds_at_generation INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO world_state (id, narrative, generated_at, rounds_at_generation)
  VALUES (1, '', '', 0);
`);

// Idempotent migration: add ai_summary column if running against an older
// DB. Must happen BEFORE we `prepare` any statement that references it.
try {
  const cols = db.prepare("PRAGMA table_info(rounds)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "ai_summary")) {
    db.exec("ALTER TABLE rounds ADD COLUMN ai_summary TEXT");
  }
} catch {
  /* fresh DB, nothing to migrate */
}

// ---------- Prepared statements ----------

const insertRound = db.prepare(`
  INSERT OR REPLACE INTO rounds (
    round_id, template_id, scenario, options, tags,
    opened_at, closes_at, resolves_at, seed_ledger, question_hash, state
  ) VALUES (
    @round_id, @template_id, @scenario, @options, @tags,
    @opened_at, @closes_at, @resolves_at, @seed_ledger, @question_hash, 'open'
  )
`);

const updateResolution = db.prepare(`
  UPDATE rounds
     SET seed = @seed,
         verdict = @verdict,
         confidence = @confidence,
         distribution = @distribution,
         signature = @signature,
         oracle_pubkey = @oracle_pubkey,
         resolved_at = @resolved_at,
         state = 'resolved'
   WHERE round_id = @round_id
`);

const markSettled = db.prepare(`UPDATE rounds SET state = 'settled' WHERE round_id = ?`);
const updateAiSummary = db.prepare(`UPDATE rounds SET ai_summary = ? WHERE round_id = ?`);

const insertMessage = db.prepare(`
  INSERT OR IGNORE INTO persona_messages (round_id, seq, tick, from_id, to_id, content, sentiment, emitted_at)
  VALUES (@round_id, @seq, @tick, @from_id, @to_id, @content, @sentiment, @emitted_at)
`);

const insertAgentEvent = db.prepare(`
  INSERT OR REPLACE INTO agent_events (round_id, agent, kind, data, ts)
  VALUES (@round_id, @agent, @kind, @data, @ts)
`);

const insertTx = db.prepare(`
  INSERT OR IGNORE INTO tx_events (hash, round_id, kind, label, source, ledger, ts)
  VALUES (@hash, @round_id, @kind, @label, @source, @ledger, @ts)
`);

const selectRecent = db.prepare(`
  SELECT round_id, template_id, scenario, options, tags, verdict, confidence,
         resolved_at, state,
         (SELECT COUNT(*) FROM agent_events WHERE agent_events.round_id = rounds.round_id AND kind = 'reveal') AS revealed,
         (SELECT COUNT(*) FROM tx_events WHERE tx_events.round_id = rounds.round_id) AS tx_count
    FROM rounds
   WHERE state IN ('resolved','settled')
   ORDER BY round_id DESC
   LIMIT ?
`);

const selectRoundById = db.prepare(`SELECT * FROM rounds WHERE round_id = ?`);
const selectMessagesByRound = db.prepare(
  `SELECT * FROM persona_messages WHERE round_id = ? ORDER BY seq ASC`,
);
const selectAgentEventsByRound = db.prepare(
  `SELECT * FROM agent_events WHERE round_id = ? ORDER BY kind, ts`,
);
const selectTxsByRound = db.prepare(
  `SELECT * FROM tx_events WHERE round_id = ? ORDER BY ts ASC`,
);

// ---------- Public API ----------

export function recordRoundOpened(q: QuestionScenario, questionHash: string): void {
  insertRound.run({
    round_id: q.roundId,
    template_id: q.templateId,
    scenario: q.scenario,
    options: JSON.stringify(q.options),
    tags: JSON.stringify(q.tags),
    opened_at: q.openedAt,
    closes_at: q.closesAt,
    resolves_at: q.resolvesAt,
    seed_ledger: q.seedLedger,
    question_hash: questionHash,
  });
}

export function recordResolution(r: RoundResolution): void {
  updateResolution.run({
    round_id: r.roundId,
    seed: r.seed,
    verdict: r.verdict,
    confidence: r.distribution[r.verdict],
    distribution: JSON.stringify(r.distribution),
    signature: r.signature,
    oracle_pubkey: r.oraclePubkey,
    resolved_at: r.resolvedAt,
  });
}

export function recordSettled(roundId: number): void {
  markSettled.run(roundId);
}

export function recordAiSummary(roundId: number, summary: string): void {
  updateAiSummary.run(summary, roundId);
}

export function recordPersonaMessage(m: PersonaMessage): void {
  insertMessage.run({
    round_id: m.roundId,
    seq: m.seq,
    tick: m.tick,
    from_id: m.from,
    to_id: m.to,
    content: m.content,
    sentiment: JSON.stringify(m.sentiment),
    emitted_at: m.emittedAt,
  });
}

export function recordAgentCommit(c: AgentSubmission): void {
  insertAgentEvent.run({
    round_id: c.roundId,
    agent: c.agent,
    kind: "commit",
    data: JSON.stringify(c),
    ts: c.submittedAt,
  });
}

export function recordAgentReveal(r: AgentReveal): void {
  insertAgentEvent.run({
    round_id: r.roundId,
    agent: r.agent,
    kind: "reveal",
    data: JSON.stringify(r),
    ts: r.revealedAt,
  });
}

export function recordTx(t: TxEvent, roundId?: number): void {
  insertTx.run({
    hash: t.hash,
    round_id: roundId ?? null,
    kind: t.kind,
    label: t.label ?? null,
    source: t.source,
    ledger: t.ledger ?? null,
    ts: t.ts,
  });
}

interface RecentRow {
  round_id: number;
  template_id: string;
  scenario: string;
  options: string;
  tags: string;
  verdict: string | null;
  confidence: number | null;
  resolved_at: string | null;
  state: string;
  revealed: number;
  tx_count: number;
}

export function recentRoundSummaries(limit = 50): RoundSummary[] {
  const rows = selectRecent.all(limit) as RecentRow[];
  return rows.map((r) => ({
    roundId: r.round_id,
    templateId: r.template_id,
    blurb: r.scenario.length > 110 ? r.scenario.slice(0, 107) + "…" : r.scenario,
    verdict: (r.verdict ?? "A") as "A" | "B" | "C" | "D",
    confidence: r.confidence ?? 0,
    correct: countCorrect(r.round_id, r.verdict),
    revealed: r.revealed,
    txCount: r.tx_count,
    resolvedAt: r.resolved_at ?? "",
  }));
}

function countCorrect(roundId: number, verdict: string | null): number {
  if (!verdict) return 0;
  const reveals = selectAgentEventsByRound.all(roundId) as Array<{ kind: string; data: string }>;
  let n = 0;
  for (const r of reveals) {
    if (r.kind !== "reveal") continue;
    try {
      const parsed = JSON.parse(r.data) as AgentReveal;
      if (parsed.answer === verdict) n++;
    } catch {
      /* ignore */
    }
  }
  return n;
}

interface RoundRow {
  round_id: number;
  template_id: string;
  scenario: string;
  options: string;
  tags: string;
  opened_at: string;
  closes_at: string;
  resolves_at: string;
  seed_ledger: number;
  question_hash: string;
  seed: string | null;
  verdict: string | null;
  confidence: number | null;
  distribution: string | null;
  signature: string | null;
  oracle_pubkey: string | null;
  resolved_at: string | null;
  ai_summary: string | null;
  state: string;
}

interface MessageRow {
  round_id: number;
  seq: number;
  tick: number;
  from_id: string;
  to_id: string;
  content: string;
  sentiment: string;
  emitted_at: string;
}

interface AgentEventRow {
  round_id: number;
  agent: string;
  kind: string;
  data: string;
  ts: string;
}

interface TxRow {
  hash: string;
  round_id: number | null;
  kind: string;
  label: string | null;
  source: string;
  ledger: number | null;
  ts: string;
}

export interface RoundDetail {
  round: {
    roundId: number;
    templateId: string;
    scenario: string;
    options: Record<"A" | "B" | "C" | "D", string>;
    tags: string[];
    openedAt: string;
    closesAt: string;
    resolvesAt: string;
    seedLedger: number;
    questionHash: string;
    seed: string | null;
    verdict: string | null;
    confidence: number | null;
    distribution: Record<"A" | "B" | "C" | "D", number> | null;
    signature: string | null;
    oraclePubkey: string | null;
    resolvedAt: string | null;
    aiSummary: string | null;
    state: string;
  };
  messages: PersonaMessage[];
  commits: AgentSubmission[];
  reveals: AgentReveal[];
  txs: TxEvent[];
}

export function roundDetail(roundId: number): RoundDetail | null {
  const row = selectRoundById.get(roundId) as RoundRow | undefined;
  if (!row) return null;
  const messages = (selectMessagesByRound.all(roundId) as MessageRow[]).map((m) => ({
    roundId: m.round_id,
    seq: m.seq,
    tick: m.tick,
    from: m.from_id,
    to: m.to_id,
    content: m.content,
    sentiment: JSON.parse(m.sentiment) as Record<"A" | "B" | "C" | "D", number>,
    emittedAt: m.emitted_at,
  })) satisfies PersonaMessage[];

  const agentRows = selectAgentEventsByRound.all(roundId) as AgentEventRow[];
  const commits: AgentSubmission[] = [];
  const reveals: AgentReveal[] = [];
  for (const a of agentRows) {
    if (a.kind === "commit") commits.push(JSON.parse(a.data) as AgentSubmission);
    else if (a.kind === "reveal") reveals.push(JSON.parse(a.data) as AgentReveal);
  }

  const txs = (selectTxsByRound.all(roundId) as TxRow[]).map((t) => ({
    hash: t.hash,
    kind: t.kind as TxEvent["kind"],
    source: t.source,
    label: t.label ?? undefined,
    ledger: t.ledger ?? 0,
    ts: t.ts,
  })) satisfies TxEvent[];

  return {
    round: {
      roundId: row.round_id,
      templateId: row.template_id,
      scenario: row.scenario,
      options: JSON.parse(row.options) as Record<"A" | "B" | "C" | "D", string>,
      tags: JSON.parse(row.tags) as string[],
      openedAt: row.opened_at,
      closesAt: row.closes_at,
      resolvesAt: row.resolves_at,
      seedLedger: row.seed_ledger,
      questionHash: row.question_hash,
      seed: row.seed,
      verdict: row.verdict,
      confidence: row.confidence,
      distribution: row.distribution
        ? (JSON.parse(row.distribution) as Record<"A" | "B" | "C" | "D", number>)
        : null,
      signature: row.signature,
      oraclePubkey: row.oracle_pubkey,
      resolvedAt: row.resolved_at,
      aiSummary: row.ai_summary,
      state: row.state,
    },
    messages,
    commits,
    reveals,
    txs,
  };
}

// ---------- World state ----------

interface WorldEvent {
  roundId: number;
  verdict: string;
  scenario: string;
  outcome: string; // text of the winning option
  templateId: string;
  resolvedAt: string;
}

export interface WorldState {
  settledCount: number;
  narrative: string;
  generatedAt: string;
  events: WorldEvent[];
}

const selectWorldEvents = db.prepare(`
  SELECT round_id, template_id, scenario, options, verdict, resolved_at
    FROM rounds
   WHERE state = 'settled' AND verdict IS NOT NULL
   ORDER BY round_id ASC
`);

const selectWorldNarrative = db.prepare(
  `SELECT narrative, generated_at, rounds_at_generation FROM world_state WHERE id = 1`,
);

const updateWorldNarrative = db.prepare(
  `UPDATE world_state SET narrative = ?, generated_at = ?, rounds_at_generation = ? WHERE id = 1`,
);

export function getWorldEvents(limit = 50): WorldEvent[] {
  const rows = selectWorldEvents.all() as Array<{
    round_id: number;
    template_id: string;
    scenario: string;
    options: string;
    verdict: string;
    resolved_at: string;
  }>;
  // Take the most recent `limit` rounds, then return them chronologically.
  const recent = rows.slice(-limit);
  return recent.map((r) => {
    const options = JSON.parse(r.options) as Record<"A" | "B" | "C" | "D", string>;
    return {
      roundId: r.round_id,
      verdict: r.verdict,
      scenario: r.scenario,
      outcome: options[r.verdict as "A" | "B" | "C" | "D"] ?? "",
      templateId: r.template_id,
      resolvedAt: r.resolved_at,
    };
  });
}

export function getWorldState(): WorldState {
  const events = getWorldEvents();
  const row = selectWorldNarrative.get() as
    | { narrative: string; generated_at: string; rounds_at_generation: number }
    | undefined;
  return {
    settledCount: events.length,
    narrative: row?.narrative ?? "",
    generatedAt: row?.generated_at ?? "",
    events,
  };
}

export function recordWorldNarrative(narrative: string, settledCount: number): void {
  updateWorldNarrative.run(narrative, new Date().toISOString(), settledCount);
}

export function getRoundsSinceLastNarrative(): number {
  const row = selectWorldNarrative.get() as { rounds_at_generation: number } | undefined;
  const settled = getWorldEvents().length;
  return settled - (row?.rounds_at_generation ?? 0);
}

interface TxRowOut {
  hash: string;
  round_id: number | null;
  kind: string;
  label: string | null;
  source: string;
  ledger: number | null;
  ts: string;
}

const selectAllTxs = db.prepare(
  `SELECT hash, round_id, kind, label, source, ledger, ts
     FROM tx_events ORDER BY ts DESC LIMIT ?`,
);

export function recentTxs(limit = 500): TxEvent[] {
  const rows = selectAllTxs.all(limit) as TxRowOut[];
  return rows.map((t) => ({
    hash: t.hash,
    kind: t.kind as TxEvent["kind"],
    source: t.source,
    label: t.label ?? undefined,
    ledger: t.ledger ?? 0,
    ts: t.ts,
  }));
}

export function roundListIds(limit = 100): number[] {
  const rows = db
    .prepare("SELECT round_id FROM rounds ORDER BY round_id DESC LIMIT ?")
    .all(limit) as { round_id: number }[];
  return rows.map((r) => r.round_id);
}

export function dbPath(): string {
  return DB_PATH;
}
