import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import type { Choice } from "@mirofish/shared";

/** Choice → single ASCII byte, matching the contract. */
export function choiceByte(c: Choice): number {
  return c.charCodeAt(0);
}

/** Canonical payload the contract verifies: rid_le || question_hash || seed || verdict_byte. */
export function settlePayload(
  roundId: number,
  questionHashHex: string,
  seedHex: string,
  verdict: Choice,
): Uint8Array {
  const rid = new Uint8Array(4);
  new DataView(rid.buffer).setUint32(0, roundId, true);
  const q = hexToBytes(questionHashHex);
  const s = hexToBytes(seedHex);
  const out = new Uint8Array(rid.length + q.length + s.length + 1);
  out.set(rid, 0);
  out.set(q, rid.length);
  out.set(s, rid.length + q.length);
  out[rid.length + q.length + s.length] = choiceByte(verdict);
  return out;
}

export interface OracleKey {
  /** 32-byte hex */
  pubkey: string;
  /** Raw private key in hex (32 bytes). */
  privkey: string;
}

export function deriveKey(secretHex: string): OracleKey {
  const sk = hexToBytes(secretHex);
  if (sk.length !== 32) throw new Error("ORACLE_SIGNING_SECRET must be 32 bytes hex");
  const pk = ed25519.getPublicKey(sk);
  return { pubkey: bytesToHex(pk), privkey: bytesToHex(sk) };
}

export function sign(payload: Uint8Array, key: OracleKey): string {
  const sig = ed25519.sign(payload, hexToBytes(key.privkey));
  return bytesToHex(sig);
}

export function sha256Hex(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256(bytes));
}

/** Canonical JSON: stable key ordering, no whitespace. Mirrors what we hash on-chain. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}
