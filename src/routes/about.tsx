import { createFileRoute } from '@tanstack/react-router';
import { getBaseUrl } from '@/core/api/site.api';
import { About } from '@/pages/about';

export const Route = createFileRoute('/about')({
    head: () => ({
        meta: [{ title: 'About · tokenmaxer.quest' }],
    }),
    loader: () => getBaseUrl(),
    component: AboutPage,
});

function AboutPage() {
    const base = Route.useLoaderData();
    return <About base={base} />;
}
