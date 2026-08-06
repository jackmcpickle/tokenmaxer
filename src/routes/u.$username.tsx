import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { getProfilePageData } from '@/core/api/board.api';
import { Layout } from '@/pages/layout';
import { ProfilePage } from '@/pages/profile';
import { sub } from '@/pages/ui';

export const Route = createFileRoute('/u/$username')({
    head: () => ({
        meta: [{ title: 'Profile · tokenmaxer.quest' }],
    }),
    loader: async ({ params }) => {
        return await getProfilePageData({
            data: { username: params.username },
        });
    },
    component: ProfileRoute,
});

function ProfileRoute(): ReactElement {
    const data = Route.useLoaderData();
    if (!data) {
        throw new Error('Profile loader data missing');
    }
    if (!data.profile) {
        return (
            <Layout
                title="Not found · tokenmaxer.quest"
                base={data.base}
            >
                <h1>Builder not found</h1>
                <p className={sub}>
                    No one has claimed that username yet.{' '}
                    <a href="/start">Claim it →</a>
                </p>
            </Layout>
        );
    }
    return (
        <ProfilePage
            base={data.base}
            profile={data.profile}
        />
    );
}
