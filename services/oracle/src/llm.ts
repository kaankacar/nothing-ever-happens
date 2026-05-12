import { config } from "./config.js";

/**
 * Two-provider LLM client for the oracle:
 *   - **Groq** (Llama 3.1 8B Instant) — handles the high-volume persona
 *     dialogue exchanges. 30 RPM / 14,400 RPD free tier, ~300 tok/sec, so
 *     the simulator feels like a live broadcast.
 *   - **Gemini** (Flash Lite) — handles the per-round AI summary. Lower
 *     volume (1 call per round), and Gemini writes slightly more coherent
 *     short narratives.
 *
 * Each provider has its own throttle queue so they don't share rate-limit
 * pressure with each other.
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

const reserveGroqSlot = makeQueue(2100);   // 30 RPM
const reserveGeminiSlot = makeQueue(2100); // 30 RPM

/**
 * Persona dialogue path — high-volume, latency-sensitive. Routes to Groq.
 */
export async function callPersonaLlm(
  messages: Message[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<LlmResult> {
  if (!config.llm.groq) throw new Error("GROQ_API_KEY not configured");
  await reserveGroqSlot();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.groq}`,
    },
    body: JSON.stringify({
      // Tight token cap keeps us well under Groq's free-tier 6,000 TPM:
      // 50 sim calls × 150 max tokens = 7,500 tokens / round
      // Round window is ~4 min in DEV_MODE → ~1,875 TPM, ample headroom.
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

/**
 * AI summary path — low-volume, narrative quality matters. Routes to Gemini.
 */
export async function callLlm(
  messages: Message[],
  opts: { maxTokens?: number; temperature?: number } = {},
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
  if (system) {
    body.systemInstruction = { parts: [{ text: system.content }] };
  }

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

export const LLM_MODELS = { GROQ_MODEL, GEMINI_MODEL };
