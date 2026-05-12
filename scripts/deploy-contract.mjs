#!/usr/bin/env node
// Deploy LiveRound to Stellar testnet and run init().
// Requires: stellar CLI on PATH, a funded admin keypair available as
// `stellar keys` identity named "arena-admin" (or override via --identity).
//
// Usage:
//   node scripts/deploy-contract.mjs --oracle-pubkey <hex32> [--identity arena-admin]
//
// Outputs the deployed contract id and patches .env.example for convenience.

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const identity = arg("identity", "arena-admin");
const oraclePubkey = arg("oracle-pubkey");
const repPool = arg("rep-pool", "100");
const topN = arg("top-n", "3");

if (!oraclePubkey || !/^[0-9a-fA-F]{64}$/.test(oraclePubkey)) {
  console.error("Missing or invalid --oracle-pubkey (expected 32-byte hex)");
  process.exit(1);
}

function sh(cmd) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: ["inherit", "pipe", "inherit"], cwd: ROOT }).toString().trim();
}

console.log("Building contract …");
sh(`stellar contract build --package live-round --manifest-path contracts/Cargo.toml`);

const wasm = resolve(
  ROOT,
  "contracts/target/wasm32v1-none/release/live_round.wasm",
);
if (!existsSync(wasm)) {
  console.error(`wasm not found at ${wasm}`);
  process.exit(1);
}

console.log("Uploading wasm …");
const wasmHash = sh(
  `stellar contract upload --wasm ${wasm} --source ${identity} --network testnet`,
).trim();
console.log("wasm hash:", wasmHash);

console.log("Deploying …");
const contractId = sh(
  `stellar contract deploy --wasm-hash ${wasmHash} --source ${identity} --network testnet`,
).trim();
console.log("contract id:", contractId);

const adminAddr = sh(`stellar keys address ${identity}`).trim();
console.log("admin address:", adminAddr);

console.log("Initializing …");
sh(
  `stellar contract invoke --id ${contractId} --source ${identity} --network testnet -- init --admin ${adminAddr} --oracle_pk ${oraclePubkey} --rep_pool ${repPool} --top_n ${topN}`,
);

console.log("\n✅ Deployment complete.");
console.log("\nAdd to your .env:");
console.log(`LIVE_ROUND_CONTRACT_ID=${contractId}`);

// Patch .env if present, else write a new line into .env.local.
const envPath = resolve(ROOT, ".env");
const envLocal = resolve(ROOT, ".env.local");
const target = existsSync(envPath) ? envPath : envLocal;
let body = existsSync(target) ? readFileSync(target, "utf8") : "";
if (body.includes("LIVE_ROUND_CONTRACT_ID=")) {
  body = body.replace(/LIVE_ROUND_CONTRACT_ID=.*/g, `LIVE_ROUND_CONTRACT_ID=${contractId}`);
} else {
  body += (body.endsWith("\n") || body.length === 0 ? "" : "\n") + `LIVE_ROUND_CONTRACT_ID=${contractId}\n`;
}
writeFileSync(target, body);
console.log(`\nWrote ${target}`);
