import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { getHackathonBoardPageData } from '@/core/api/board.api';
import { HackathonPage } from '@/pages/hackathon';
import { Layout } from '@/pages/layout';
import { sub } from '@/pages/ui';
import { isMetric, type Metric } from '@/types';

function parseSearch(search: Record<string, unknown>): { metric: Metric } {
    const raw = search.metric;
    return { metric: isMetric(raw) ? raw : 'cost' };
}

export const Route = createFileRoute('/h/$slug')({
    head: () => ({
        meta: [{ title: 'Hackathon · tokenmaxer.quest' }],
    }),
    validateSearch: parseSearch,
    loaderDeps: ({ search }) => ({ metric: search.metric }),
    loader: async ({ params, deps }) => {
        return await getHackathonBoardPageData({
            data: { slug: params.slug, metric: deps.metric },
        });
    },
    component: HackathonBoardRoute,
});

function HackathonBoardRoute(): ReactElement {
    const data = Route.useLoaderData();
    if (!data) {
        throw new Error('Hackathon loader data missing');
    }
    if (!data.hackathon || !data.state) {
        return (
            <Layout
                title="Hackathon not found · tokenmaxer.quest"
                base={data.base}
            >
                <h1>Hackathon not found</h1>
                <p className={sub}>
                    That link may be wrong or the hackathon was deleted.
                </p>
            </Layout>
        );
    }
    return (
        <HackathonPage
            base={data.base}
            hackathon={data.hackathon}
            state={data.state}
            metric={data.metric}
            entries={data.entries}
            members={data.members}
            role={data.role}
            models={data.models}
        />
    );
}
