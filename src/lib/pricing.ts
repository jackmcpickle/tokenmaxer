/**
 * Per-model pricing, USD per 1,000,000 tokens. These are ESTIMATES used only to
 * show an approximate spend on the board — update them by editing this file and
 * redeploying. Model ids are first normalized (provider prefixes and date/version
 * suffixes stripped, mirroring CodexBar's normalizeCodexModel/normalizeClaudeModel),
 * then matched by longest case-insensitive substring, so
 * `claude-opus-4-8-20260101` matches the `claude-opus-4-8` entry.
 *
 * Limitation: rows are session aggregates, so long-context threshold pricing
 * (per-request >272K/200K input surcharges) and the 1h cache-write split cannot
 * be applied here — everything is billed at the base (below-threshold) rates.
 */
export interface ModelPrice {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}

const PRICES: Record<string, ModelPrice> = {
    // Anthropic — Claude (rates from CodexBar's CostUsagePricing claude table)
    'claude-fable-5': {
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    },
    'claude-opus-4-5': {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
    },
    'claude-opus-4-6': {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
    },
    'claude-opus-4-7': {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
    },
    'claude-opus-4-8': {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
    },
    'claude-opus-4': {
        input: 15,
        output: 75,
        cacheRead: 1.5,
        cacheWrite: 18.75,
    },
    'claude-haiku-4-5': {
        input: 1,
        output: 5,
        cacheRead: 0.1,
        cacheWrite: 1.25,
    },
    'claude-sonnet-4': {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    },
    'claude-sonnet-5': {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    },
    'claude-haiku-4': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    'claude-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    'claude-3-5-sonnet': {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    },
    'claude-3-5-haiku': {
        input: 0.8,
        output: 4,
        cacheRead: 0.08,
        cacheWrite: 1,
    },
    'claude-3-opus': {
        input: 15,
        output: 75,
        cacheRead: 1.5,
        cacheWrite: 18.75,
    },
    // OpenAI — Codex / GPT (rates from CodexBar's CostUsagePricing codex table;
    // where CodexBar leaves cacheRead/cacheWrite unset, OpenAI bills those
    // tokens at the uncached input rate, so the input rate is mirrored here)
    'gpt-5-codex': {
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: 1.25,
    },
    'gpt-5-mini': {
        input: 0.25,
        output: 2,
        cacheRead: 0.025,
        cacheWrite: 0.25,
    },
    'gpt-5-nano': {
        input: 0.05,
        output: 0.4,
        cacheRead: 0.005,
        cacheWrite: 0.05,
    },
    'gpt-5-pro': { input: 15, output: 120, cacheRead: 15, cacheWrite: 15 },
    'gpt-5.1-codex-max': {
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: 1.25,
    },
    'gpt-5.1-codex-mini': {
        input: 0.25,
        output: 2,
        cacheRead: 0.025,
        cacheWrite: 0.25,
    },
    'gpt-5.1-codex': {
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: 1.25,
    },
    'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    'gpt-5.2-codex': {
        input: 1.75,
        output: 14,
        cacheRead: 0.175,
        cacheWrite: 1.75,
    },
    'gpt-5.2-pro': { input: 21, output: 168, cacheRead: 21, cacheWrite: 21 },
    'gpt-5.2': { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75 },
    'gpt-5.3-codex-spark': {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    },
    'gpt-5.3-codex': {
        input: 1.75,
        output: 14,
        cacheRead: 0.175,
        cacheWrite: 1.75,
    },
    'gpt-5.4-mini': {
        input: 0.75,
        output: 4.5,
        cacheRead: 0.075,
        cacheWrite: 0.75,
    },
    'gpt-5.4-nano': {
        input: 0.2,
        output: 1.25,
        cacheRead: 0.02,
        cacheWrite: 0.2,
    },
    'gpt-5.4-pro': { input: 30, output: 180, cacheRead: 30, cacheWrite: 30 },
    'gpt-5.4': { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
    'gpt-5.5-pro': { input: 30, output: 180, cacheRead: 30, cacheWrite: 30 },
    'gpt-5.5': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
    // GPT-5.6 Sol/Terra/Luna carry explicit cache-write rates (1.25x input).
    'gpt-5.6-sol': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    'gpt-5.6-terra': {
        input: 2.5,
        output: 15,
        cacheRead: 0.25,
        cacheWrite: 3.125,
    },
    'gpt-5.6-luna': { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
    'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 },
    o3: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },

    // Google — Gemini (opencode/pi route here often; estimates)
    'gemini-2.5-pro': {
        input: 1.25,
        output: 10,
        cacheRead: 0.31,
        cacheWrite: 1.625,
    },
    'gemini-2.5-flash-lite': {
        input: 0.1,
        output: 0.4,
        cacheRead: 0.025,
        cacheWrite: 0.1,
    },
    'gemini-2.5-flash': {
        input: 0.3,
        output: 2.5,
        cacheRead: 0.075,
        cacheWrite: 0.3,
    },
    'gemini-2.0-flash': {
        input: 0.1,
        output: 0.4,
        cacheRead: 0.025,
        cacheWrite: 0.1,
    },
    'gemini-1.5-pro': {
        input: 1.25,
        output: 5,
        cacheRead: 0.3125,
        cacheWrite: 1.25,
    },
    'gemini-1.5-flash': {
        input: 0.075,
        output: 0.3,
        cacheRead: 0.019,
        cacheWrite: 0.075,
    },
    gemini: { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0.3 },

    // ---- Open-weight models via OpenRouter (rough per-1M estimates) ----
    // DeepSeek
    'deepseek-r1': {
        input: 0.55,
        output: 2.19,
        cacheRead: 0.14,
        cacheWrite: 0.55,
    },
    'deepseek-chat': {
        input: 0.28,
        output: 0.88,
        cacheRead: 0.03,
        cacheWrite: 0.28,
    },
    'deepseek-v3': {
        input: 0.27,
        output: 1.1,
        cacheRead: 0.07,
        cacheWrite: 0.27,
    },
    deepseek: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
    // Qwen
    'qwen3-coder': { input: 0.3, output: 1.2, cacheRead: 0.3, cacheWrite: 0.3 },
    'qwen-3-coder': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.3,
        cacheWrite: 0.3,
    },
    'qwen-2.5-coder': {
        input: 0.15,
        output: 0.15,
        cacheRead: 0.15,
        cacheWrite: 0.15,
    },
    'qwen-2.5': { input: 0.4, output: 0.4, cacheRead: 0.4, cacheWrite: 0.4 },
    qwen3: { input: 0.2, output: 0.85, cacheRead: 0.2, cacheWrite: 0.2 },
    qwq: { input: 0.15, output: 0.45, cacheRead: 0.15, cacheWrite: 0.15 },
    qwen: { input: 0.35, output: 0.4, cacheRead: 0.35, cacheWrite: 0.35 },
    // Meta Llama
    'llama-4-maverick': {
        input: 0.2,
        output: 0.85,
        cacheRead: 0.2,
        cacheWrite: 0.2,
    },
    'llama-4-scout': {
        input: 0.11,
        output: 0.34,
        cacheRead: 0.11,
        cacheWrite: 0.11,
    },
    'llama-3.3': {
        input: 0.13,
        output: 0.39,
        cacheRead: 0.13,
        cacheWrite: 0.13,
    },
    'llama-3.1-405b': {
        input: 0.8,
        output: 0.8,
        cacheRead: 0.8,
        cacheWrite: 0.8,
    },
    'llama-3.1': {
        input: 0.13,
        output: 0.39,
        cacheRead: 0.13,
        cacheWrite: 0.13,
    },
    'llama-3': { input: 0.13, output: 0.39, cacheRead: 0.13, cacheWrite: 0.13 },
    llama: { input: 0.2, output: 0.4, cacheRead: 0.2, cacheWrite: 0.2 },
    // Mistral
    'mistral-large': { input: 2, output: 6, cacheRead: 2, cacheWrite: 2 },
    'mistral-medium': {
        input: 0.4,
        output: 2,
        cacheRead: 0.4,
        cacheWrite: 0.4,
    },
    'mistral-small': {
        input: 0.2,
        output: 0.6,
        cacheRead: 0.2,
        cacheWrite: 0.2,
    },
    codestral: { input: 0.3, output: 0.9, cacheRead: 0.3, cacheWrite: 0.3 },
    'mixtral-8x22b': {
        input: 0.9,
        output: 0.9,
        cacheRead: 0.9,
        cacheWrite: 0.9,
    },
    'mixtral-8x7b': {
        input: 0.24,
        output: 0.24,
        cacheRead: 0.24,
        cacheWrite: 0.24,
    },
    mixtral: { input: 0.24, output: 0.24, cacheRead: 0.24, cacheWrite: 0.24 },
    magistral: { input: 0.5, output: 1.5, cacheRead: 0.5, cacheWrite: 0.5 },
    devstral: { input: 0.1, output: 0.3, cacheRead: 0.1, cacheWrite: 0.1 },
    ministral: { input: 0.1, output: 0.1, cacheRead: 0.1, cacheWrite: 0.1 },
    pixtral: { input: 0.15, output: 0.15, cacheRead: 0.15, cacheWrite: 0.15 },
    mistral: { input: 0.2, output: 0.6, cacheRead: 0.2, cacheWrite: 0.2 },
    // Moonshot Kimi
    'kimi-k2': { input: 0.55, output: 2.2, cacheRead: 0.15, cacheWrite: 0.55 },
    kimi: { input: 0.55, output: 2.2, cacheRead: 0.15, cacheWrite: 0.55 },
    // Zhipu GLM
    'glm-4.6': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    'glm-4.5-air': {
        input: 0.2,
        output: 1.1,
        cacheRead: 0.03,
        cacheWrite: 0.2,
    },
    'glm-4.5': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    'glm-4': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    glm: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    // Google Gemma
    'gemma-3': { input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1 },
    'gemma-2': { input: 0.27, output: 0.27, cacheRead: 0.27, cacheWrite: 0.27 },
    gemma: { input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1 },
    // MiniMax
    'minimax-m2': { input: 0.3, output: 1.2, cacheRead: 0.3, cacheWrite: 0.3 },
    'minimax-m1': {
        input: 0.55,
        output: 2.2,
        cacheRead: 0.55,
        cacheWrite: 0.55,
    },
    minimax: { input: 0.3, output: 1.2, cacheRead: 0.3, cacheWrite: 0.3 },
};

