import { domainOf, terms } from "./text";

/**
 * Fixed topic taxonomy. Auto-tagging in `scripts/index.ts` either asks an LLM
 * (when OPENAI_API_KEY is set) or falls back to the weighted keyword/domain
 * scorer below, which is deterministic and needs no network.
 */

export type TopicSlug =
  | "ai-ml"
  | "ui-design"
  | "devtools"
  | "infra"
  | "crypto"
  | "reading"
  | "misc";

export type TopicDefinition = {
  slug: TopicSlug;
  label: string;
  blurb: string;
  /** CSS custom property carrying the topic accent colour. */
  color: string;
  keywords: Record<string, number>;
  domains: string[];
};

export const TOPICS: TopicDefinition[] = [
  {
    slug: "ai-ml",
    label: "AI/ML",
    blurb: "Models, agents, evals, and the papers behind them.",
    color: "var(--topic-ai-ml)",
    keywords: {
      ai: 2, llm: 3, llms: 3, gpt: 3, claude: 3, gemini: 2, transformer: 3,
      attention: 2, embedding: 3, embeddings: 3, "fine-tune": 3, finetuning: 3,
      rag: 3, retrieval: 2, agent: 2, agents: 2, agentic: 3, prompt: 2,
      prompting: 2, inference: 2, tokenizer: 3, training: 2, dataset: 2,
      benchmark: 2, eval: 2, evals: 3, pytorch: 3, tensorflow: 3, diffusion: 3,
      neural: 3, "machine-learning": 3, ml: 2, mlops: 3, huggingface: 3,
      openai: 2, anthropic: 2, cuda: 2, gpu: 2, quantization: 3,
      distillation: 3, reasoning: 2, multimodal: 3, arxiv: 2,
    },
    domains: [
      "arxiv.org", "huggingface.co", "openai.com", "anthropic.com",
      "pytorch.org", "lilianweng.github.io", "distill.pub", "jalammar.github.io",
      "sebastianraschka.com", "ai.meta.com", "deepmind.google",
    ],
  },
  {
    slug: "ui-design",
    label: "UI/Design",
    blurb: "Interface craft, motion, typography, and design systems.",
    color: "var(--topic-ui-design)",
    keywords: {
      design: 3, ui: 3, ux: 3, interface: 2, typography: 3, typeface: 3,
      font: 2, fonts: 2, color: 2, palette: 2, layout: 2, spacing: 2,
      css: 3, tailwind: 3, animation: 3, motion: 2, transition: 1,
      accessibility: 3, a11y: 3, aria: 2, contrast: 2, component: 2,
      components: 2, "design-system": 3, figma: 3, prototype: 2, usability: 3,
      heuristics: 2, craft: 2, polish: 2, aesthetic: 2, shadcn: 3, radix: 3,
      flexbox: 3, grid: 1, responsive: 2, "dark-mode": 3, icon: 2, icons: 2,
    },
    domains: [
      "nngroup.com", "css-tricks.com", "tailwindcss.com", "ui.shadcn.com",
      "refactoringui.com", "inclusive-components.design", "rauno.me",
      "type-scale.com", "figma.com", "smashingmagazine.com", "web.dev",
    ],
  },
  {
    slug: "devtools",
    label: "DevTools",
    blurb: "Editors, build tooling, frameworks, and developer workflow.",
    color: "var(--topic-devtools)",
    keywords: {
      typescript: 3, javascript: 2, react: 3, nextjs: 3, next: 1, vite: 3,
      bundler: 3, esbuild: 3, webpack: 3, turbopack: 3, compiler: 2,
      eslint: 3, prettier: 2, biome: 3, lint: 2, linting: 2, tsconfig: 3,
      npm: 2, pnpm: 3, bun: 3, deno: 3, node: 2, monorepo: 3, cli: 2,
      git: 3, rebase: 3, github: 2, "pull-request": 2, ci: 2, "github-actions": 3,
      debugging: 2, devtools: 3, editor: 2, vscode: 3, neovim: 3, dx: 3,
      framework: 2, astro: 3, svelte: 3, api: 1, sdk: 2, testing: 2,
      playwright: 3, vitest: 3, jest: 2, refactor: 2, codegen: 2, tsx: 2,
    },
    domains: [
      "nextjs.org", "vite.dev", "vitejs.dev", "esbuild.github.io", "biomejs.dev",
      "bun.sh", "deno.com", "git-scm.com", "docs.astro.build", "svelte.dev",
      "typescriptlang.org", "tsx.is", "playwright.dev", "developer.mozilla.org",
    ],
  },
  {
    slug: "infra",
    label: "Infra",
    blurb: "Databases, deploys, observability, and keeping it up.",
    color: "var(--topic-infra)",
    keywords: {
      infra: 3, infrastructure: 3, kubernetes: 3, k8s: 3, docker: 3,
      container: 2, containers: 2, serverless: 3, edge: 2, cdn: 3, dns: 2,
      deploy: 2, deployment: 2, vercel: 2, aws: 3, gcp: 3, cloudflare: 3,
      terraform: 3, postgres: 3, postgresql: 3, sqlite: 3, mysql: 2,
      database: 3, db: 2, pgvector: 3, redis: 3, kafka: 3, queue: 2,
      cache: 2, caching: 3, latency: 2, throughput: 2, scaling: 3, scale: 1,
      sre: 3, observability: 3, monitoring: 3, tracing: 2, logs: 2,
      uptime: 3, incident: 3, postmortem: 3, migration: 2, replication: 3,
      sharding: 3, neon: 2, turso: 3, upstash: 3, libsql: 3, "load-balancer": 3,
    },
    domains: [
      "kubernetes.io", "docs.docker.com", "fly.io", "vercel.com", "neon.tech",
      "neon.com", "upstash.com", "turso.tech", "sre.google", "aws.amazon.com",
      "cloudflare.com", "planetscale.com", "supabase.com",
    ],
  },
  {
    slug: "crypto",
    label: "Crypto",
    blurb: "Protocols, rollups, and on-chain mechanism design.",
    color: "var(--topic-crypto)",
    keywords: {
      crypto: 3, bitcoin: 3, btc: 3, ethereum: 3, eth: 3, solana: 3,
      blockchain: 3, onchain: 3, "on-chain": 3, defi: 3, wallet: 2,
      "smart-contract": 3, solidity: 3, evm: 3, rollup: 3, rollups: 3,
      zk: 3, zkp: 3, "zero-knowledge": 3, l2: 3, mainnet: 3, testnet: 3,
      staking: 3, validator: 3, consensus: 2, mempool: 3, gas: 2, nft: 3,
      token: 1, tokenomics: 3, dao: 3, stablecoin: 3, uniswap: 3, mev: 3,
      custody: 2, ledger: 2, "proof-of-stake": 3, whitepaper: 1,
    },
    domains: [
      "bitcoin.org", "ethereum.org", "vitalik.eth.limo", "vitalik.ca",
      "uniswap.org", "solana.com", "docs.solana.com", "a16zcrypto.com",
      "paradigm.xyz", "l2beat.com",
    ],
  },
  {
    slug: "reading",
    label: "Reading",
    blurb: "Essays and long reads worth a second pass.",
    color: "var(--topic-reading)",
    keywords: {
      essay: 3, essays: 3, book: 2, books: 2, reading: 2, longform: 3,
      writing: 2, wrote: 1, blog: 1, story: 1, history: 2, philosophy: 3,
      career: 3, taste: 2, craft: 1, advice: 2, lessons: 2, thinking: 2,
      thought: 1, "mental-model": 3, "mental-models": 3, productivity: 3,
      procrastination: 3, habits: 3, focus: 2, motivation: 2, ambition: 3,
      "great-work": 3, curiosity: 3, hiring: 2, management: 3, leadership: 2,
      startup: 2, founders: 2, culture: 2, interview: 1, notes: 1,
    },
    domains: [
      "paulgraham.com", "waitbutwhy.com", "fs.blog", "gwern.net",
      "danluu.com", "blog.samaltman.com", "slatestarcodex.com",
      "astralcodexten.substack.com", "newyorker.com", "theatlantic.com",
      "stratechery.com", "notes.andymatuschak.org",
    ],
  },
  {
    slug: "misc",
    label: "Misc",
    blurb: "Everything else in the pile.",
    color: "var(--topic-misc)",
    keywords: {},
    domains: [],
  },
];

