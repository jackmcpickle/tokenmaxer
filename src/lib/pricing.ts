/**
 * Per-model pricing, USD per 1,000,000 tokens. These are ESTIMATES used only to
 * show an approximate spend on the board — update them by editing this file and
 * redeploying. Model ids are first normalized (provider prefixes and date/version
 * suffixes stripped, mirroring CodexBar's normalizeCodexModel/normalizeClaudeModel),
 * then matched by longest case-insensitive substring, so
 * `claude-opus-4-8-20260101` matches the `claude-opus-4-8` entry.
 *
 * Rates were last refreshed 2026-10-14 against each provider's public price
 * page (the source is noted on each provider block). Where a provider does not
 * publish a cache-write rate, cacheWrite mirrors the input rate.
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
    // Anthropic — Claude (platform.claude.com/docs/en/about-claude/pricing;
    // cacheWrite is the 5m cache-write rate, 1.25x input). Cache reads are
    // 0.025x input on Fable/Mythos 5.1, 0.05x on Opus/Sonnet 5.5, 0.1x elsewhere.
    'claude-fable-5-1': {
        input: 10,
        output: 50,
        cacheRead: 0.25,
        cacheWrite: 12.5,
    },
    'claude-mythos-5-1': {
        input: 10,
        output: 50,
        cacheRead: 0.25,
        cacheWrite: 12.5,
    },
    'claude-fable-5': {
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    },
    'claude-mythos-5': {
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    },
    'claude-fable': {
        input: 10,
        output: 50,
        cacheRead: 0.25,
        cacheWrite: 12.5,
    },
    // Fast mode (`speed: "fast"`, first-party API only) is a 2x premium on
    // Opus 5.5 / Opus 5 / Opus 4.8; cache multipliers stack on top.
    'claude-opus-5-5-fast': {
        input: 8,
        output: 40,
        cacheRead: 0.4,
        cacheWrite: 10,
    },
    'claude-opus-5-fast': {
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    },
    'claude-opus-4-8-fast': {
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    },
    'claude-opus-5-5': {
        input: 4,
        output: 20,
        cacheRead: 0.2,
        cacheWrite: 5,
    },
    'claude-opus-5': {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
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
    'claude-opus-4-1': {
        input: 15,
        output: 75,
        cacheRead: 1.5,
        cacheWrite: 18.75,
    },
    'claude-opus-4': {
        input: 15,
        output: 75,
        cacheRead: 1.5,
        cacheWrite: 18.75,
    },
    'claude-sonnet-5-5': {
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: 2.5,
    },
    // Sonnet 5's $2/$10 launch pricing was made permanent (Anthropic footnote).
    'claude-sonnet-5': {
        input: 2,
        output: 10,
        cacheRead: 0.2,
        cacheWrite: 2.5,
    },
    'claude-sonnet-4-6': {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    },
    'claude-sonnet-4-5': {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    },
    'claude-sonnet-4': {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    },
    // Haiku 5.5 is tiered: prompts over 100K tokens bill at 5x these rates.
    'claude-haiku-5-5': {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
    },
    'claude-haiku-4-5': {
        input: 1,
        output: 5,
        cacheRead: 0.1,
        cacheWrite: 1.25,
    },
    'claude-haiku-4': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    'claude-haiku': {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
    },
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
    // OpenAI — GPT / Codex (developers.openai.com/api/docs/pricing, Standard
    // tier, <=272K context). OpenAI bills cache writes at the uncached input
    // rate unless a cache-write column is published, so input is mirrored.
    // Retired Codex ids (gpt-5-codex, gpt-5.1-codex*, gpt-5.2-codex,
    // gpt-5.3-codex-spark) are no longer on the price page; their last CodexBar
    // rates are kept.
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
    // GPT-5.6 / GPT-6 Sol/Terra/Luna/Astra carry explicit cache-write rates
    // (1.25x input). The unsuffixed `gpt-5.6` / `gpt-6` keys are family
    // fallbacks priced at Sol.
    'gpt-5.6-sol': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
    'gpt-5.6-terra': {
        input: 2,
        output: 12,
        cacheRead: 0.2,
        cacheWrite: 2.5,
    },
    'gpt-5.6-luna': {
        input: 0.2,
        output: 1.2,
        cacheRead: 0.02,
        cacheWrite: 0.25,
    },
    'gpt-5.6': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
    'gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    'gpt-6.1-sol': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    'gpt-6-sol': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'gpt-6-luna': {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
    },
    'gpt-6': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 },
    o3: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },

    // xAI — Grok (docs.x.ai/docs/models, <200K prompt tier; requests at or
    // over 200K bill 2x). The "-fast" keys are Cursor's Fast tier for the same
    // models (cursor.com/docs/models). xAI publishes no cache-write rate.
    'grok-4.7-fast': { input: 4, output: 12, cacheRead: 1, cacheWrite: 4 },
    'grok-4.7': { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2 },
    'grok-4.6-fast': { input: 4, output: 12, cacheRead: 1, cacheWrite: 4 },
    'grok-4.6': { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2 },
    'grok-4.5-fast': { input: 4, output: 18, cacheRead: 1, cacheWrite: 4 },
    'grok-4.5': { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 2 },
    'grok-4.3': { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 1.25 },
    'grok-4.20': { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 1.25 },
    // grok-code-fast-1 now redirects to grok-build-0.1 on docs.x.ai.
    'grok-build': { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 1 },
    'grok-code-fast': { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 1 },
    // Retired and no longer on xAI's price page; last published list price
    // (per third-party trackers), kept so old sessions aren't 10x overcharged.
    'grok-4.1-fast': {
        input: 0.2,
        output: 0.5,
        cacheRead: 0.05,
        cacheWrite: 0.2,
    },
    'grok-4-fast': {
        input: 0.2,
        output: 0.5,
        cacheRead: 0.05,
        cacheWrite: 0.2,
    },
    'grok-4': { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2 },
    grok: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2 },

    // Cursor — Composer (cursor.com/docs/models). Composer 2 rates are the
    // launch rates reported from Cursor's docs by third parties; Cursor does
    // not publish a cache-write rate. The exact id of the Fast variants is
    // unconfirmed. grok-bot-* ids have no published rate and use FALLBACK.
    'composer-2.5-fast': {
        input: 3,
        output: 15,
        cacheRead: 0.5,
        cacheWrite: 3,
    },
    'composer-2.5': {
        input: 0.5,
        output: 2.5,
        cacheRead: 0.2,
        cacheWrite: 0.5,
    },
    'composer-2-fast': {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.35,
        cacheWrite: 1.5,
    },
    'composer-2': { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0.5 },
    composer: { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0.5 },

    // Meta — Muse (dev.meta.ai/docs/pricing-rate-limits; Standard mode).
    // Glimmer is open-weight with no Meta list price; OpenRouter rate used.
    'muse-wonder': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 4 },
    'muse-spark-1.3-contributor': {
        input: 0.1,
        output: 0.2,
        cacheRead: 0.002,
        cacheWrite: 0.1,
    },
    'muse-spark-1.2-contributor': {
        input: 0.1,
        output: 0.2,
        cacheRead: 0.002,
        cacheWrite: 0.1,
    },
    'muse-spark': {
        input: 1.25,
        output: 4.25,
        cacheRead: 0.15,
        cacheWrite: 1.25,
    },
    'muse-glimmer': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.04,
        cacheWrite: 0.3,
    },
    muse: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 1.25 },

    // Google — Gemini (ai.google.dev/gemini-api/docs/pricing, paid tier,
    // <=200K prompts). Google prices cache storage per hour rather than a
    // per-token write, so cacheWrite mirrors input. Gemini 4 Argon doubles on
    // 2026-12-01 and the 3.6/3.8 Flash rates double on 2027-01-01. Retired
    // ids (gemini-3-pro, 3.5-flash, 3.7-flash) are priced at the model Google
    // now routes them to.
    'gemini-4-argon': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2 },
    'gemini-3.8-flash': {
        input: 0.75,
        output: 3.75,
        cacheRead: 0.075,
        cacheWrite: 0.75,
    },
    'gemini-3.7-flash': {
        input: 0.75,
        output: 3.75,
        cacheRead: 0.075,
        cacheWrite: 0.75,
    },
    'gemini-3.6-flash': {
        input: 0.75,
        output: 3.75,
        cacheRead: 0.075,
        cacheWrite: 0.75,
    },
    'gemini-3.5-flash-lite': {
        input: 0.3,
        output: 2.5,
        cacheRead: 0.03,
        cacheWrite: 0.3,
    },
    'gemini-3.5-flash': {
        input: 0.75,
        output: 3.75,
        cacheRead: 0.075,
        cacheWrite: 0.75,
    },
    'gemini-3.1-pro': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2 },
    'gemini-3.1-flash-lite': {
        input: 0.25,
        output: 1.5,
        cacheRead: 0.025,
        cacheWrite: 0.25,
    },
    'gemini-3-pro': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2 },
    'gemini-3-flash': {
        input: 0.5,
        output: 3,
        cacheRead: 0.05,
        cacheWrite: 0.5,
    },
    'gemini-2.5-pro': {
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: 1.25,
    },
    'gemini-2.5-flash-lite': {
        input: 0.1,
        output: 0.4,
        cacheRead: 0.01,
        cacheWrite: 0.1,
    },
    'gemini-2.5-flash': {
        input: 0.3,
        output: 2.5,
        cacheRead: 0.03,
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
    gemini: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 },

    // ---- Open-weight models via OpenRouter (rough per-1M estimates) ----
    // DeepSeek (api-docs.deepseek.com/quick_start/pricing, peak rates;
    // off-peak is 50% off). deepseek-v4-flash is a legacy alias served as
    // V4.1-Flash. R1 / V3 / deepseek-chat are no longer on DeepSeek's page.
    'deepseek-v4-pro': {
        input: 1.32,
        output: 3.96,
        cacheRead: 0.044,
        cacheWrite: 1.32,
    },
    'deepseek-v4.1-flash': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.006,
        cacheWrite: 0.3,
    },
    'deepseek-v4-flash': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.006,
        cacheWrite: 0.3,
    },
    'deepseek-flash': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.006,
        cacheWrite: 0.3,
    },
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
    deepseek: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 },
    // Qwen (Alibaba does not publish a public USD price table; rates are the
    // Alibaba-hosted listings from the OpenRouter catalog, openrouter.ai/qwen)
    'qwen3.8-max-prime': {
        input: 4,
        output: 12,
        cacheRead: 0.5,
        cacheWrite: 4,
    },
    'qwen3.8-max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2 },
    'qwen3.8-flash': {
        input: 0.15,
        output: 0.47,
        cacheRead: 0.016,
        cacheWrite: 0.15,
    },
    'qwen3.7-max': {
        input: 1.475,
        output: 4.425,
        cacheRead: 0.295,
        cacheWrite: 1.84375,
    },
    'qwen3.7-plus': {
        input: 0.32,
        output: 1.28,
        cacheRead: 0.064,
        cacheWrite: 0.4,
    },
    'qwen3.7-flash': {
        input: 0.03,
        output: 0.13,
        cacheRead: 0.006,
        cacheWrite: 0.038,
    },
    'qwen3.6-plus': {
        input: 0.325,
        output: 1.95,
        cacheRead: 0.325,
        cacheWrite: 0.40625,
    },
    'qwen3.6-flash': {
        input: 0.1875,
        output: 1.125,
        cacheRead: 0.1875,
        cacheWrite: 0.234375,
    },
    'qwen3.5-plus': {
        input: 0.3,
        output: 1.8,
        cacheRead: 0.3,
        cacheWrite: 0.375,
    },
    'qwen3.5-flash': {
        input: 0.065,
        output: 0.26,
        cacheRead: 0.065,
        cacheWrite: 0.065,
    },
    'qwen3-coder-flash': {
        input: 0.195,
        output: 0.975,
        cacheRead: 0.039,
        cacheWrite: 0.24375,
    },
    'qwen3-coder-next': {
        input: 0.12,
        output: 0.8,
        cacheRead: 0.07,
        cacheWrite: 0.12,
    },
    'qwen3-coder': { input: 0.3, output: 1, cacheRead: 0.1, cacheWrite: 0.3 },
    'qwen-3-coder': {
        input: 0.3,
        output: 1,
        cacheRead: 0.1,
        cacheWrite: 0.3,
    },
    'qwen-plus': {
        input: 0.26,
        output: 0.78,
        cacheRead: 0.052,
        cacheWrite: 0.325,
    },
    'qwen-2.5-coder': {
        input: 0.66,
        output: 1,
        cacheRead: 0.66,
        cacheWrite: 0.66,
    },
    'qwen-2.5': { input: 0.36, output: 0.4, cacheRead: 0.36, cacheWrite: 0.36 },
    qwen3: { input: 0.2, output: 0.85, cacheRead: 0.2, cacheWrite: 0.2 },
    qwq: { input: 0.15, output: 0.45, cacheRead: 0.15, cacheWrite: 0.15 },
    qwen: { input: 0.32, output: 1.28, cacheRead: 0.064, cacheWrite: 0.4 },
    // Meta Llama (Meta sells no first-party Llama API; rates are the OpenRouter
    // catalog listings, openrouter.ai/meta-llama)
    'llama-4-maverick': {
        input: 0.1875,
        output: 0.6525,
        cacheRead: 0.05,
        cacheWrite: 0.1875,
    },
    'llama-4-scout': {
        input: 0.18,
        output: 0.59,
        cacheRead: 0.18,
        cacheWrite: 0.18,
    },
    'llama-3.3': {
        input: 0.59,
        output: 0.79,
        cacheRead: 0.295,
        cacheWrite: 0.59,
    },
    'llama-3.1-405b': {
        input: 0.8,
        output: 0.8,
        cacheRead: 0.8,
        cacheWrite: 0.8,
    },
    'llama-3.1-8b': {
        input: 0.05,
        output: 0.08,
        cacheRead: 0.025,
        cacheWrite: 0.05,
    },
    'llama-3.1': { input: 0.4, output: 0.4, cacheRead: 0.4, cacheWrite: 0.4 },
    'llama-3': { input: 0.13, output: 0.39, cacheRead: 0.13, cacheWrite: 0.13 },
    llama: {
        input: 0.1875,
        output: 0.6525,
        cacheRead: 0.05,
        cacheWrite: 0.1875,
    },
    // Mistral (docs.mistral.ai/inference/pricing; cached input is 0.1x input,
    // no cache-write rate). Large 4 is shown at a 50% sale ($1.36/$4.18 list).
    // Devstral uses the OpenRouter rate; Magistral/Pixtral/Mixtral are no
    // longer on Mistral's price page and keep their previous estimates.
    'mistral-large-4': {
        input: 0.68,
        output: 2.09,
        cacheRead: 0.07,
        cacheWrite: 0.68,
    },
    'mistral-large-3': {
        input: 0.5,
        output: 1.5,
        cacheRead: 0.05,
        cacheWrite: 0.5,
    },
    'mistral-large-2512': {
        input: 0.5,
        output: 1.5,
        cacheRead: 0.05,
        cacheWrite: 0.5,
    },
    'mistral-large': {
        input: 0.68,
        output: 2.09,
        cacheRead: 0.07,
        cacheWrite: 0.68,
    },
    'mistral-medium-3.5': {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.15,
        cacheWrite: 1.5,
    },
    'mistral-medium-3-5': {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.15,
        cacheWrite: 1.5,
    },
    'mistral-medium': {
        input: 0.4,
        output: 2,
        cacheRead: 0.04,
        cacheWrite: 0.4,
    },
    'mistral-small': {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.015,
        cacheWrite: 0.15,
    },
    codestral: { input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0.3 },
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
    devstral: { input: 0.4, output: 2, cacheRead: 0.04, cacheWrite: 0.4 },
    'ministral-3-14b': {
        input: 0.2,
        output: 0.2,
        cacheRead: 0.02,
        cacheWrite: 0.2,
    },
    'ministral-14b': {
        input: 0.2,
        output: 0.2,
        cacheRead: 0.02,
        cacheWrite: 0.2,
    },
    'ministral-3-8b': {
        input: 0.15,
        output: 0.15,
        cacheRead: 0.015,
        cacheWrite: 0.15,
    },
    'ministral-8b': {
        input: 0.15,
        output: 0.15,
        cacheRead: 0.015,
        cacheWrite: 0.15,
    },
    ministral: { input: 0.1, output: 0.1, cacheRead: 0.01, cacheWrite: 0.1 },
    pixtral: { input: 0.15, output: 0.15, cacheRead: 0.15, cacheWrite: 0.15 },
    mistral: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
    // Moonshot Kimi (platform.kimi.ai/docs/pricing/chat). K3 publishes a 5m
    // cache-write rate ($3); others mirror input. K2.5 is off Moonshot's page
    // and uses the OpenRouter rate; K2 keeps its previous estimate.
    'kimi-k3': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
    'kimi-k2.7-code-highspeed': {
        input: 1.9,
        output: 8,
        cacheRead: 0.38,
        cacheWrite: 1.9,
    },
    'kimi-k2.7': { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0.95 },
    'kimi-k2.6': { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0.95 },
    'kimi-k2.5': { input: 0.5, output: 2.5, cacheRead: 0.15, cacheWrite: 0.5 },
    'kimi-k2': { input: 0.55, output: 2.2, cacheRead: 0.15, cacheWrite: 0.55 },
    kimi: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
    // Zhipu GLM (docs.z.ai/guides/overview/pricing; no cache-write rate)
    'glm-5.3-flashx': {
        input: 0.37,
        output: 1.25,
        cacheRead: 0.075,
        cacheWrite: 0.37,
    },
    'glm-5.3-flash': {
        input: 0.15,
        output: 0.5,
        cacheRead: 0.03,
        cacheWrite: 0.15,
    },
    'glm-5.3': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
    'glm-5.2': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
    'glm-5.1': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
    'glm-5': { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 1 },
    'glm-4.7-flashx': {
        input: 0.07,
        output: 0.4,
        cacheRead: 0.01,
        cacheWrite: 0.07,
    },
    'glm-4.7-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    'glm-4.7': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    'glm-4.6v': { input: 0.3, output: 0.9, cacheRead: 0.05, cacheWrite: 0.3 },
    'glm-4.6': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    'glm-4.5-airx': {
        input: 1.1,
        output: 4.5,
        cacheRead: 0.22,
        cacheWrite: 1.1,
    },
    'glm-4.5-air': {
        input: 0.2,
        output: 1.1,
        cacheRead: 0.03,
        cacheWrite: 0.2,
    },
    'glm-4.5-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    'glm-4.5-x': { input: 2.2, output: 8.9, cacheRead: 0.45, cacheWrite: 2.2 },
    'glm-4.5': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    'glm-4': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.6 },
    glm: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
    // Google Gemma (open-weight; Google's own page lists no paid rate, so
    // these are the OpenRouter catalog listings for the 31B/27B variants)
    'gemma-4': { input: 0.09, output: 0.34, cacheRead: 0.05, cacheWrite: 0.09 },
    'gemma-3': { input: 0.08, output: 0.45, cacheRead: 0.04, cacheWrite: 0.08 },
    'gemma-2': { input: 0.27, output: 0.27, cacheRead: 0.27, cacheWrite: 0.27 },
    gemma: { input: 0.09, output: 0.34, cacheRead: 0.05, cacheWrite: 0.09 },
    // MiniMax (platform.minimax.io/docs/guides/pricing-paygo, Standard tier,
    // <=512K input for M3; M3 publishes no cache-write rate)
    'minimax-m3': { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.3 },
    'minimax-m2.7-highspeed': {
        input: 0.6,
        output: 2.4,
        cacheRead: 0.06,
        cacheWrite: 0.375,
    },
    'minimax-m2.7': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.06,
        cacheWrite: 0.375,
    },
    'minimax-m2.5-highspeed': {
        input: 0.6,
        output: 2.4,
        cacheRead: 0.03,
        cacheWrite: 0.375,
    },
    'minimax-m2.5': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.03,
        cacheWrite: 0.375,
    },
    'minimax-m2.1-highspeed': {
        input: 0.6,
        output: 2.4,
        cacheRead: 0.03,
        cacheWrite: 0.375,
    },
    'minimax-m2.1': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.03,
        cacheWrite: 0.375,
    },
    'minimax-m2': {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.03,
        cacheWrite: 0.375,
    },
    'minimax-m1': {
        input: 0.55,
        output: 2.2,
        cacheRead: 0.55,
        cacheWrite: 0.55,
    },
    minimax: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.3 },
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
