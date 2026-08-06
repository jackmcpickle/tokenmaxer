import { createFileRoute, redirect } from '@tanstack/react-router';
import { getHackathonMinePageData } from '@/core/api/board.api';
import { HackathonMine } from '@/pages/hackathon-mine';

export const Route = createFileRoute('/h/mine')({
    head: () => ({
        meta: [{ title: 'My hackathons · tokenmaxer.quest' }],
    }),
    loader: async () => {
        const data = await getHackathonMinePageData();
        if (!data.user) {
            throw redirect({ to: '/login', search: { next: '/h/mine' } });
        }
        return {
            base: data.base,
            username: data.user.username,
            hackathons: data.hackathons,
        };
    },
    component: HackathonMinePage,
});

function HackathonMinePage() {
    const { base, username, hackathons } = Route.useLoaderData();
    return (
        <HackathonMine
            base={base}
            username={username}
            hackathons={hackathons}
        />
    );
}