export const TOPIC_BY_SLUG = new Map(TOPICS.map((topic) => [topic.slug, topic]));
export const DEFAULT_TOPIC: TopicSlug = "misc";

export function topicLabel(slug: string): string {
  return TOPIC_BY_SLUG.get(slug as TopicSlug)?.label ?? slug;
}

export function isTopicSlug(value: string): value is TopicSlug {
  return TOPIC_BY_SLUG.has(value as TopicSlug);
}

/** Accepts a label ("AI/ML"), a slug ("ai-ml"), or a loose alias ("machine learning"). */
export function toTopicSlug(value: string): TopicSlug | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (isTopicSlug(raw)) return raw;

  const aliases: Record<string, TopicSlug> = {
    "ai/ml": "ai-ml", ai: "ai-ml", ml: "ai-ml", "machine learning": "ai-ml",
    llm: "ai-ml", llms: "ai-ml", "ai-ml": "ai-ml",
    "ui/design": "ui-design", ui: "ui-design", ux: "ui-design",
    design: "ui-design", frontend: "ui-design",
    devtools: "devtools", "dev tools": "devtools", tooling: "devtools",
    dev: "devtools", engineering: "devtools",
    infra: "infra", infrastructure: "infra", devops: "infra",
    cloud: "infra", databases: "infra", database: "infra",
    crypto: "crypto", web3: "crypto", blockchain: "crypto",
    reading: "reading", essays: "reading", essay: "reading",
    books: "reading", longform: "reading",
    misc: "misc", other: "misc", random: "misc",
  };
  const normalized = raw.replace(/[_\s]+/g, " ");
  return aliases[normalized] ?? aliases[normalized.replace(/ /g, "-")] ?? null;
}

