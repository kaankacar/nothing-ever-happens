import { promises as fs } from "node:fs";
import path from "node:path";
import type { HostedAgent } from "@mirofish/shared";
import { config } from "./config.js";

interface StoredAgent extends HostedAgent {
  /** Delegate's secret — kept server-side so the runner can sign commits. */
  stellarSecret: string;
}

interface PendingRegistrationInternal {
  id: string;
  operator: string;
  delegateAddress: string;
  delegateSecret: string;
  displayName: string;
  systemPrompt: string;
  model: HostedAgent["model"];
  xdr: string;
  createdAt: number;
}

interface RunnerDB {
  agents: StoredAgent[];
}

const db: RunnerDB = { agents: [] };
const pending = new Map<string, PendingRegistrationInternal>();
let loaded = false;

export async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await fs.readFile(config.dbPath, "utf8");
    const parsed = JSON.parse(raw) as RunnerDB;
    db.agents = parsed.agents ?? [];
    // Backfill new fields on older records.
    for (const a of db.agents) {
      if (!a.operator) a.operator = a.delegateAddress ?? a.stellarAddress;
      if (!a.delegateAddress) a.delegateAddress = a.stellarAddress;
      if (typeof a.walletConnected !== "boolean") a.walletConnected = false;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("runner db load error", err);
    }
  }
  loaded = true;
}

async function persist(): Promise<void> {
  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
  await fs.writeFile(config.dbPath, JSON.stringify(db, null, 2));
}

export async function addAgent(a: StoredAgent): Promise<void> {
  db.agents.push(a);
  await persist();
}

export async function listAgents(): Promise<HostedAgent[]> {
  return db.agents.map(({ stellarSecret: _s, ...rest }) => rest);
}

export async function listAgentsWithSecrets(): Promise<StoredAgent[]> {
  return [...db.agents];
}

export async function updateAgentStats(
  id: string,
  fn: (a: HostedAgent) => Partial<HostedAgent>,
): Promise<void> {
  const idx = db.agents.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const a = db.agents[idx]!;
  const patch = fn(a);
  db.agents[idx] = { ...a, ...patch } as StoredAgent;
  await persist();
}

const PENDING_TTL_MS = 15 * 60 * 1000;

export function putPending(p: PendingRegistrationInternal): void {
  pending.set(p.id, p);
  // Lazy GC.
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.createdAt > PENDING_TTL_MS) pending.delete(k);
  }
}

export function takePending(id: string): PendingRegistrationInternal | undefined {
  const p = pending.get(id);
  if (!p) return undefined;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(id);
    return undefined;
  }
  return p;
}

export function dropPending(id: string): void {
  pending.delete(id);
}
