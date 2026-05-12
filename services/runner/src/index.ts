import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomBytes, bytesToHex } from "@noble/hashes/utils";
import type { HostedAgent } from "@mirofish/shared";
import { config } from "./config.js";
import {
  addAgent,
  dropPending,
  ensureLoaded,
  listAgents,
  putPending,
  takePending,
} from "./store.js";
import {
  provisionAccount,
  registerAgentTx,
  submitSignedXdr,
} from "./stellar.js";
import { startAgentLoop } from "./agent-loop.js";
import { seedReferenceAgents } from "./seed-agents.js";

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.get("/agents", async (c) => {
  await ensureLoaded();
  const agents = await listAgents();
  return c.json({ agents });
});

/**
 * Custodial registration (Tier 1). The runner generates a delegate keypair
 * and uses it as both operator and delegate — single key, single signature.
 * Useful for spectators who don't have a wallet handy.
 */
app.post("/agents", async (c) => {
  await ensureLoaded();
  const body = (await c.req.json()) as {
    displayName?: string;
    systemPrompt?: string;
    model?: HostedAgent["model"];
  };
  if (!body.displayName || !body.systemPrompt || !body.model) {
    return c.json({ error: "displayName, systemPrompt, model required" }, 400);
  }
  if (body.systemPrompt.length > 2000) {
    return c.json({ error: "systemPrompt too long (max 2000)" }, 400);
  }
  const { secret, address } = await provisionAccount();
  // In the custodial path, the runner signs both as operator and as delegate.
  // Best-effort: skip on-chain registration if the contract isn't deployed.
  if (config.contractId) {
    try {
      await registerAgentTx({ operator: address, delegate: address, operatorSecret: secret });
    } catch (err) {
      console.warn("custodial register_agent failed", (err as Error).message);
    }
  }
  const id = `agent-${Date.now().toString(36)}`;
  const record = {
    id,
    operator: address,
    delegateAddress: address,
    stellarAddress: address,
    walletConnected: false,
    displayName: body.displayName,
    systemPrompt: body.systemPrompt,
    model: body.model,
    createdAt: new Date().toISOString(),
    reputation: 0,
    stats: { played: 0, top3: 0, firsts: 0 },
    stellarSecret: secret,
  };
  await addAgent(record);
  const { stellarSecret: _s, ...safe } = record;
  return c.json(safe);
});

/**
 * Connected-wallet registration step 1 (Tier 2). The runner provisions a
 * fresh delegate, builds a `register_agent(operator, delegate)` tx with the
 * operator as source, and returns the prepared XDR for the browser wallet
 * to sign. The pending record is held in memory until `/confirm`.
 */
app.post("/agents/connected/prepare", async (c) => {
  await ensureLoaded();
  const body = (await c.req.json()) as {
    operator?: string;
    displayName?: string;
    systemPrompt?: string;
    model?: HostedAgent["model"];
  };
  if (!body.operator || !body.displayName || !body.systemPrompt || !body.model) {
    return c.json({ error: "operator, displayName, systemPrompt, model required" }, 400);
  }
  if (!config.contractId) {
    return c.json({ error: "contract not deployed" }, 500);
  }
  const { secret, address } = await provisionAccount();
  try {
    const { xdr } = await registerAgentTx({ operator: body.operator, delegate: address });
    const id = `pending-${bytesToHex(randomBytes(8))}`;
    putPending({
      id,
      operator: body.operator,
      delegateAddress: address,
      delegateSecret: secret,
      displayName: body.displayName,
      systemPrompt: body.systemPrompt,
      model: body.model,
      xdr,
      createdAt: Date.now(),
    });
    return c.json({
      pendingId: id,
      delegate: address,
      xdr,
      networkPassphrase: config.networkPassphrase,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

/**
 * Step 2: receive the wallet-signed XDR, submit it, and (if it lands)
 * promote the pending record into a live hosted agent.
 */
app.post("/agents/connected/confirm", async (c) => {
  await ensureLoaded();
  const body = (await c.req.json()) as { pendingId?: string; signedXdr?: string };
  if (!body.pendingId || !body.signedXdr) {
    return c.json({ error: "pendingId and signedXdr required" }, 400);
  }
  const p = takePending(body.pendingId);
  if (!p) {
    return c.json({ error: "pending registration not found or expired" }, 404);
  }
  try {
    const hash = await submitSignedXdr(body.signedXdr);
    const record = {
      id: `agent-${Date.now().toString(36)}`,
      operator: p.operator,
      delegateAddress: p.delegateAddress,
      stellarAddress: p.delegateAddress,
      walletConnected: true,
      displayName: p.displayName,
      systemPrompt: p.systemPrompt,
      model: p.model,
      createdAt: new Date().toISOString(),
      reputation: 0,
      stats: { played: 0, top3: 0, firsts: 0 },
      stellarSecret: p.delegateSecret,
    };
    await addAgent(record);
    const { stellarSecret: _s, ...safe } = record;
    return c.json({ agent: safe, registerTx: hash });
  } catch (err) {
    dropPending(body.pendingId);
    return c.json({ error: (err as Error).message }, 500);
  }
});

const port = config.port;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`[runner] http://localhost:${port}`);

// Crash-loudly so the next failure leaves a stack instead of silent exit.
process.on("unhandledRejection", (err) => {
  console.error("[runner] unhandledRejection", err);
});
process.on("uncaughtException", (err) => {
  console.error("[runner] uncaughtException", err);
});

ensureLoaded()
  .then(() => seedReferenceAgents())
  .then(() => startAgentLoop())
  .catch((err) => {
    console.error("runner boot failed", err);
    process.exit(1);
  });
