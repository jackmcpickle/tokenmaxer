import { describe, expect, it } from 'vitest';
import { stubKv } from '@/__tests__/helpers/kv';
import app from '@/index';
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
        TURNSTYLE_SECRET_KEY: '',
    };
}

const browserHeaders = {
    Accept: 'text/html',
    'Sec-Fetch-Mode': 'navigate',
};

describe('hackathons about page', () => {
    it('serves about content and is linked from the header', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/hackathons',
            { headers: browserHeaders },
            env(),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Hackathons');
        expect(html).toContain('/h/new');
        expect(html).toContain('/h/mine');
        expect(html).toContain('Get started');
        expect(html).toContain('href="/hackathons"');
    });
});
