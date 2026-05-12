import "dotenv/config";

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(opt("RUNNER_PORT", "4001")),
  oracleUrl: opt("ORACLE_URL", "http://localhost:4000"),
  dbPath: opt("RUNNER_DB_PATH", "./data/runner.json"),
  network: opt("STELLAR_NETWORK", "testnet"),
  rpcUrl: opt("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org"),
  horizonUrl: opt("STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org"),
  networkPassphrase: opt(
    "STELLAR_NETWORK_PASSPHRASE",
    "Test SDF Network ; September 2015",
  ),
  contractId: process.env.LIVE_ROUND_CONTRACT_ID ?? "",
  friendbotUrl: opt("FRIENDBOT_URL", "https://friendbot.stellar.org"),
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  groqKey: process.env.GROQ_API_KEY ?? "",
  /** When 1, the runner skips LLM calls for agent reasoning and uses a fast
   *  deterministic fallback so commits always land inside the contract window.
   *  Keep AI off for the agents and ON for the oracle's simulator — the AI
   *  reasoning the operator cares about is the verdict, not the per-agent
   *  guess. */
  skipAgentLlm: process.env.SKIP_AGENT_LLM === "1" || process.env.SKIP_AGENT_LLM === "true",
};
