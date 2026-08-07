import { createFileRoute, useRouterState } from '@tanstack/react-router';
import {
    parseCountryParam,
    parseMetric,
    parseSourceParam,
    parseWindow,
} from '@/api/leaderboard';
import { getLeaderboardPageData } from '@/core/api/board.api';
import { getBaseUrl } from '@/core/api/site.api';
import { Home } from '@/pages/home';
import type { Metric, Source, TimeWindow } from '@/types';

interface HomeSearch {
    window?: TimeWindow;
    metric?: Metric;
    source?: Source;
    model?: string;
    country?: string;
}

function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
    const out: HomeSearch = {};
    if (typeof search.window === 'string' && search.window.length > 0) {
        out.window = parseWindow(search.window);
    }
    if (typeof search.metric === 'string' && search.metric.length > 0) {
        out.metric = parseMetric(search.metric);
    }
    if (typeof search.source === 'string' && search.source.length > 0) {
        const source = parseSourceParam(search.source);
        if (source) out.source = source;
    }
    if (typeof search.model === 'string' && search.model.length > 0) {
        out.model = search.model;
    }
    if (typeof search.country === 'string' && search.country.length > 0) {
        const country = parseCountryParam(search.country);
        if (country) out.country = country;
    }
    return out;
}

export const Route = createFileRoute('/')({
    head: () => ({
        meta: [
            {
                title: 'tokenmaxer.quest — token leaderboard for AI builders',
            },
        ],
    }),
    validateSearch: parseHomeSearch,
    loaderDeps: ({ search }) => search,
    loader: async ({ deps }) => {
        const filters = {
            window: parseWindow(deps.window),
            metric: parseMetric(deps.metric),
            source: deps.source,
            model: deps.model,
            country: deps.country,
        };
        const [base, board] = await Promise.all([
            getBaseUrl(),
            getLeaderboardPageData({ data: filters }),
        ]);
        return { base, ...board, ...filters };
    },
    component: HomePage,
});

function HomePage() {
    const data = Route.useLoaderData();
    const pending = useRouterState({
        select: (s) => s.isLoading || s.status === 'pending',
    });
    return (
        <Home
            base={data.base}
            entries={data.entries}
            models={data.models}
            countries={data.countries}
            window={data.window}
            metric={data.metric}
            source={data.source}
            model={data.model}
            country={data.country}
            spa
            pending={pending}
        />
    );
}
