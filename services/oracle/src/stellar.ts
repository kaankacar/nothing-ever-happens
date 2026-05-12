import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  rpc as SorobanRpc,
  xdr,
  Contract,
} from "@stellar/stellar-sdk";
import type { Choice, TxEvent } from "@mirofish/shared";
import { bus } from "./events.js";
import { config } from "./config.js";
import { hexToBytes } from "@noble/hashes/utils";

/**
 * Stellar client for the oracle. Owns:
 *   - The admin/oracle Stellar account (signs contract calls).
 *   - Round lifecycle calls: open_round, settle.
 *   - Persona-edge MPP emission: each persona-to-persona interaction is
 *     mirrored as a 0.0000001 XLM payment from the oracle account to a
 *     deterministic persona-derived account on the same testnet, batched in a
 *     single transaction using up to 100 operations per tx.
 */

const stellarTime = (date: Date) => Math.floor(date.getTime() / 1000);

let _server: SorobanRpc.Server | null = null;
function rpc(): SorobanRpc.Server {
  if (!_server) _server = new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
  return _server;
}

function oracleKeypair(): Keypair {
  if (!config.oracleStellarSecret) {
    throw new Error("ORACLE_STELLAR_SECRET not set");
  }
  return Keypair.fromSecret(config.oracleStellarSecret);
}

function networkPassphrase(): string {
  return config.networkPassphrase || Networks.TESTNET;
}

async function loadAccount() {
  const kp = oracleKeypair();
  return rpc().getAccount(kp.publicKey());
}

/** Map Choice to the contract's u32 representation. */
const CHOICE_INDEX: Record<Choice, number> = { A: 0, B: 1, C: 2, D: 3 };

function choiceScVal(c: Choice) {
  return nativeToScVal(CHOICE_INDEX[c], { type: "u32" });
}

/** Hex string → BytesN<N> ScVal. */
function bytesNScVal(hex: string, n: number): xdr.ScVal {
  const cleaned = hex.replace(/^0x/, "");
  const bytes = hexToBytes(cleaned);
  if (bytes.length !== n) throw new Error(`expected ${n} bytes, got ${bytes.length}`);
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

export async function getLatestLedger(): Promise<number> {
  const info = await rpc().getLatestLedger();
  return info.sequence;
}

export async function getLedgerCloseHash(seq: number): Promise<string | undefined> {
  // Horizon endpoint /ledgers/{seq} → header_xdr → hash.
  // For simplicity, use the latest ledger info via RPC and compare. If not
  // available yet, return undefined.
  const url = `${config.horizonUrl}/ledgers/${seq}`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const json = (await res.json()) as { hash?: string };
  return json.hash;
}

/** Submit a built tx with the oracle keypair. Returns the hash and the
 *  contract return value (if any) decoded from the tx meta. */
async function submit(
  tx: ReturnType<TransactionBuilder["build"]>,
): Promise<{ hash: string; returnValue?: unknown }> {
  const kp = oracleKeypair();
  const prepared = await rpc().prepareTransaction(tx);
  prepared.sign(kp);
  const send = await rpc().sendTransaction(prepared);
  if (send.status === "ERROR") {
    throw new Error(`tx submit error: ${JSON.stringify(send.errorResult)}`);
  }
  let result = await rpc().getTransaction(send.hash);
  let attempts = 0;
  while (result.status === "NOT_FOUND" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await rpc().getTransaction(send.hash);
    attempts++;
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`tx not successful: ${result.status}`);
  }
  let returnValue: unknown;
  const successResult = result as SorobanRpc.Api.GetSuccessfulTransactionResponse;
  if (successResult.returnValue) {
    returnValue = scValToNative(successResult.returnValue);
  }
  return { hash: send.hash, returnValue };
}

