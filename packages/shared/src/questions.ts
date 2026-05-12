import type { Choice, QuestionScenario } from "./types.js";

/**
 * Question templates — modern US kale farming dilemmas.
 *
 * Each template is seed-parametric: given a deterministic seed (a Stellar
 * ledger close hash), the same template instantiates the same scenario
 * across re-runs. The oracle picks one template per round, fills in the
 * variables, and publishes the result on-chain.
 *
 * The four outcomes for each scenario are *all plausible*, with no single
 * obviously-correct answer — the simulator's persona dialogue is what
 * determines which one becomes the verdict.
 */

export interface QuestionTemplate {
  id: string;
  tags: string[];
  /** Short human-readable label for editorial review. */
  label: string;
  /** Returns the instantiated scenario for a given seed. */
  instantiate(seed: string): {
    scenario: string;
    options: Record<Choice, string>;
  };
}

/** Pure deterministic PRNG seeded by hex string. */
export function makeRng(seed: string): () => number {
  const cleaned = seed.replace(/^0x/, "");
  let state = BigInt("0x" + cleaned.slice(0, 16));
  if (state === 0n) state = 0xdeadbeefcafebaben;
  return () => {
    state ^= state << 13n;
    state &= 0xffffffffffffffffn;
    state ^= state >> 7n;
    state ^= state << 17n;
    state &= 0xffffffffffffffffn;
    return Number(state & 0xffffffffn) / 0x100000000;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function range(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

const REGIONS = [
  { name: "Salinas Valley, CA", season: "spring", scale: "mid" },
  { name: "Oxnard Plain, CA", season: "winter", scale: "mid" },
  { name: "Skagit Valley, WA", season: "summer", scale: "small" },
  { name: "Yuma County, AZ", season: "winter", scale: "large" },
  { name: "Hudson Valley, NY", season: "summer", scale: "small" },
  { name: "Athens County, GA", season: "fall", scale: "small" },
  { name: "Willamette Valley, OR", season: "summer", scale: "small" },
  { name: "Lancaster County, PA", season: "fall", scale: "mid" },
];

const VARIETIES = [
  "Lacinato (dinosaur) kale",
  "Red Russian kale",
  "Curly green kale",
  "baby kale mix",
  "Redbor kale",
];

const RETAILERS = [
  "Whole Foods",
  "Costco",
  "Walmart",
  "Sprouts",
  "Trader Joe's",
  "a regional grocery co-op",
];

export const TEMPLATES: QuestionTemplate[] = [
  {
    id: "epa-pesticide-v1",
    label: "EPA reviews a pesticide critical to kale production",
    tags: ["regulation", "pesticides"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const variety = pick(rng, VARIETIES);
      const product = pick(rng, [
        "chlorpyrifos (an organophosphate)",
        "lambda-cyhalothrin (a synthetic pyrethroid)",
        "imidacloprid (a neonicotinoid)",
        "Bt toxin spray (an organic-approved biological)",
      ]);
      const usage = range(rng, 65, 92);
      const scenario =
        `The EPA opens a 90-day public-comment period on tightening restrictions on ${product}, ` +
        `which roughly ${usage}% of ${region.name} growers rely on for ${variety} aphid and ` +
        `cabbage-looper control. Organic-only operators want a full ban; the regional growers' ` +
        `association is asking for a 5-year transition. A coalition of three Fortune-500 grocery ` +
        `chains has just announced they'll stop sourcing kale treated with this chemical by ` +
        `next season regardless of what the EPA decides.`;
      return {
        scenario,
        options: {
          A: `EPA imposes the strict ban; ~30% of conventional growers exit kale within 18 months; organic prices rise 40%.`,
          B: `EPA grants a 5-year transition; growers invest in biocontrol; retail pressure forces faster adoption anyway.`,
          C: `EPA delays the decision past the next administration; uncertainty kills capital investment in the region for two seasons.`,
          D: `A class-action lawsuit from residential neighbours leapfrogs the EPA process; state-level bans cascade across CA, OR, WA.`,
        },
      };
    },
  },

  {
    id: "h2a-labor-v1",
    label: "H-2A visa rule change in the middle of harvest",
    tags: ["labor", "policy"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const wageRise = range(rng, 8, 22);
      const workers = range(rng, 40, 280);
      const scenario =
        `A federal court ruling forces the Department of Labor to raise the H-2A Adverse Effect ` +
        `Wage Rate in ${region.name} by ${wageRise}% effective in 45 days, mid-harvest. The local ` +
        `farm bureau represents ~${workers} active H-2A workers across 38 farms. The two largest ` +
        `kale growers say they'll mechanize within 18 months if the rule stands. Domestic workers ` +
        `are not available at scale. A new labor-rights coalition is suing for an even higher ` +
        `floor plus housing standards.`;
      return {
        scenario,
        options: {
          A: `Growers absorb the wage hike; retail prices rise ~8%; consumer demand drops modestly; everyone stays in business.`,
          B: `The two largest farms accelerate harvest mechanization; small farms can't afford machines; consolidation accelerates.`,
          C: `An emergency Congressional carve-out delays the rule by one year; harvest is saved; rule re-enters next year worse.`,
          D: `Several farms abandon the crop mid-field for a season; supply shock spikes prices; lawsuits from contract buyers follow.`,
        },
      };
    },
  },

  {
    id: "drought-water-v1",
    label: "Drought triggers water-rights conflict",
    tags: ["climate", "water"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const cutPct = range(rng, 25, 55);
      const scenario =
        `${region.name} growers receive notice that their irrigation district water allocation ` +
        `will be cut by ${cutPct}% next season due to reservoir levels. A senior water-rights ` +
        `holder (a large nut-tree operation) is willing to sell their unused allocation, but the ` +
        `state water board is reviewing whether such transfers should be allowed during drought ` +
        `emergencies. Two startups are pitching subsurface drip retrofit financing.`;
      return {
        scenario,
        options: {
          A: `Growers buy the senior allocation; state lets the transfer proceed; precedent unlocks a private water market.`,
          B: `State blocks the transfer; growers idle 30% of kale acres; spot-market kale prices jump 60%.`,
          C: `Drip-retrofit financing closes a deal; kale survives the season at smaller margins; the model scales next year.`,
          D: `Growers switch en masse to brassica crops with shorter water needs; kale supply shifts to imports from Mexico for two years.`,
        },
      };
    },
  },

  {
    id: "retailer-contract-v1",
    label: "Big-box retailer demands a year-round contract",
    tags: ["market", "supply-chain"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const retailer = pick(rng, RETAILERS);
      const region = pick(rng, REGIONS);
      const volume = range(rng, 12, 95);
      const pricePerLb = (1.05 + rng() * 0.95).toFixed(2);
      const scenario =
        `${retailer} approaches a 22-farm grower cooperative in ${region.name} with a take-it-or-leave-it ` +
        `proposal: a 3-year exclusive at $${pricePerLb}/lb for ${volume},000 lbs/week of curly green kale, ` +
        `year-round, with a strict reject-quality clause. The current spot market averages $${(Number(pricePerLb) + 0.45).toFixed(2)}/lb but ` +
        `varies seasonally. The co-op's smaller members can't survive a spot-market winter without ` +
        `the contract; the larger members want flexibility to sell to higher-margin chefs and CSAs.`;
      return {
        scenario,
        options: {
          A: `Co-op signs the exclusive; smaller members thrive; larger members defect within 6 months; co-op fractures.`,
          B: `Co-op rejects the contract; ${retailer} signs a vertically-integrated grower in Mexico; co-op revenue falls 18%.`,
          C: `Co-op counter-offers non-exclusive at higher volume; ${retailer} agrees grudgingly; relationship lasts but stays adversarial.`,
          D: `Co-op leadership privately accepts; some members find out and trigger a governance crisis; co-op survives but loses 6 farms.`,
        },
      };
    },
  },

  {
    id: "bagrada-bug-v1",
    label: "Bagrada bug outbreak threatens the crop",
    tags: ["disease", "pests"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const lossPct = range(rng, 18, 65);
      const scenario =
        `A bagrada bug (Bagrada hilaris) outbreak in ${region.name} is destroying kale and other ` +
        `brassicas at unprecedented intensity. Conventional growers report ${lossPct}% crop loss ` +
        `in untreated fields. The state IPM advisor is recommending a coordinated reset — plow ` +
        `under all kale within a 40-mile radius, leave brassicas fallow for one full year. ` +
        `Organic growers have an experimental Beauveria bassiana spray that's showing 50% efficacy.`;
      return {
        scenario,
        options: {
          A: `Growers comply with the coordinated reset; supply collapses for 12 months; market share permanently shifts to Mexico imports.`,
          B: `Half comply, half don't; the bug overwinters in the non-compliant fields; outbreak continues for 3 more years.`,
          C: `The Beauveria spray scales fast on emergency funding; conventional growers adopt it; the region becomes a biocontrol leader.`,
          D: `An imported predator wasp is introduced; works in year 2; but it also collapses populations of three native moth species.`,
        },
      };
    },
  },

  {
    id: "tariff-seed-v1",
    label: "New tariffs on imported brassica seed",
    tags: ["trade", "supply-chain"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const pct = range(rng, 18, 42);
      const country = pick(rng, ["the Netherlands", "Italy", "Japan", "South Korea"]);
      const scenario =
        `A new ${pct}% tariff on hybrid brassica seed imports from ${country} hits ${region.name} ` +
        `growers — about 70% of their hybrid kale seed has been imported. Two US seed companies have ` +
        `domestic varieties but their germination rates run 6-9% lower; one is owned by a multinational. ` +
        `The university extension is rushing to release public-domain regional varieties but those ` +
        `won't be commercially available for two seasons.`;
      return {
        scenario,
        options: {
          A: `Growers eat the tariff; pass costs to retailers; consumer prices rise ~12%; market shrinks 8%.`,
          B: `Growers switch to the lower-yield domestic hybrids; per-acre revenue drops; smaller farms exit the crop.`,
          C: `Growers form a buying co-op to import via a third country; technically legal; politically tenuous.`,
          D: `The university releases an open-source variety early under emergency funding; it spreads fast; long-term seed sovereignty improves.`,
        },
      };
    },
  },

  {
    id: "vertical-farming-v1",
    label: "Vertical-farming startup enters the kale market",
    tags: ["competition", "tech"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const acreEquiv = range(rng, 25, 220);
      const pricePerLb = (3.5 + rng() * 1.8).toFixed(2);
      const scenario =
        `A well-funded vertical-farming startup announces a ${acreEquiv}-acre-equivalent facility ` +
        `outside Chicago, targeting urban Midwest kale at $${pricePerLb}/lb wholesale, year-round, ` +
        `with no pesticide residue. Field growers in ${region.name} currently ship to the same ` +
        `region. The startup's investors include two retail chains that already buy from the field ` +
        `growers. Energy costs are the startup's biggest open question; their operating model ` +
        `assumes a 20-year flat electricity contract that's not yet signed.`;
      return {
        scenario,
        options: {
          A: `The startup scales; field growers lose 25% of Midwest volume; West Coast farms shift to chef-grade specialty kale.`,
          B: `The electricity contract falls through; the startup burns cash for 18 months and shuts down; field growers consolidate the territory.`,
          C: `The retail-chain investors quietly pressure their suppliers to favor the vertical farm; an antitrust complaint follows.`,
          D: `Field growers form a marketing co-op around "soil-grown" labeling; consumer preference splits; both models coexist.`,
        },
      };
    },
  },

  {
    id: "land-sale-v1",
    label: "Developer makes an unsolicited offer on a multi-generation kale farm",
    tags: ["land", "succession"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const acres = range(rng, 180, 2400);
      const offerPerAcre = range(rng, 18, 95);
      const scenario =
        `A real-estate developer offers $${offerPerAcre}k/acre for a ${acres}-acre fourth-generation ` +
        `kale farm in ${region.name} — well above agricultural-use value. The land is zoned ` +
        `agricultural but the county has signaled it may rezone within 5 years. The farm employs ` +
        `28 year-round workers and supplies three regional CSAs. The two heirs disagree: one wants ` +
        `to sell and start a smaller farm elsewhere; the other wants to keep operating.`;
      return {
        scenario,
        options: {
          A: `Heirs sell; land is rezoned; subdivisions go up within 7 years; the workers find jobs nearby; the regional kale market shrinks.`,
          B: `Heirs refuse; farm runs at break-even for a decade; one heir eventually sells their share to a private-equity ag fund.`,
          C: `A conservation easement is sold to a land trust; farm operates with restricted development rights; heirs split a smaller cash payout.`,
          D: `The county passes an emergency agricultural-zoning lock; offer evaporates; neighboring landowners sue the county and win.`,
        },
      };
    },
  },

  {
    id: "labeling-lawsuit-v1",
    label: "Lawsuit over 'organic' labeling on hybrid kale",
    tags: ["regulation", "branding"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const damages = range(rng, 2, 28);
      const scenario =
        `A class-action lawsuit accuses three large kale growers in ${region.name} of mislabeling ` +
        `hybrid-seed kale as "organic heirloom" on grocery shelves. The plaintiffs are asking ` +
        `$${damages}M in damages plus an injunction. The USDA's organic certifier confirms hybrid ` +
        `seed is fully compatible with organic labeling under federal rules; the lawsuit hinges on ` +
        `the word "heirloom" specifically. Two of the growers settled smaller versions of this case ` +
        `last year. Industry trade groups are split on whether to fund the defense.`;
      return {
        scenario,
        options: {
          A: `Growers settle for low damages; quietly drop "heirloom" from labels; consumer trust in the category dips for one year.`,
          B: `Growers fight and win; precedent codifies that "heirloom" is marketing-only; consumer-protection groups push for new federal labeling standards.`,
          C: `Growers fight and lose; damages awarded; one of the three goes bankrupt; industry-wide relabeling at $40M+ cost.`,
          D: `Settlement includes a new voluntary regional-origin label; becomes a marketing advantage; competitors elsewhere adopt similar labels.`,
        },
      };
    },
  },

  {
    id: "csa-pivot-v1",
    label: "CSA model collapses, growers pivot",
    tags: ["market", "consumer"],
    instantiate(seed) {
      const rng = makeRng(seed);
      const region = pick(rng, REGIONS);
      const dropPct = range(rng, 25, 60);
      const scenario =
        `Three years of inflation have crushed the CSA (community-supported agriculture) model ` +
        `in ${region.name} — subscriptions are down ${dropPct}% from the pandemic peak. Eight kale-` +
        `forward farms relied on direct-to-consumer subscriptions for 40-70% of revenue. A new ` +
        `online aggregator wants to take over distribution for a 22% cut; chefs at three regional ` +
        `restaurant groups are offering forward contracts at lower margins but reliable volume; ` +
        `the farmers' market itself is also negotiating with the city for permanent indoor stalls.`;
      return {
        scenario,
        options: {
          A: `Farms sign with the aggregator; volume holds; margins compress; two farms exit within 18 months citing thin returns.`,
          B: `Farms commit to chef contracts; revenue stabilizes but ceiling is lower; relationships deepen, marketing costs drop.`,
          C: `The indoor-market plan succeeds; year-round farmer-direct sales rebound; the aggregator never gains traction in the region.`,
          D: `Farms keep CSAs but cut SKUs and partner on shared logistics; cost drops 18%; subscriptions recover slowly.`,
        },
      };
    },
  },
];

export function pickTemplate(seed: string): QuestionTemplate {
  const rng = makeRng(seed);
  return pick(rng, TEMPLATES);
}

export function instantiateQuestion(
  template: QuestionTemplate,
  seed: string,
  roundId: number,
  openedAt: Date,
  seedLedger: number,
  commitWindowSeconds: number,
  revealWindowSeconds: number,
): QuestionScenario {
  const { scenario, options } = template.instantiate(seed);
  const closes = openedAt.getTime() + commitWindowSeconds * 1000;
  const resolves = closes + revealWindowSeconds * 1000;
  return {
    id: `r${roundId}-${template.id}`,
    roundId,
    templateId: template.id,
    scenario,
    options,
    tags: template.tags,
    openedAt: openedAt.toISOString(),
    closesAt: new Date(closes).toISOString(),
    resolvesAt: new Date(resolves).toISOString(),
    seedLedger,
  };
}
