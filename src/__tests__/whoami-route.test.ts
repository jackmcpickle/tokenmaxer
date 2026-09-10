import { beforeEach, describe, expect, it } from 'vitest';
import app from '@/index';
import { hashToken } from '@/lib/auth';
import type { Env } from '@/types';

const ALICE_TOKEN = 'tt_alice_whoami';
const BOB_TOKEN = 'tt_bob_whoami';

const alice = {
    id: 'alice-id',
    username: 'alice',
    username_lower: 'alice',
    token_hash: '',
    created_at: 1,
};

const bob = {
    id: 'bob-id',
    username: 'bob',
    username_lower: 'bob',
    token_hash: '',
    created_at: 2,
};

function kv(): KVNamespace {
    return {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
        list: async () => ({
            keys: [],
            list_complete: true,
            cacheStatus: null,
        }),
        getWithMetadata: async () => ({ value: null, metadata: null }),
    } as unknown as KVNamespace;
}

function db(): D1Database {
    const users = [alice, bob];
    return {
        prepare(sql: string) {
            const self = {
                binds: [] as unknown[],
                bind(...args: unknown[]) {
                    self.binds = args;
                    return self;
                },
                async first<T>() {
                    if (sql.includes('FROM users WHERE token_hash')) {
                        const hash = self.binds[0];
                        const hit = users.find((u) => u.token_hash === hash);
                        return (hit ?? null) as T;
                    }
                    return null;
                },
                async run() {
                    return { success: true, meta: {} };
                },
                async all() {
                    return { results: [] };
                },
            };
            return self;
        },
    } as unknown as D1Database;
}

function env(): Env {
    return {
        DB: db(),
        RATE_LIMIT: kv(),
        ENVIRONMENT: 'test',
        PUBLIC_BASE_URL: 'https://tokenmaxer.quest',
        TURNSTILE_SECRET: '',
    };
}

async function whoami(token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return app.request(
        'https://tokenmaxer.quest/api/whoami',
        { method: 'GET', headers },
        env(),
    );
}

describe('GET /api/whoami', () => {
    beforeEach(async () => {
        alice.token_hash = await hashToken(ALICE_TOKEN);
        bob.token_hash = await hashToken(BOB_TOKEN);
    });

    it('rejects missing auth', async () => {
        const res = await whoami(null);
        expect(res.status).toBe(401);
    });

    it('rejects a token that matches no user', async () => {
        const res = await whoami('tt_unknown');
        expect(res.status).toBe(401);
    });

    it('returns only the authenticated username', async () => {
        const aliceRes = await whoami(ALICE_TOKEN);
        expect(aliceRes.status).toBe(200);
        expect(await aliceRes.json()).toEqual({ username: 'alice' });

        const bobRes = await whoami(BOB_TOKEN);
        expect(bobRes.status).toBe(200);
        expect(await bobRes.json()).toEqual({ username: 'bob' });
    });
});