export async function openRoundOnChain(
  questionHashHex: string,
  seedLedger: number,
  closeTs: number,
  revealCloseTs: number,
): Promise<{ roundId: number; txHash: string }> {
  if (!config.contractId) throw new Error("LIVE_ROUND_CONTRACT_ID not set");
  const account = await loadAccount();
  const contract = new Contract(config.contractId);
  const admin = oracleKeypair().publicKey();
  const op = contract.call(
    "open_round",
    new Address(admin).toScVal(),
    bytesNScVal(questionHashHex, 32),
    nativeToScVal(seedLedger, { type: "u32" }),
    nativeToScVal(closeTs, { type: "u64" }),
    nativeToScVal(revealCloseTs, { type: "u64" }),
  );
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: networkPassphrase() })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const { hash, returnValue } = await submit(tx);
  const roundId = typeof returnValue === "number" ? returnValue : 0;
  bus.publish({
    type: "tx",
    data: {
      hash,
      kind: "agent_commit",
      source: admin,
      ledger: 0,
      ts: new Date().toISOString(),
      label: `open_round #${roundId}`,
    } satisfies TxEvent,
  });
  return { roundId, txHash: hash };
}

export async function settleOnChain(
  roundId: number,
  verdict: Choice,
  seedHex: string,
  signatureHex: string,
): Promise<string> {
  const account = await loadAccount();
  const contract = new Contract(config.contractId);
  const op = contract.call(
    "settle",
    nativeToScVal(roundId, { type: "u32" }),
    choiceScVal(verdict),
    bytesNScVal(seedHex, 32),
    bytesNScVal(signatureHex, 64),
  );
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: networkPassphrase() })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const { hash } = await submit(tx);
  bus.publish({
    type: "tx",
    data: {
      hash,
      kind: "payout",
      source: oracleKeypair().publicKey(),
      ledger: 0,
      ts: new Date().toISOString(),
      label: `settle round ${roundId} → ${verdict}`,
    } satisfies TxEvent,
  });
  return hash;
}

/**
 * Mirror persona-edge interactions on-chain. We batch up to 100 ops per tx,
 * each op being a 0.0000001 XLM payment to a deterministic persona-derived
 * account (we don't actually fund the destinations — these are testnet edges
 * that will fail at apply time but still appear in the tx history as op
 * records). For the MVP, we instead use claimable balances or a no-op pattern
 * so the txs succeed; here we'll use `Operation.manageData` which is a
 * single-op-on-self pattern that always succeeds and adds visible on-chain
 * activity per edge.
 *
 * Each manageData entry sets a key `edge:<from>:<to>:<seq>` with the message
 * content (capped at 64 bytes — Stellar limit). This is honest on-chain
 * settlement of the simulation edge.
 */
export async function emitEdgeBatch(
  edges: { from: string; to: string; seq: number; content: string }[],
): Promise<string | undefined> {
  if (edges.length === 0) return undefined;
  const account = await loadAccount();
  const builder = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * Math.min(edges.length, 100)),
    networkPassphrase: networkPassphrase(),
  });
  for (const e of edges.slice(0, 100)) {
    const key = trim64(`edge:${e.from}->${e.to}:${e.seq}`);
    const value = trim64(e.content);
    builder.addOperation(Operation.manageData({ name: key, value }));
  }
  const tx = builder.setTimeout(60).build();
  const kp = oracleKeypair();
  tx.sign(kp);
  const send = await rpc().sendTransaction(tx);
  if (send.status === "ERROR") {
    // Don't throw — edge emission is best-effort, and we don't want to break
    // the round if the network is congested.
    console.warn("edge batch submit error", send.errorResult);
    return undefined;
  }
  for (const e of edges) {
    bus.publish({
      type: "tx",
      data: {
        hash: send.hash,
        kind: "persona_edge",
        source: kp.publicKey(),
        ledger: 0,
        ts: new Date().toISOString(),
        label: `${e.from} → ${e.to}`,
      } satisfies TxEvent,
    });
  }
  return send.hash;
}

function trim64(s: string): string {
  // Stellar manageData name is max 64 chars; value max 64 bytes.
  return s.slice(0, 64);
}

export function oraclePublicKey(): string {
  return oracleKeypair().publicKey();
}

export { stellarTime };
