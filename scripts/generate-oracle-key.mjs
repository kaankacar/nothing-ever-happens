#!/usr/bin/env node
// Generate a fresh Ed25519 keypair for the oracle service.
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";

const sk = randomBytes(32);
const pk = ed25519.getPublicKey(sk);
console.log("ORACLE_SIGNING_SECRET=" + bytesToHex(sk));
console.log("ORACLE_PUBKEY=" + bytesToHex(pk));
