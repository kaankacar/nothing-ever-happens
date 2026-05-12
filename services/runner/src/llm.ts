import type { HostedAgent, QuestionScenario } from "@mirofish/shared";
import { config } from "./config.js";

/**
 * Two-provider LLM client for the agent runner. The provider is selected
 * per-agent via `HostedAgent.model`:
 *   - `gemini-2.5-flash-lite` → Google AI Studio (30 RPM / 1,500 RPD free)
 *   - `nvidia/nemotron-3-super-120b-a12b:free` → OpenRouter (20 RPM / 50-1000 RPD)
 *
 * The two paths share the same throttle queue so the combined load stays
 * inside both providers' caps.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const NEMOTRON_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const GROQ_MODEL = "llama-3.1-8b-instant";

export interface LlmAnswer {
  choice: "A" | "B" | "C" | "D";
  reasoning: string;
}

const SYS = `You are an analytical agent in a simulated-reality reasoning competition.
You will be given a short fictional scenario and four possible outcomes (A/B/C/D).
A multi-agent social simulator will independently produce its own verdict; your goal
is to predict which of the four options that simulator will land on.

Respond with exactly two lines:
  REASONING: <one or two sentences, no more than 300 characters>
  ANSWER: <A|B|C|D>
`;

// Serial queue identical to the oracle's, isolated per-process. Both
// services share the same key on the same project, so the per-minute cap is
// global. Keep the gap generous so peak rounds stay inside 30 RPM.
const minGapMs = 2100;
let queueTail: Promise<void> = Promise.resolve();

function reserveSlot(): Promise<void> {
  let release!: () => void;
  const ticket = new Promise<void>((r) => (release = r));
  // Swallow any prior rejection so one bad call doesn't poison the queue.
  const prev = queueTail.catch(() => undefined);
  queueTail = prev.then(() => ticket);
  return prev.then(() => {
    setTimeout(release, minGapMs);
  });
}

export async function answer(agent: HostedAgent, scenario: QuestionScenario): Promise<LlmAnswer> {
  const userPrompt = `${scenario.scenario}\n\nA) ${scenario.options.A}\nB) ${scenario.options.B}\nC) ${scenario.options.C}\nD) ${scenario.options.D}`;
  const sys = `${SYS}\n\nAGENT PERSONA:\n${agent.systemPrompt}`;
  if (config.skipAgentLlm) {
    return fallback(agent, scenario);
  }
  const provider = providerFor(agent.model);
  // Retry the LLM up to 3× with backoff so transient 429/503 errors don't
  // push us onto the deterministic fallback.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await reserveSlot();
      const text =
        provider === "groq"
          ? await callGroq(sys, userPrompt)
          : provider === "openrouter"
            ? await callOpenRouter(sys, userPrompt)
            : await callGemini(sys, userPrompt);
      const parsed = parse(text);
      if (parsed) return parsed;
      lastErr = new Error("unparseable LLM response");
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  console.warn(
    `llm exhausted retries for ${agent.id} (${agent.model}): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
  return fallback(agent, scenario);
}

async function callGemini(sys: string, userPrompt: string): Promise<string> {
  if (!config.geminiKey) throw new Error("GEMINI_API_KEY not set");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(config.geminiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

function providerFor(model: string): "groq" | "openrouter" | "gemini" {
  if (model === GROQ_MODEL) return "groq";
  if (model === NEMOTRON_MODEL) return "openrouter";
  return "gemini";
}

async function callGroq(sys: string, userPrompt: string): Promise<string> {
  if (!config.groqKey) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 250,
      temperature: 0.7,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`groq ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

async function callOpenRouter(sys: string, userPrompt: string): Promise<string> {
  if (!config.openrouterKey) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openrouterKey}`,
      "HTTP-Referer": "https://github.com/kaankacar/stellar-agent-kit",
      "X-Title": "MiroFish Arena Agent",
    },
    body: JSON.stringify({
      model: NEMOTRON_MODEL,
      max_tokens: 1500,
      temperature: 0.7,
      reasoning: { exclude: true },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

function parse(text: string): LlmAnswer | null {
  const reasoningMatches = [...text.matchAll(/REASONING:\s*([^\n]+)/gi)];
  const answerMatches = [...text.matchAll(/ANSWER:\s*([ABCD])/gi)];
  const reasoningMatch = reasoningMatches[reasoningMatches.length - 1];
  const answerMatch = answerMatches[answerMatches.length - 1];
  if (!answerMatch || !answerMatch[1]) return null;
  const choice = answerMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
  const reasoning = (reasoningMatch?.[1] ?? text).slice(0, 400).trim();
  return { choice, reasoning };
}

function fallback(agent: HostedAgent, scenario: QuestionScenario): LlmAnswer {
  // Deterministic from (system prompt, scenario id) so the same agent on the
  // same round always picks the same option. The reasoning blurb is in-theme
  // for kale-farming dilemmas; the `(fallback)` suffix makes it visible in
  // the UI that this answer didn't come from a live LLM call.
  let h = 0;
  const s = `${agent.systemPrompt}::${scenario.id}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % 4;
  const choice = (["A", "B", "C", "D"] as const)[idx]!;
  const PRIORS: Record<"A" | "B" | "C" | "D", string> = {
    A: "When pressure builds, regulators and big buyers tend to overcorrect first. Smart money calls A.",
    B: "Large operators absorb the pain, small growers get squeezed out. This always tilts toward B.",
    C: "I've watched five market resets play out like this. It ends at C.",
    D: "Surface story usually doesn't match ground truth. A surprise outcome — D — is the realistic call.",
  };
  return {
    choice,
    reasoning: `${PRIORS[choice]} (fallback — LLM unavailable, ${agent.displayName} prior)`,
  };
}

export const LLM_MODELS = { GEMINI_MODEL, NEMOTRON_MODEL, GROQ_MODEL };
