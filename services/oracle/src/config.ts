import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  network: opt("STELLAR_NETWORK", "testnet"),
  rpcUrl: opt("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org"),
  horizonUrl: opt("STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org"),
  networkPassphrase: opt(
    "STELLAR_NETWORK_PASSPHRASE",
    "Test SDF Network ; September 2015",
  ),
  contractId: process.env.LIVE_ROUND_CONTRACT_ID ?? "",
  oracleStellarSecret: process.env.ORACLE_STELLAR_SECRET ?? "",
  oracleSigningSecret: process.env.ORACLE_SIGNING_SECRET ?? "",
  port: Number(opt("ORACLE_PORT", "4000")),

  mirofish: {
    model: opt("MIROFISH_MODEL", "gemini-2.5-flash-lite"),
    personas: Number(opt("MIROFISH_PERSONA_COUNT", "30")),
    ticks: Number(opt("MIROFISH_TICKS", "2")),
    /** Cap on real LLM exchanges per round. Once exceeded, remaining
     *  exchanges fall back to templated dialogue so we don't blow the
     *  Gemini free-tier daily cap. */
    maxLlmPerRound: Number(opt("MIROFISH_MAX_LLM_PER_ROUND", "12")),
  },

  /** Runner URL used to look up how many agents are registered so we can
   *  short-circuit the commit window once all of them have committed. */
  runnerUrl: opt("RUNNER_URL", "http://localhost:4001"),

  llm: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    openai: process.env.OPENAI_API_KEY ?? "",
    openrouter: process.env.OPENROUTER_API_KEY ?? "",
    gemini: process.env.GEMINI_API_KEY ?? "",
    groq: process.env.GROQ_API_KEY ?? "",
  },

  /** When DEV_MODE=1, rounds run on a 3-minute cycle for local iteration. */
  devMode: process.env.DEV_MODE === "1",

  /** Round cadence in seconds (overridden by devMode). Reveal window is wide
   *  enough to accommodate the LLM-paced simulator (which runs during it). */
  roundSeconds: process.env.DEV_MODE === "1" ? 180 : 300,
  commitWindowSeconds: process.env.DEV_MODE === "1" ? 60 : 180,
  revealWindowSeconds: process.env.DEV_MODE === "1" ? 120 : 120,

  /** How many ledgers ahead the seed ledger should be (~5s per ledger). */
  seedLedgerOffset: process.env.DEV_MODE === "1" ? 12 : 60,
};

export type AppConfig = typeof config;
