import { createServerFn } from '@tanstack/react-start';
import {
    getRequest,
    getRequestUrl,
    setResponseStatus,
} from '@tanstack/react-start/server';
import { env } from 'cloudflare:workers';
import { baseUrl } from '@/lib/base-url';
import {
    cachedDistinctCountries,
    cachedDistinctModelFamilies,
    cachedHackathonLeaderboard,
    cachedLeaderboard,
    cachedProfile,
} from '@/lib/cached-aggregate';
import {
    getHackathonBySlug,
    hackathonState,
    listHackathonsByHost,
    listMembers,
    memberIds,
} from '@/lib/hackathon';
import {
    estimateImpact,
    impactValue,
    type ImpactMetric,
    type ImpactRegion,
    type ImpactScenario,
} from '@/lib/impact';
import { userFromRequest } from '@/lib/request-auth';
import type { FootprintEntry } from '@/pages/footprint-chart';
import type { ViewerRole } from '@/pages/hackathon';
import type { Env, Metric, Source, TimeWindow } from '@/types';

function getEnv(): Env {
    return env as unknown as Env;
}

async function requestBase(): Promise<string> {
    const e = getEnv();
    return baseUrl(e, getRequestUrl().toString());
}

async function currentUser(): Promise<Awaited<
    ReturnType<typeof userFromRequest>
> | null> {
    const e = getEnv();
    return userFromRequest(getRequest(), e);
}

export interface LeaderboardFilters {
    window: TimeWindow;
    metric: Metric;
    source: Source | undefined;
    model: string | undefined;
    country: string | undefined;
}

export interface FootprintFilters {
    window: TimeWindow;
    metric: ImpactMetric;
    scenario: ImpactScenario;
    region: ImpactRegion;
    source: Source | undefined;
    model: string | undefined;
    country: string | undefined;
}

export const getLeaderboardPageData = createServerFn({ method: 'GET' })
    .validator((data: LeaderboardFilters) => data)
    .handler(async ({ data }) => {
        const e = getEnv();
        const now = Date.now();
        const [entries, models, countries] = await Promise.all([
            cachedLeaderboard(e.DB, e.RATE_LIMIT, { ...data, limit: 100 }, now),
            cachedDistinctModelFamilies(e.DB, e.RATE_LIMIT),
            cachedDistinctCountries(e.DB, e.RATE_LIMIT),
        ]);
        return { entries, models, countries };
    });

export const getFootprintPageData = createServerFn({ method: 'GET' })
    .validator((data: FootprintFilters) => data)
    .handler(async ({ data }) => {
        const e = getEnv();
        const now = Date.now();
        const [rawEntries, models, countries] = await Promise.all([
            cachedLeaderboard(
                e.DB,
                e.RATE_LIMIT,
                {
                    window: data.window,
                    metric: 'total',
                    source: data.source,
                    model: data.model,
                    country: data.country,
                    limit: 100,
                },
                now,
            ),
            cachedDistinctModelFamilies(e.DB, e.RATE_LIMIT),
            cachedDistinctCountries(e.DB, e.RATE_LIMIT),
        ]);

        const entries: FootprintEntry[] = rawEntries
            .map((row) => ({
                username: row.username,
                sessions: row.sessions,
                grand_total: row.grand_total,
                impact: estimateImpact(
                    row.grand_total,
                    data.scenario,
                    data.region,
                ),
            }))
            .sort(
                (a, b) =>
                    impactValue(b.impact, data.metric) -
                    impactValue(a.impact, data.metric),
            )
            .map((row, i) => ({ ...row, rank: i + 1 }));

        return { entries, models, countries };
    });

export const getProfilePageData = createServerFn({ method: 'GET' })
    .validator((data: { username: string }) => data)
    .handler(async ({ data }) => {
        const e = getEnv();
        const profile = await cachedProfile(e.DB, e.RATE_LIMIT, data.username);
        if (!profile) setResponseStatus(404);
        return {
            base: await requestBase(),
            profile,
        };
    });

export const getHackathonMinePageData = createServerFn({
    method: 'GET',
}).handler(async () => {
    const e = getEnv();
    const user = await currentUser();
    const base = await requestBase();
    if (!user) return { base, user: null, hackathons: [] };
    const hackathons = await listHackathonsByHost(e.DB, user.id);
    return { base, user, hackathons };
});

export const getHackathonNewPageData = createServerFn({
    method: 'GET',
}).handler(async () => {
    const e = getEnv();
    const user = await currentUser();
    const base = await requestBase();
    if (!user) return { base, user: null, models: [] as string[] };
    const models = await cachedDistinctModelFamilies(e.DB, e.RATE_LIMIT);
    return { base, user, models };
});

export const getHackathonBoardPageData = createServerFn({ method: 'GET' })
    .validator((data: { slug: string; metric: Metric }) => data)
    .handler(async ({ data }) => {
        const e = getEnv();
        const base = await requestBase();
        const h = await getHackathonBySlug(e.DB, data.slug);
        if (!h) {
            setResponseStatus(404);
            return {
                base,
                hackathon: null,
                state: null,
                metric: data.metric,
                entries: [],
                members: [],
                role: 'anon' as ViewerRole,
                models: [] as string[],
            };
        }

        const now = Date.now();
        const state = hackathonState(h, now);

        const [user, members, ids] = await Promise.all([
            currentUser(),
            listMembers(e.DB, h.id),
            memberIds(e.DB, h.id),
        ]);

        const entries =
            state === 'upcoming'
                ? []
                : await cachedHackathonLeaderboard(e.DB, e.RATE_LIMIT, h.slug, {
                      metric: data.metric,
                      startAt: h.start_at,
                      endAt: h.end_at,
                      memberIds: ids,
                      model: h.model_family ?? undefined,
                      limit: 100,
                  });

        let role: ViewerRole = 'anon';
        if (user) {
            if (user.id === h.host_user_id) role = 'host';
            else if (ids.includes(user.id)) role = 'member';
            else role = 'guest';
        }

        const models =
            role === 'host'
                ? await cachedDistinctModelFamilies(e.DB, e.RATE_LIMIT)
                : [];

        return {
            base,
            hackathon: h,
            state,
            metric: data.metric,
            entries,
            members,
            role,
            models,
        };
    });
