import {
  Keypair,
  Networks,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  rpc as SorobanRpc,
  xdr,
  Contract,
} from "@stellar/stellar-sdk";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { config } from "./config.js";
import type { Choice } from "@mirofish/shared";

let _rpc: SorobanRpc.Server | null = null;
function rpc(): SorobanRpc.Server {
  if (!_rpc) _rpc = new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
  return _rpc;
}

/** Create a fresh testnet account funded by friendbot. */
export async function provisionAccount(): Promise<{ secret: string; address: string }> {
  const kp = Keypair.random();
  const url = `${config.friendbotUrl}?addr=${encodeURIComponent(kp.publicKey())}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`friendbot failed: ${res.status}`);
  }
  return { secret: kp.secret(), address: kp.publicKey() };
}

function bytesNScVal(hex: string, n: number): xdr.ScVal {
  const cleaned = hex.replace(/^0x/, "");
  const bytes = hexToBytes(cleaned);
  if (bytes.length !== n) throw new Error(`expected ${n} bytes, got ${bytes.length}`);
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

const CHOICE_INDEX: Record<Choice, number> = { A: 0, B: 1, C: 2, D: 3 };
function choiceScVal(c: Choice) {
  return nativeToScVal(CHOICE_INDEX[c], { type: "u32" });
}

export function commitHash(choice: Choice, nonce: Uint8Array): string {
  const buf = new Uint8Array(1 + nonce.length);
  buf[0] = choice.charCodeAt(0);
  buf.set(nonce, 1);
  return bytesToHex(sha256(buf));
}

export function newNonce(): { hex: string; bytes: Uint8Array } {
  const bytes = randomBytes(32);
  return { hex: bytesToHex(bytes), bytes };
}

async function submit(tx: ReturnType<TransactionBuilder["build"]>, signer: Keypair): Promise<string> {
  const prepared = await rpc().prepareTransaction(tx);
  prepared.sign(signer);
  return await sendAndWait(prepared.toXDR());
}

async function sendAndWait(xdrStr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(xdrStr, config.networkPassphrase || Networks.TESTNET) as Transaction;
  const send = await rpc().sendTransaction(tx);
  if (send.status === "ERROR") {
    throw new Error(`tx error ${JSON.stringify(send.errorResult)}`);
  }
  let result = await rpc().getTransaction(send.hash);
  let attempts = 0;
  while (result.status === "NOT_FOUND" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await rpc().getTransaction(send.hash);
    attempts++;
  }
  if (result.status !== "SUCCESS") {
    // Surface as much detail as the RPC gives us: the result code (txBAD_SEQ,
    // txFAILED, txINSUFFICIENT_FEE, etc.) and any contract-error event we can
    // pry out of the result metadata.
    const status = result.status;
    let detail = "";
    try {
      // `resultXdr` and `resultMetaXdr` are available on FAILED results.
      const anyResult = result as unknown as {
        resultXdr?: { toXDR?: (encoding: string) => string } | string;
        envelopeXdr?: { toXDR?: (encoding: string) => string } | string;
      };
      const rx = anyResult.resultXdr;
      detail = typeof rx === "string"
        ? rx.slice(0, 60)
        : rx && typeof rx.toXDR === "function"
          ? rx.toXDR("base64").slice(0, 60)
          : "";
    } catch {
      /* best effort */
    }
    throw new Error(`tx ${status} hash=${send.hash}${detail ? ` resultXdr=${detail}…` : ""}`);
  }
  return send.hash;
}

/** Register a delegate against an operator. If `operatorSecret` is provided
 *  (custodial path where the runner controls both keys), the tx is signed
 *  server-side. Otherwise builds an unsigned, prepared XDR for the user's
 *  browser wallet to sign. */
export async function registerAgentTx(opts: {
  operator: string;
  delegate: string;
  operatorSecret?: string;
}): Promise<{ xdr: string; signedHash?: string }> {
  if (!config.contractId) throw new Error("LIVE_ROUND_CONTRACT_ID not set");
  const { operator, delegate, operatorSecret } = opts;
  const sourceAccount = await rpc().getAccount(operator);
  const contract = new Contract(config.contractId);
  const op = contract.call(
    "register_agent",
    new Address(operator).toScVal(),
    new Address(delegate).toScVal(),
  );
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase || Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(15 * 60)
    .build();
  const prepared = await rpc().prepareTransaction(tx);
  if (operatorSecret) {
    const kp = Keypair.fromSecret(operatorSecret);
    prepared.sign(kp);
    // The delegate is the *same* key as operator in the custodial path, so
    // the single signature satisfies both the tx envelope and any Soroban
    // auth entries the contract requires.
    const hash = await sendAndWait(prepared.toXDR());
    return { xdr: prepared.toXDR(), signedHash: hash };
  }
  return { xdr: prepared.toXDR() };
}

/** Submit a wallet-signed XDR (returned to the browser, signed there, then
 *  posted back) and wait for finalization. */
export async function submitSignedXdr(xdrStr: string): Promise<string> {
  return await sendAndWait(xdrStr);
}

/**
 * Read-only call: return an operator's current soulbound reputation balance
 * from the contract. Uses simulate-only (no submit, no fee). Returns 0n on
 * any error.
 */
export async function getReputation(operator: string): Promise<number> {
  if (!config.contractId) return 0;
  try {
    const account = await rpc().getAccount(operator);
    const contract = new Contract(config.contractId);
    const op = contract.call("reputation_of", new Address(operator).toScVal());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase || Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const sim = await rpc().simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
      const native = scValToNative(sim.result.retval);
      // Contract returns i128; scValToNative gives a bigint or number depending
      // on the magnitude. Normalize to number — rep balances are small.
      return typeof native === "bigint" ? Number(native) : Number(native ?? 0);
    }
  } catch {
    /* read-only, ignore */
  }
  return 0;
}

export async function submitCommit(secret: string, roundId: number, commitHashHex: string): Promise<string> {
  if (!config.contractId) throw new Error("LIVE_ROUND_CONTRACT_ID not set");
  const kp = Keypair.fromSecret(secret);
  const account = await rpc().getAccount(kp.publicKey());
  const contract = new Contract(config.contractId);
  const op = contract.call(
    "commit",
    nativeToScVal(roundId, { type: "u32" }),
    new Address(kp.publicKey()).toScVal(),
    bytesNScVal(commitHashHex, 32),
  );
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase || Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
  return submit(tx, kp);
}

export async function submitReveal(
  secret: string,
  roundId: number,
  choice: Choice,
  nonceHex: string,
): Promise<string> {
  if (!config.contractId) throw new Error("LIVE_ROUND_CONTRACT_ID not set");
  const kp = Keypair.fromSecret(secret);
  const account = await rpc().getAccount(kp.publicKey());
  const contract = new Contract(config.contractId);
  const op = contract.call(
    "reveal",
    nativeToScVal(roundId, { type: "u32" }),
    new Address(kp.publicKey()).toScVal(),
    choiceScVal(choice),
    bytesNScVal(nonceHex, 32),
  );
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase || Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
  return submit(tx, kp);
}