// Conservative fallback so unknown models still contribute a plausible estimate.
const FALLBACK: ModelPrice = {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
};

export type ListedPrice = ModelPrice & { id: string };

/** Sorted reference price rows for the public pricing page (USD per 1M tokens). */
export function listPrices(): ListedPrice[] {
    return Object.entries(PRICES)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, price]) => ({ id, ...price }));
}

/**
 * Normalize a raw model id before price matching, mirroring CodexBar's
 * normalizeCodexModel/normalizeClaudeModel: strip provider prefixes
 * (`openai/`, `anthropic.`, Bedrock region prefixes like `us.anthropic.`),
 * Bedrock `-vN:M` version suffixes, and trailing `-YYYY-MM-DD`/`-YYYYMMDD`
 * date suffixes. Longest-substring matching still runs afterwards, so ids
 * this doesn't recognize behave exactly as before.
 */
function normalizeModelId(model: string): string {
    let m = model.trim().toLowerCase();
    if (m.startsWith('openai/')) m = m.slice('openai/'.length);
    if (m.startsWith('anthropic.')) m = m.slice('anthropic.'.length);
    // Bedrock region prefixes (`us.anthropic.claude-...`): keep the tail after
    // the last dot when the tail is itself a claude model id.
    const lastDot = m.lastIndexOf('.');
    if (lastDot !== -1 && m.includes('claude-')) {
        const tail = m.slice(lastDot + 1);
        if (tail.startsWith('claude-')) m = tail;
    }
    m = m.replace(/-v\d+:\d+$/u, '');
    m = m.replace(/-\d{4}-\d{2}-\d{2}$/u, '');
    m = m.replace(/-\d{8}$/u, '');
    // OpenAI routes the unsuffixed gpt-5.6 alias to Sol.
    if (m === 'gpt-5.6') m = 'gpt-5.6-sol';
    return m;
}

