import { describe, expect, it } from 'vitest';
import { estimateCost, listPrices, priceFor } from '@/lib/pricing';

describe('priceFor', () => {
    it('matches the longest substring for versioned model ids', () => {
        expect(priceFor('claude-opus-4-8-20260101').output).toBe(25);
        expect(priceFor('claude-sonnet-5-20260101').output).toBe(10);
        expect(priceFor('gpt-5-codex').input).toBe(1.25);
    });

    it('prefers the most specific key when a family fallback also matches', () => {
        // grok-4.7 > grok-4 > grok; the Cursor Fast tier is longer still.
        expect(priceFor('grok-4.7').cacheRead).toBe(0.5);
        expect(priceFor('cursor-grok-4.6-high-fast')).toEqual(
            priceFor('grok-4.6'),
        );
        expect(priceFor('grok-4.7-fast').output).toBe(12);
        expect(priceFor('grok-4.1-fast-reasoning').input).toBe(0.2);
        expect(priceFor('grok-code-fast-1')).toEqual(
            priceFor('grok-build-0.1'),
        );
        // muse-spark-1.3-contributor must not fall through to muse-spark.
        expect(priceFor('muse-spark-1.3-contributor').input).toBe(0.1);
        expect(priceFor('muse-spark-1.3').output).toBe(4.25);
        expect(priceFor('muse-wonder-1.0').output).toBe(20);
        expect(priceFor('composer-2.5-fast').output).toBe(15);
        expect(priceFor('composer-2.5').output).toBe(2.5);
        expect(priceFor('glm-5.3-flashx').input).toBe(0.37);
        expect(priceFor('deepseek-v4-pro').output).toBe(3.96);
        expect(priceFor('kimi-k3').cacheWrite).toBe(3);
        expect(priceFor('gemini-4-argon').output).toBe(10);
    });

    it('prices the gpt-5.x family from the CodexBar tables', () => {
        expect(priceFor('gpt-5.4')).toEqual({
            input: 2.5,
            output: 15,
            cacheRead: 0.25,
            cacheWrite: 2.5,
        });
        expect(priceFor('gpt-5.4-mini').input).toBe(0.75);
        expect(priceFor('gpt-5.5').output).toBe(30);
        expect(priceFor('gpt-5.5-pro').output).toBe(180);
        expect(priceFor('gpt-5.6-sol')).toEqual({
            input: 4,
            output: 20,
            cacheRead: 0.4,
            cacheWrite: 5,
        });
        expect(priceFor('gpt-5.6-terra').cacheWrite).toBe(2.5);
        expect(priceFor('gpt-5.6-luna').input).toBe(0.2);
        expect(priceFor('gpt-6-astra').output).toBe(50);
        expect(priceFor('gpt-6.1-sol').cacheRead).toBe(0.1);
        expect(priceFor('gpt-6-high')).toEqual(priceFor('gpt-6-sol'));
    });

    it('prices current Claude models from the CodexBar tables', () => {
        expect(priceFor('claude-fable-5')).toEqual({
            input: 10,
            output: 50,
            cacheRead: 1,
            cacheWrite: 12.5,
        });
        expect(priceFor('claude-fable-5-1').cacheRead).toBe(0.25);
        expect(priceFor('claude-opus-5-5')).toEqual({
            input: 4,
            output: 20,
            cacheRead: 0.2,
            cacheWrite: 5,
        });
        expect(priceFor('claude-opus-5-5-fast').input).toBe(8);
        expect(priceFor('claude-sonnet-5-5').cacheRead).toBe(0.1);
        expect(priceFor('claude-haiku-5-5').output).toBe(0.5);
        expect(priceFor('claude-opus-4-8').input).toBe(5);
        expect(priceFor('claude-haiku-4-5').input).toBe(1);
        // Older opus generations keep their original rates.
        expect(priceFor('claude-opus-4-20250514').output).toBe(75);
    });

    it('normalizes provider prefixes and date/version suffixes', () => {
        // OpenAI provider prefix + dashed date suffix.
        expect(priceFor('openai/gpt-5.6-sol-2026-05-01')).toEqual(
            priceFor('gpt-5.6-sol'),
        );
        // Unsuffixed gpt-5.6 routes to Sol, like OpenAI's alias.
        expect(priceFor('gpt-5.6')).toEqual(priceFor('gpt-5.6-sol'));
        // Bedrock-style region prefix + -vN:M suffix.
        expect(priceFor('us.anthropic.claude-fable-5-v1:0')).toEqual(
            priceFor('claude-fable-5'),
        );
        expect(priceFor('anthropic.claude-opus-4-8-v1:0').output).toBe(25);
        // Compact date suffix.
        expect(priceFor('claude-haiku-4-5-20251001').input).toBe(1);
    });

    it('falls back for unknown models', () => {
        const p = priceFor('some-unknown-model');
        expect(p.input).toBeGreaterThan(0);
        expect(p.output).toBeGreaterThan(0);
    });

    it('prices open-weight models (opencode/pi) rather than falling back', () => {
        // Provider-prefixed ids (as opencode/OpenRouter emit them) still match.
        expect(priceFor('deepseek/deepseek-r1').output).toBe(2.19);
        expect(priceFor('moonshotai/kimi-k2').output).toBe(2.2);
        expect(priceFor('qwen/qwen3-coder').input).toBe(0.3);
        expect(priceFor('z-ai/glm-4.6').output).toBe(2.2);
        expect(priceFor('google/gemini-2.5-pro').output).toBe(10);
    });
});

