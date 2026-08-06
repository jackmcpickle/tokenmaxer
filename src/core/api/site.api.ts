import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequest, getRequestUrl } from '@tanstack/react-start/server';
import { env } from 'cloudflare:workers';
import { baseUrl } from '@/lib/base-url';
import { INVITE_COOKIE, inviteSessionAllowed } from '@/lib/invite';
import { userFromRequest } from '@/lib/request-auth';
import type { Env, UserRow } from '@/types';

function getEnv(): Env {
    return env as unknown as Env;
}

export const getBaseUrl = createServerFn({ method: 'GET' }).handler(async () => {
    const e = getEnv();
    return baseUrl(e, getRequestUrl().toString());
});

export const getStartPageData = createServerFn({ method: 'GET' }).handler(
    async () => {
        const e = getEnv();
        const invited = await inviteSessionAllowed(
            e.INVITE_KEY,
            getCookie(INVITE_COOKIE),
        );
        return {
            base: baseUrl(e, getRequestUrl().toString()),
            invited,
        };
    },
);

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
    async (): Promise<UserRow | null> => {
        const e = getEnv();
        return userFromRequest(getRequest(), e);
    },
);
