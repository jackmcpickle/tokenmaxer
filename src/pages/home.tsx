import type { FC } from 'hono/jsx';
import type { LeaderboardEntry } from '@/lib/aggregate';
import { Button } from '@/pages/components/button';
import { WaterfallHero } from '@/pages/components/waterfall-hero';
import { Layout } from '@/pages/layout';
import {
    LeaderboardChart,
    METRIC_LABELS,
    WINDOW_LABELS,
} from '@/pages/leaderboard-chart';
import { heroActions, sub } from '@/pages/ui';
import type { Metric, Source, TimeWindow } from '@/types';

interface HomeProps {
    base: string;
    entries: LeaderboardEntry[];
    /** Bundled model family ids for the filter (e.g. `sonnet`). */
    models: string[];
    /** ISO country codes that have at least one reporting user. */
    countries: string[];
    window: TimeWindow;
    metric: Metric;
    source: Source | undefined;
    model: string | undefined;
    country: string | undefined;
}

export const Home: FC<HomeProps> = (p) => (
    <Layout
        title="tokenmaxer.quest — token leaderboard for AI builders"
        base={p.base}
        revealChrome
    >
        <WaterfallHero>
            <h1 class="reveal wm">
                token<span class="max">maxer</span>
                <span class="tld">.quest</span>
            </h1>
            <p class={`${sub} reveal reveal-delay`}>
                The token leaderboard for Claude Code, Codex, opencode &amp; pi.
                Ranked by{' '}
                <strong class="text-text">{METRIC_LABELS[p.metric]}</strong> ·{' '}
                {WINDOW_LABELS[p.window]}.
            </p>
            <div class={`${heroActions} reveal reveal-delay-2`}>
                <Button
                    variant="primary"
                    href="/start"
                >
                    Claim a username
                </Button>
            </div>
        </WaterfallHero>

        <LeaderboardChart
            entries={p.entries}
            window={p.window}
            metric={p.metric}
            source={p.source}
            model={p.model}
            country={p.country}
            models={p.models}
            countries={p.countries}
        />

        <aside class="spotlight spotlight-violet mt-4 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
                <p class="mb-2 text-[13px] font-medium tracking-[-0.13px] text-white/80">
                    Join the board
                </p>
                <p class="text-[22px] leading-snug tracking-[-0.01px] sm:text-[24px]">
                    Claim a username and start reporting sessions from Claude
                    Code, Codex, opencode or pi.
                </p>
            </div>
            <Button
                variant="primary"
                class="shrink-0"
                href="/start"
            >
                Get started
            </Button>
        </aside>
    </Layout>
);
