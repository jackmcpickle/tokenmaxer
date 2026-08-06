import { createFileRoute } from '@tanstack/react-router';
import { getBaseUrl } from '@/core/api/site.api';
import { Pricing } from '@/pages/pricing';

export const Route = createFileRoute('/pricing')({
    head: () => ({
        meta: [{ title: 'Pricing · tokenmaxer.quest' }],
    }),
    loader: () => getBaseUrl(),
    component: PricingPage,
});

function PricingPage() {
    const base = Route.useLoaderData();
    return <Pricing base={base} />;
}
