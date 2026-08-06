import { createFileRoute } from '@tanstack/react-router';
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
    window: TimeWindow;
    metric: Metric;
    source: Source | undefined;
    model: string | undefined;
    country: string | undefined;
}

function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
    const modelRaw = search.model;
    const model =
        typeof modelRaw === 'string' && modelRaw.length > 0
            ? modelRaw
            : undefined;
    return {
        window: parseWindow(
            typeof search.window === 'string' ? search.window : undefined,
        ),
        metric: parseMetric(
            typeof search.metric === 'string' ? search.metric : undefined,
        ),
        source: parseSourceParam(
            typeof search.source === 'string' ? search.source : undefined,
        ),
        model,
        country: parseCountryParam(
            typeof search.country === 'string' ? search.country : undefined,
        ),
    };
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
        const [base, board] = await Promise.all([
            getBaseUrl(),
            getLeaderboardPageData({ data: deps }),
        ]);
        return { base, ...board, ...deps };
    },
    component: HomePage,
});

function HomePage() {
    const data = Route.useLoaderData();
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
        />
    );
}
