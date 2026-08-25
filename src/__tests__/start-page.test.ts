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
        TURNSTILE_SECRET: '',
    };
}

const browserHeaders = {
    Accept: 'text/html',
    'Sec-Fetch-Mode': 'navigate',
};

describe('/start claim form', () => {
    it('uses a React form that cannot native-GET refresh, with named fields', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/start',
            { headers: browserHeaders },
            env(),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('id="reg"');
        expect(html).toContain('name="username"');
        expect(html).toContain('name="country"');
        expect(html).toContain('name="profile-url"');
        // method=dialog aborts navigation if submit fires before hydration.
        expect(html).toContain('method="dialog"');
        // Inline DOM listeners are wiped by TanStack hydration — do not bring them back.
        expect(html).not.toContain("addEventListener('submit'");
        expect(html).not.toContain("document.getElementById('reg')");
        expect(html).toContain('YOUR_USERNAME');
        expect(html).toContain('Claim username');
    });
});