describe('listPrices', () => {
    it('returns every priced model id sorted alphabetically', () => {
        const prices = listPrices();
        expect(prices.length).toBeGreaterThan(10);
        expect(prices.map((p) => p.id)).toEqual(
            [...prices.map((p) => p.id)].sort((a, b) => a.localeCompare(b)),
        );
        const sonnet = prices.find((p) => p.id === 'claude-sonnet-5');
        expect(sonnet).toEqual({
            id: 'claude-sonnet-5',
            input: 2,
            output: 10,
            cacheRead: 0.2,
            cacheWrite: 2.5,
        });
    });
});

describe('estimateCost', () => {
    it('computes USD from per-million pricing', () => {
        // 1M output tokens on opus 4.8 @ $25/M = $25
        const cost = estimateCost('claude-opus-4-8', {
            input_tokens: 0,
            output_tokens: 1_000_000,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
        });
        expect(cost).toBeCloseTo(25, 5);
    });

    it('adds all categories', () => {
        const cost = estimateCost('claude-sonnet-5', {
            input_tokens: 1_000_000, // $2
            output_tokens: 1_000_000, // $10
            cache_read_tokens: 1_000_000, // $0.20
            cache_creation_tokens: 1_000_000, // $2.50
        });
        expect(cost).toBeCloseTo(14.7, 4);
    });

    it('claude_code source stays additive (cache buckets are distinct)', () => {
        const t = {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 1_000_000,
            cache_creation_tokens: 1_000_000,
        };
        expect(estimateCost('claude-sonnet-5', t, 'claude_code')).toBeCloseTo(
            estimateCost('claude-sonnet-5', t),
            8,
        );
    });

    it('codex source treats cached tokens as a subset of input', () => {
        // gpt-5: input $1.25/M, cacheRead $0.125/M, output $10/M.
        // input 1M includes 400k cached: 600k @ 1.25 + 400k @ 0.125 + 1M out.
        const cost = estimateCost(
            'gpt-5',
            {
                input_tokens: 1_000_000,
                output_tokens: 1_000_000,
                cache_read_tokens: 400_000,
                cache_creation_tokens: 0,
            },
            'codex',
        );
        expect(cost).toBeCloseTo(0.6 * 1.25 + 0.4 * 0.125 + 10, 6);
    });

    it('codex source clamps cached tokens to the input total', () => {
        // cached > input can only be bad data; never bill negative input.
        const cost = estimateCost(
            'gpt-5',
            {
                input_tokens: 100_000,
                output_tokens: 0,
                cache_read_tokens: 500_000,
                cache_creation_tokens: 0,
            },
            'codex',
        );
        expect(cost).toBeCloseTo(0.1 * 0.125, 6);
    });

    it('codex source clamps cache writes to the non-cached remainder', () => {
        // gpt-5 cacheWrite $1.25/M: 400k cached + 600k write fills input;
        // the extra 200k write must not be billed on top.
        const cost = estimateCost(
            'gpt-5',
            {
                input_tokens: 1_000_000,
                output_tokens: 0,
                cache_read_tokens: 400_000,
                cache_creation_tokens: 800_000,
            },
            'codex',
        );
        expect(cost).toBeCloseTo(0.4 * 0.125 + 0.6 * 1.25, 6);
    });

    it('pi source uses the same subset formula as codex', () => {
        const t = {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 1_000_000,
            cache_creation_tokens: 0,
        };
        expect(estimateCost('gpt-5', t, 'pi')).toBeCloseTo(
            estimateCost('gpt-5', t, 'codex'),
            8,
        );
    });
});
