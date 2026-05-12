import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { AgentReveal, AgentSubmission, ArenaEvent } from "@mirofish/shared";
import { config } from "./config.js";
import { bus } from "./events.js";
import { getCurrent, oracleInfo, startScheduler } from "./scheduler.js";
import { recentRounds } from "./history.js";
import {
  recentRoundSummaries,
  roundDetail,
  roundListIds,
  recordAgentCommit,
  recordAgentReveal,
  recordTx,
  dbPath,
  getWorldState,
  recentTxs,
} from "./db.js";

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) =>
  c.json({ ok: true, time: new Date().toISOString(), oracle: oracleInfo() }),
);

app.get("/round/current", (c) => {
  const cur = getCurrent();
  if (!cur) return c.json({ phase: "idle" });
  return c.json(cur);
});

app.get("/rounds/recent", (c) => {
  // Prefer SQLite-backed history (survives restarts); fall back to in-memory
  // ring buffer only if the DB is empty (e.g. very first round of the session).
  const summaries = recentRoundSummaries(20);
  if (summaries.length > 0) return c.json({ rounds: summaries });
  return c.json({ rounds: recentRounds() });
});

app.get("/rounds/all", (c) => {
  const limitParam = Number(c.req.query("limit") ?? "100");
  return c.json({ ids: roundListIds(Math.min(limitParam, 500)) });
});

app.get("/rounds/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  const detail = roundDetail(id);
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});

app.get("/db/info", (c) => c.json({ path: dbPath() }));

app.get("/world", (c) => c.json(getWorldState()));

app.get("/txs/recent", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "500"), 2000);
  return c.json({ txs: recentTxs(limit) });
});

// Internal endpoint: the runner pushes agent commit/reveal events so they
// stream through SSE alongside simulator events. We also re-emit each as a
// `tx` event so the frontend's per-round tx counter and tx ticker include
// agent commits and reveals (those are real Stellar txs from the agent keys).
app.post("/internal/agent-event", async (c) => {
  const body = (await c.req.json()) as
    | { type: "agent.commit"; data: AgentSubmission }
    | { type: "agent.reveal"; data: AgentReveal };
  if (body.type === "agent.commit") {
    bus.publish(body as ArenaEvent);
    try { recordAgentCommit(body.data); } catch { /* best-effort */ }
    if (body.data.commitTx) {
      bus.publish({
        type: "tx",
        data: {
          hash: body.data.commitTx,
          kind: "agent_commit",
          source: body.data.agent,
          ledger: 0,
          ts: body.data.submittedAt,
          label: `commit ${body.data.agent.slice(0, 6)}…`,
        },
      });
    }
    return c.json({ ok: true });
  }
  if (body.type === "agent.reveal") {
    bus.publish(body as ArenaEvent);
    try { recordAgentReveal(body.data); } catch { /* best-effort */ }
    if (body.data.revealTx) {
      bus.publish({
        type: "tx",
        data: {
          hash: body.data.revealTx,
          kind: "agent_reveal",
          source: body.data.agent,
          ledger: 0,
          ts: body.data.revealedAt,
          label: `reveal ${body.data.agent.slice(0, 6)}… → ${body.data.answer}`,
        },
      });
    }
    return c.json({ ok: true });
  }
  return c.json({ error: "unknown type" }, 400);
});

// Bus subscription: persist every tx event with the current round_id so the
// per-round detail view can list them later. Runs for the lifetime of the
// process; no need to unsubscribe.
bus.subscribe((ev) => {
  if (ev.type === "tx") {
    const current = getCurrent();
    try {
      recordTx(ev.data, current?.question.roundId);
    } catch {
      /* best-effort */
    }
  }
});

app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    // Replay the recent buffer so newcomers see context.
    for (const e of bus.snapshot()) {
      if (closed) return;
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type });
    }

    const unsub = bus.subscribe(async (e: ArenaEvent) => {
      if (closed) return;
      try {
        await stream.writeSSE({ data: JSON.stringify(e), event: e.type });
      } catch {
        /* writer closed */
      }
    });

    // Keep the connection open until the client disconnects.
    while (!closed) {
      await new Promise((r) => setTimeout(r, 15_000));
      if (!closed) {
        try {
          await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
        } catch {
          break;
        }
      }
    }
    unsub();
  }),
);

const port = config.port;
serve({ fetch: app.fetch, port });
console.log(`[oracle] http://localhost:${port}`);
console.log(`[oracle] starting scheduler …`);
startScheduler().catch((e) => {
  console.error("scheduler crashed", e);
  process.exit(1);
});
