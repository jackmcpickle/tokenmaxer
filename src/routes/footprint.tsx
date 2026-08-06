import { createFileRoute } from '@tanstack/react-router';
import {
    parseCountryParam,
    parseSourceParam,
    parseWindow,
} from '@/api/leaderboard';
import { getFootprintPageData } from '@/core/api/board.api';
import { getBaseUrl } from '@/core/api/site.api';
import {
    parseImpactMetric,
    parseImpactRegion,
    parseImpactScenario,
    type ImpactMetric,
    type ImpactRegion,
    type ImpactScenario,
} from '@/lib/impact';
import { Footprint } from '@/pages/footprint';
import type { Source, TimeWindow } from '@/types';

interface FootprintSearch {
    window?: TimeWindow;
    metric?: ImpactMetric;
    scenario?: ImpactScenario;
    region?: ImpactRegion;
    source?: Source;
    model?: string;
    country?: string;
}

function parseFootprintSearch(
    search: Record<string, unknown>,
): FootprintSearch {
    const out: FootprintSearch = {};
    if (typeof search.window === 'string' && search.window.length > 0) {
        out.window = parseWindow(search.window);
    }
    if (typeof search.metric === 'string' && search.metric.length > 0) {
        out.metric = parseImpactMetric(search.metric);
    }
    if (typeof search.scenario === 'string' && search.scenario.length > 0) {
        out.scenario = parseImpactScenario(search.scenario);
    }
    if (typeof search.region === 'string' && search.region.length > 0) {
        out.region = parseImpactRegion(search.region);
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

export const Route = createFileRoute('/footprint')({
    head: () => ({
        meta: [{ title: 'Footprint · tokenmaxer.quest' }],
    }),
    validateSearch: parseFootprintSearch,
    loaderDeps: ({ search }) => search,
    loader: async ({ deps }) => {
        const filters = {
            window: parseWindow(deps.window),
            metric: parseImpactMetric(deps.metric),
            scenario: parseImpactScenario(deps.scenario),
            region: parseImpactRegion(deps.region),
            source: deps.source,
            model: deps.model,
            country: deps.country,
        };
        const [base, board] = await Promise.all([
            getBaseUrl(),
            getFootprintPageData({ data: filters }),
        ]);
        return { base, ...board, ...filters };
    },
    component: FootprintPage,
});

function FootprintPage() {
    const data = Route.useLoaderData();
    return (
        <Footprint
            base={data.base}
            entries={data.entries}
            models={data.models}
            countries={data.countries}
            window={data.window}
            metric={data.metric}
            scenario={data.scenario}
            region={data.region}
            source={data.source}
            model={data.model}
            country={data.country}
        />
    );
}
