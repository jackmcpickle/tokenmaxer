import { createFileRoute } from '@tanstack/react-router';
import { getBaseUrl } from '@/core/api/site.api';
import { HackathonsAbout } from '@/pages/hackathons';

export const Route = createFileRoute('/hackathons')({
    head: () => ({
        meta: [{ title: 'Hackathons · tokenmaxer.quest' }],
    }),
    loader: () => getBaseUrl(),
    component: HackathonsPage,
});

function HackathonsPage() {
    const base = Route.useLoaderData();
    return <HackathonsAbout base={base} />;
}