export function priceFor(model: string): ModelPrice {
    const m = normalizeModelId(model);
    let best: ModelPrice | null = null;
    let bestLen = 0;
    for (const key in PRICES) {
        if (m.includes(key) && key.length > bestLen) {
            best = PRICES[key] ?? null;
            bestLen = key.length;
        }
    }
    return best ?? FALLBACK;
}

export interface TokenCounts {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
}

// Sources whose `input_tokens` already include the cache reads/writes
// (Codex `last_token_usage` and pi report cumulative input): billing them
// additively would double-charge, so cache tokens are carved out of input.
const INPUT_INCLUDES_CACHE = new Set(['codex', 'pi']);

/**
 * Estimated USD cost for one model's token counts. For sources where input
 * is a superset of the cache buckets, cached reads (clamped to input) and
 * cache writes (clamped to the remainder) are priced at their own rates and
 * only the rest at the input rate; other sources report distinct buckets
 * and are priced additively.
 */
export function estimateCost(
    model: string,
    t: TokenCounts,
    source?: string,
): number {
    const p = priceFor(model);
    if (source !== undefined && INPUT_INCLUDES_CACHE.has(source)) {
        const cached = Math.min(t.cache_read_tokens, t.input_tokens);
        const cacheWrite = Math.min(
            t.cache_creation_tokens,
            t.input_tokens - cached,
        );
        const nonCached = t.input_tokens - cached - cacheWrite;
        return (
            (nonCached * p.input +
                cached * p.cacheRead +
                cacheWrite * p.cacheWrite +
                t.output_tokens * p.output) /
            1_000_000
        );
    }
    return (
        (t.input_tokens * p.input +
            t.output_tokens * p.output +
            t.cache_read_tokens * p.cacheRead +
            t.cache_creation_tokens * p.cacheWrite) /
        1_000_000
    );
}
