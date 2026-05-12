import { config } from "./config.js";

/**
 * Two-provider LLM client for the oracle. Gemini is the primary, Groq is
 * the fallback:
 *   - **Gemini** (Flash Lite) — primary for both persona dialogue AND the
 *     per-round AI summary. On a paid Tier 1+ key it has effectively
 *     unlimited daily capacity and 4,000 RPM, so the simulator never runs
 *     out of quota.
 *   - **Groq** (Llama 3.1 8B Instant) — fallback for persona dialogue if
 *     Gemini errors. 14,400 RPD free tier.
 *
 * Each provider has its own throttle queue so a slow call to one doesn't
 * block the other.
 */

const GROQ_MODEL = "llama-3.1-8b-instant";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResult {
  text: string;
  raw?: unknown;
}

/** Serial throttle queue that survives one rejected call without poisoning. */
function makeQueue(minGapMs: number) {
  let tail: Promise<void> = Promise.resolve();
  return function reserveSlot(): Promise<void> {
    let release!: () => void;
    const ticket = new Promise<void>((r) => (release = r));
    const prev = tail.catch(() => undefined);
    tail = prev.then(() => ticket);
    return prev.then(() => {
      setTimeout(release, minGapMs);
    });
  };
}

// Gemini Tier 1 paid = 4,000 RPM (~15ms gap minimum). 200ms is a comfortable
// 300 RPM, well clear of the cap and fast enough that the conversation feed
// feels like a real-time broadcast. Free tier should bump this back to 2100.
const reserveGeminiSlot = makeQueue(200);
// Groq free is 30 RPM = 2s gap.
const reserveGroqSlot = makeQueue(2100);

/**
 * Persona dialogue path. Tries Gemini first (Tier 1 has effectively
 * unlimited daily capacity); falls back to Groq if Gemini errors or is
 * unconfigured. Returns the first successful response.
 */
export async function callPersonaLlm(
  messages: Message[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<LlmResult> {
  // Primary: Gemini Flash Lite
  if (config.llm.gemini) {
    try {
      return await callGeminiRaw(messages, opts);
    } catch (err) {
      if (!config.llm.groq) throw err;
      console.warn(
        `[oracle] gemini persona call failed, falling back to groq: ${(err as Error).message}`,
      );
    }
  }
  // Fallback: Groq Llama
  if (!config.llm.groq) throw new Error("no LLM provider configured");
  await reserveGroqSlot();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.groq}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: opts.maxTokens ?? 150,
      temperature: opts.temperature ?? 0.85,
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`groq ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return { text: json.choices?.[0]?.message?.content ?? "", raw: json };
}

/** Inner Gemini call; shared by callLlm (summaries) and callPersonaLlm. */
async function callGeminiRaw(
  messages: Message[],
  opts: { maxTokens?: number; temperature?: number },
): Promise<LlmResult> {
  if (!config.llm.gemini) throw new Error("GEMINI_API_KEY not configured");
  await reserveGeminiSlot();

  const system = messages.find((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");
  const body: Record<string, unknown> = {
    contents: turns.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    })),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.85,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system.content }] };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(config.llm.gemini)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return { text: parts.map((p) => p.text ?? "").join(""), raw: json };
}

/**
 * AI summary path — low-volume, narrative quality matters. Routes to Gemini.
 */
export async function callLlm(
  messages: Message[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<LlmResult> {
  return callGeminiRaw(messages, opts);
}

export const LLM_MODELS = { GROQ_MODEL, GEMINI_MODEL };
