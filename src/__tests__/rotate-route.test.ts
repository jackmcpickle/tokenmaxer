import { beforeEach, describe, expect, it } from 'vitest';
import app from '@/index';
import { hashToken } from '@/lib/auth';
import type { Env } from '@/types';

const ALICE_TOKEN = 'tt_alice_old';
const BOB_TOKEN = 'tt_bob_old';

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
                    if (sql.includes('UPDATE users SET token_hash')) {
                        const hash = self.binds[0] as string;
                        const id = self.binds[1] as string;
                        const user = users.find((u) => u.id === id);
                        if (user) user.token_hash = hash;
                    }
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

async function rotate(token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return app.request(
        'https://tokenmaxer.quest/api/token/rotate',
        { method: 'POST', headers },
        env(),
    );
}

describe('POST /api/token/rotate', () => {
    beforeEach(async () => {
        alice.token_hash = await hashToken(ALICE_TOKEN);
        bob.token_hash = await hashToken(BOB_TOKEN);
    });

    it('rejects missing auth', async () => {
        const res = await rotate(null);
        expect(res.status).toBe(401);
        expect(alice.token_hash).toBe(await hashToken(ALICE_TOKEN));
    });

    it('rejects a token that matches no user', async () => {
        const res = await rotate('tt_unknown');
        expect(res.status).toBe(401);
        expect(alice.token_hash).toBe(await hashToken(ALICE_TOKEN));
        expect(bob.token_hash).toBe(await hashToken(BOB_TOKEN));
    });

    it('rotates only the authenticated user', async () => {
        const res = await rotate(ALICE_TOKEN);
        expect(res.status).toBe(200);
        const json = await res.json<{ token: string }>();
        expect(json.token).toMatch(/^tt_/u);
        expect(json.token).not.toBe(ALICE_TOKEN);
        expect(alice.token_hash).toBe(await hashToken(json.token));
        expect(bob.token_hash).toBe(await hashToken(BOB_TOKEN));

        const stale = await rotate(ALICE_TOKEN);
        expect(stale.status).toBe(401);
        expect(alice.token_hash).toBe(await hashToken(json.token));
    });

    it('accepts the new token and leaves the other user alone', async () => {
        const first = await rotate(ALICE_TOKEN);
        const { token } = await first.json<{ token: string }>();

        const second = await rotate(token);
        expect(second.status).toBe(200);
        const again = await second.json<{ token: string }>();
        expect(again.token).not.toBe(token);
        expect(alice.token_hash).toBe(await hashToken(again.token));
        expect(bob.token_hash).toBe(await hashToken(BOB_TOKEN));
    });

    it('does not rotate alice when authenticating as bob', async () => {
        const res = await rotate(BOB_TOKEN);
        expect(res.status).toBe(200);
        expect(alice.token_hash).toBe(await hashToken(ALICE_TOKEN));
        expect(bob.token_hash).not.toBe(await hashToken(BOB_TOKEN));
    });

    it('rejects a non-bearer authorization header', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/api/token/rotate',
            {
                method: 'POST',
                headers: { Authorization: `Basic ${ALICE_TOKEN}` },
            },
            env(),
        );
        expect(res.status).toBe(401);
        expect(alice.token_hash).toBe(await hashToken(ALICE_TOKEN));
    });
});
