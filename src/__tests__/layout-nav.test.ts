import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stubKv } from '@/__tests__/helpers/kv';
import app from '@/index';
import { REPO_URL } from '@/lib/site';
import type { Env } from '@/types';

function emptyDb(): D1Database {
    const empty = { results: [] as unknown[] };
    return {
        prepare() {
            return {
                bind() {
                    return this;
                },
                all: async () => empty,
                first: async () => null,
            };
        },
    } as unknown as D1Database;
}

function env(): Env {
    return {
        DB: emptyDb(),
        RATE_LIMIT: stubKv(),
        ENVIRONMENT: 'test',
        PUBLIC_BASE_URL: 'https://tokenmaxer.quest',
        TURNSTILE_SECRET: '',
    };
}

const browserHeaders = {
    Accept: 'text/html',
    'Sec-Fetch-Mode': 'navigate',
};

async function page(path: string): Promise<string> {
    const res = await app.request(
        `https://tokenmaxer.quest${path}`,
        { headers: browserHeaders },
        env(),
    );
    expect(res.status).toBe(200);
    return await res.text();
}

describe('site header GitHub link', () => {
    it('links the source repo from the navbar with an accessible label', async () => {
        const html = await page('/about');
        expect(html).toContain(`href="${REPO_URL}"`);
        expect(html).toContain('aria-label="tokenmaxer on GitHub"');
        // Cross-origin link hardening
        expect(html).toContain('rel="noopener noreferrer"');
        // Icon is decorative; the label carries the meaning
        expect(html).toContain('class="site-github__mark"');
    });

    it('is present on the reveal-chrome homepage too', async () => {
        const html = await page('/');
        expect(html).toContain(`href="${REPO_URL}"`);
        expect(html).toContain('aria-label="tokenmaxer on GitHub"');
    });
});

describe('scroll-linked chrome reveal', () => {
    it('scrubs the header with scroll instead of snapping at a threshold', async () => {
        const html = await page('/');
        // Progress is written as a custom property, not a one-shot class flip
        expect(html).toContain('--chrome-scroll');
        expect(html).toContain('REVEAL_START');
        expect(html).toContain('REVEAL_END');
        // Reveal starts early, well before a hero-height threshold
        expect(html).toMatch(/REVEAL_END\s*=\s*(\d{1,3});/u);
        // The old transition-driven snap is gone
        expect(html).not.toContain('site-chrome--instant');
    });

    it('has a noscript fallback that always shows the header', async () => {
        const html = await page('/');
        expect(html).toContain('<noscript>');
        expect(html).toContain('.site-chrome--reveal{--chrome-p:1');
    });

    // The stylesheet is inlined by the worker's Text rule, which vite does not
    // reproduce for tests — assert the source rules directly.
    it('reveals the header on keyboard focus and scrubs without a transition', () => {
        const css = readFileSync('src/styles/tailwind.css', 'utf8');
        expect(css).toContain('.site-chrome--reveal:focus-within');
        expect(css).toContain('--chrome-scroll: 0');
        expect(css).toContain('opacity: var(--chrome-p)');
        expect(css).not.toContain('translateY(-110%)');
    });
});