export type TopicScoreInput = {
  text: string;
  urls: string[];
  hints?: string[];
};

/**
 * Weighted keyword + domain scoring. Returns every topic with a positive score,
 * normalized to 0-1 against the winning topic.
 */
export function scoreTopics({ text, urls, hints = [] }: TopicScoreInput): Record<string, number> {
  const tokens = terms(text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  const domains = urls.map(domainOf).filter(Boolean);
  const raw: Record<string, number> = {};

  for (const topic of TOPICS) {
    if (topic.slug === DEFAULT_TOPIC) continue;
    let score = 0;
    for (const [keyword, weight] of Object.entries(topic.keywords)) {
      const occurrences =
        counts.get(keyword) ?? counts.get(keyword.replace(/-/g, "")) ?? 0;
      if (occurrences > 0) {
        // Diminishing returns so one repeated word cannot dominate.
        score += weight * (1 + Math.log(occurrences));
      }
    }
    for (const domain of domains) {
      if (topic.domains.some((known) => domain === known || domain.endsWith(`.${known}`))) {
        score += 12;
      }
    }
    for (const hint of hints) {
      if (toTopicSlug(hint) === topic.slug) score += 18;
    }
    if (score > 0) raw[topic.slug] = score;
  }

  const max = Math.max(0, ...Object.values(raw));
  if (max === 0) return {};

  return Object.fromEntries(
    Object.entries(raw)
      .map(([slug, score]) => [slug, Math.round((score / max) * 1000) / 1000] as const)
      .sort((a, b) => b[1] - a[1]),
  );
}

/** Turns scores into at most `max` labels, always returning at least one topic. */
export function pickTopics(
  scores: Record<string, number>,
  { max = 3, threshold = 0.34 } = {},
): TopicSlug[] {
  const ranked = Object.entries(scores)
    .filter(([slug]) => isTopicSlug(slug))
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) return [DEFAULT_TOPIC];
  const [, topScore] = ranked[0];
  if (topScore <= 0) return [DEFAULT_TOPIC];

  const picked = ranked
    .filter(([, score], position) => position === 0 || score >= threshold)
    .slice(0, max)
    .map(([slug]) => slug as TopicSlug);

  return picked.length > 0 ? picked : [DEFAULT_TOPIC];
}
