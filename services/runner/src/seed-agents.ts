import { listAgents, addAgent } from "./store.js";
import { provisionAccount, registerAgentTx } from "./stellar.js";
import { config } from "./config.js";
import type { HostedAgent } from "@mirofish/shared";

interface SeedSpec {
  displayName: string;
  systemPrompt: string;
  model: HostedAgent["model"];
}

const SEED: SeedSpec[] = [
  {
    displayName: "Plain-Reader",
    systemPrompt:
      "Pick the most literal interpretation of the scenario. Do not reach for clever second-order effects unless the text states them.",
    model: "gemini-2.5-flash-lite",
  },
  {
    displayName: "Cynic",
    systemPrompt:
      "Assume the worst plausible motive of every actor. Power, money, and self-preservation are always the operating logic.",
    model: "gemini-2.5-flash-lite",
  },
  {
    displayName: "Game-Theorist",
    systemPrompt:
      "Identify the Nash-style equilibrium each option implies. Pick the option that's most stable under repeated play.",
    model: "nvidia/nemotron-3-super-120b-a12b:free",
  },
  {
    displayName: "Historian",
    systemPrompt:
      "Look for parallels with real-world historical episodes. Pick the option that matches the most precedented pattern.",
    model: "nvidia/nemotron-3-super-120b-a12b:free",
  },
  {
    displayName: "Contrarian",
    systemPrompt:
      "Whatever a naive reader would expect, take the opposite view. Bet against the obvious answer.",
    model: "gemini-2.5-flash-lite",
  },
];

export async function seedReferenceAgents(): Promise<void> {
  const existing = await listAgents();
  const have = new Set(existing.map((a) => a.displayName));
  const todo = SEED.filter((s) => !have.has(s.displayName));
  if (todo.length === 0) return;
  await Promise.all(todo.map(seedOne));
}

async function seedOne(s: SeedSpec): Promise<void> {
  try {
    const { secret, address } = await provisionAccount();
    if (config.contractId) {
      await registerAgentTx({ operator: address, delegate: address, operatorSecret: secret });
    }
    const id = `ref-${s.displayName.toLowerCase()}`;
    const record: HostedAgent & { stellarSecret: string } = {
      id,
      operator: address,
      delegateAddress: address,
      stellarAddress: address,
      walletConnected: false,
      stellarSecret: secret,
      displayName: s.displayName,
      systemPrompt: s.systemPrompt,
      model: s.model,
      createdAt: new Date().toISOString(),
      reputation: 0,
      stats: { played: 0, top3: 0, firsts: 0 },
    };
    await addAgent(record);
    console.log(`[runner] seeded reference agent ${s.displayName} (${address}) registered on-chain`);
  } catch (err) {
    console.warn(`seed agent ${s.displayName} failed`, (err as Error).message);
  }
}
