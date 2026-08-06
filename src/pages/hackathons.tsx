import type { FC } from 'react';
import { Button } from '@/pages/components/button';
import { Layout } from '@/pages/layout';
import { hero, heroActions, sub } from '@/pages/ui';

export const HackathonsAbout: FC<{ base: string }> = ({ base }) => (
    <Layout
        title="Hackathons · tokenmaxer.quest"
        base={base}
    >
        <section className={hero}>
            <h1 className="reveal">Hackathons</h1>
            <p className={`${sub} reveal reveal-delay`}>
                Timed contests on the tokenmaxer board — create a window, invite
                builders, and rank who burned the most tokens.
            </p>
        </section>

        <div className="mx-auto max-w-[65ch]">
            <h2>What they are</h2>
            <p className="mb-6 text-muted">
                A hackathon is a scoped leaderboard for a fixed time range.
                Hosts pick start and end times (and optionally a model family),
                invite members, and everyone&apos;s reported sessions inside
                that window count toward a shared ranking — same metrics as the
                public board.
            </p>

            <h2>How they work</h2>
            <ol className="mb-6 list-decimal space-y-2 pl-5 text-muted">
                <li>
                    <strong className="text-text">Create</strong> a hackathon
                    with a name, window, and optional model filter.
                </li>
                <li>
                    <strong className="text-text">Share</strong> the join link
                    so builders can add themselves to the roster.
                </li>
                <li>
                    <strong className="text-text">Report</strong> sessions as
                    usual — the reporter posts token totals; only sessions in
                    the window and from members count.
                </li>
                <li>
                    <strong className="text-text">Rank</strong> on the hackathon
                    board by total tokens, cost, or other leaderboard metrics.
                </li>
            </ol>

            <h2>Get started</h2>
            <p className="mb-6 text-muted">
                Claim a username and sign in, create a hackathon, invite
                participants, then join one yourself if you&apos;re competing.
                Need an account first?{' '}
                <a href="/start">Claim a username on the start page</a>.
            </p>

            <div className={heroActions}>
                <Button
                    variant="primary"
                    href="/h/new"
                >
                    Create a hackathon
                </Button>
                <Button
                    variant="secondary"
                    href="/h/mine"
                >
                    My hackathons
                </Button>
                <Button
                    variant="ghost"
                    href="/start"
                >
                    Get started
                </Button>
            </div>
        </div>
    </Layout>
);
