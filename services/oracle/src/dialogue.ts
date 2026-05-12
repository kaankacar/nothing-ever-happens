import type { Choice, QuestionScenario } from "@mirofish/shared";
import { makeRng, pick } from "@mirofish/shared";
import type { Persona } from "./personas.js";

/**
 * Templated dialogue used as a last-resort fallback when the LLM (Gemini)
 * is unreachable or rate-limited. The wording is intentionally modern,
 * casual, American, and kale-industry-flavored so a fallback line still
 * reads in-theme. Every line ends with a "(fallback)" suffix so the
 * frontend can show whether dialogue came from real AI or the safety net.
 *
 * In normal operation these strings should almost never appear — the
 * simulator retries 3× before reaching for them, and Gemini Flash Lite's
 * uptime is reliable. The safety net exists so the round still completes
 * if Google's API is briefly degraded.
 */

const OPENERS = [
  "Look, {name},",
  "Honestly, {name},",
  "{name}, hear me out:",
  "{name}, between us:",
  "Listen, {name},",
  "Real talk, {name}:",
  "{name}, I've been in this business 20 years:",
  "OK {name},",
];

const PIVOTS = [
  "I'd bet the back forty",
  "anyone who reads the market knows",
  "I was talking to my buyer last week,",
  "this is what's going to happen:",
  "I saw the same thing back in 2018,",
  "the math is brutal here,",
  "the spreadsheet doesn't lie,",
  "every grower I know is saying",
];

const CLOSERS = [
  "That's just how it plays out.",
  "Mark it down.",
  "You'll see.",
  "Trust me on this one.",
  "I'd put money on it.",
  "That's the call.",
];

function paraphraseOption(option: string, role: string, rng: () => number): string {
  const flavors: Record<string, string[]> = {
    "Grower": [
      "after this many seasons in the dirt,",
      "by next harvest,",
      "look at what happened in '21:",
    ],
    "Field Manager": [
      "my crew has been telling me,",
      "the labor math doesn't pencil any other way:",
      "from the field's perspective,",
    ],
    "Co-op Director": [
      "if you've sat through a co-op board meeting like I have,",
      "the membership won't stand for anything but this:",
      "I'll be straight with you:",
    ],
    "Whole Foods Buyer": [
      "my procurement team has run the numbers,",
      "from a category-buy perspective,",
      "off the record:",
    ],
    "USDA Organic Inspector": [
      "the rules are pretty clear here,",
      "compliance-wise, this lands one way:",
      "the certification clock is ticking and",
    ],
    "Agronomist": [
      "the field trials we ran show,",
      "extension data points to,",
      "agronomically speaking,",
    ],
    "Crew Lead": [
      "the guys on the line are saying,",
      "from where I'm standing in the field:",
      "I'm the one who has to tell them, and",
    ],
    "Marketing Lead": [
      "consumer surveys say,",
      "the brand impact will be,",
      "in terms of shelf positioning,",
    ],
    "Restaurant Chef": [
      "my chef customers want,",
      "on the plate it has to be:",
      "if you've worked a Friday night service:",
    ],
    "CSA Coordinator": [
      "my members are telling me,",
      "subscriber retention will depend on,",
      "in the box this week:",
    ],
    "Seed Sales Rep": [
      "the catalogue numbers are showing,",
      "every grower I sold to last year is saying,",
      "from the seed-supply side:",
    ],
    "Extension Officer": [
      "our county data points to,",
      "the research trials line up:",
      "I'm telling every grower in my district:",
    ],
    "Ag Investor": [
      "ROI-wise this lands as,",
      "the cap rate suggests,",
      "from a portfolio view:",
    ],
    "Regional Distributor": [
      "the load board is screaming,",
      "from the freight side:",
      "the cold chain economics push toward,",
    ],
    "Packing-Shed Foreman": [
      "the throughput numbers say,",
      "from the shed floor:",
      "we'll just end up with,",
    ],
    "Greenhouse Operator": [
      "controlled-environment math says,",
      "the kWh costs are forcing,",
      "for indoor production:",
    ],
    "Truck Driver": [
      "I've been hauling kale for 12 years and,",
      "every depot I roll into says,",
      "the dispatchers tell me,",
    ],
    "Land Trust Officer": [
      "from an easement perspective,",
      "the conservation framework points to,",
      "land-value math forces,",
    ],
    "Farm Labor Organizer": [
      "the workers I represent want,",
      "every farm I've visited is heading toward,",
      "from a labor-rights view:",
    ],
    "County Ag Commissioner": [
      "the county will end up,",
      "from a regulatory-enforcement view:",
      "we're seeing a pattern,",
    ],
  };
  const opening = pick(rng, flavors[role] ?? ["here's what'll happen:"]);
  return `${opening} ${option.toLowerCase()}`;
}

export function renderMessage(
  scenario: QuestionScenario,
  speaker: Persona,
  listener: Persona,
  argued: Choice,
  seed: string,
  seq: number,
): string {
  const rng = makeRng(`${seed}:${seq}`);
  const opener = pick(rng, OPENERS).replace("{name}", listener.name);
  const pivot = pick(rng, PIVOTS);
  const closer = pick(rng, CLOSERS);
  const option = scenario.options[argued];
  const paraphrase = paraphraseOption(option, speaker.role, rng);
  return `${opener} ${pivot} ${paraphrase} ${closer} (fallback)`;
}
