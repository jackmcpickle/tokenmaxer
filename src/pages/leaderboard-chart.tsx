import type { FC } from 'hono/jsx';
import {
    type LeaderboardEntry,
    grandTotal,
    metricValue,
} from '@/lib/aggregate';
import { formatTokens, formatUsd } from '@/lib/format';
import { BoardFilters } from '@/pages/components/board-filters';
import { BOARD_ID, BoardScript } from '@/pages/components/board-script';
import { Button } from '@/pages/components/button';
import { boardHref } from '@/pages/leaderboard-href';
import { empty } from '@/pages/ui';
import { METRICS, type Metric, type TimeWindow } from '@/types';

const WINDOW_LABELS: Record<TimeWindow, string> = {
    today: 'Today',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    all: 'All time',
};

/** Compact labels so the window segment fits a phone width. */
const WINDOW_LABELS_SHORT: Record<TimeWindow, string> = {
    today: 'Today',
    '7d': '7d',
    '30d': '30d',
    all: 'All',
};

const METRIC_LABELS: Record<Metric, string> = {
    total: 'All tokens',
    input: 'Input',
    output: 'Output',
    cached: 'Cached',
    cost: 'Cost',
};

const WINDOWS: readonly TimeWindow[] = ['today', '7d', '30d', 'all'];

function formatMetric(metric: Metric, n: number): string {
    return metric === 'cost' ? formatUsd(n) : formatTokens(n);
}

function entryTotals(entries: LeaderboardEntry[]): Record<Metric, number> {
    const totals = {
        total: 0,
        input: 0,
        output: 0,
        cached: 0,
        cost: 0,
    } satisfies Record<Metric, number>;
    for (const e of entries) {
        for (const m of METRICS) totals[m] += metricValue(e, m);
    }
    return totals;
}

function tipLines(e: LeaderboardEntry, metric: Metric): string[] {
    const others = METRICS.filter((m) => m !== metric).map(
        (m) => `${METRIC_LABELS[m]} ${formatMetric(m, metricValue(e, m))}`,
    );
    return [
        `#${e.rank} @${e.username}`,
        `${METRIC_LABELS[metric]} ${formatMetric(metric, metricValue(e, metric))}`,
        others.join(' · '),
        `${e.sessions} sessions · ${formatTokens(grandTotal(e))} all tokens`,
    ];
}

export const LeaderboardChart: FC<{
    entries: LeaderboardEntry[];
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
    models: string[];
    countries: string[];
}> = ({
    entries,
    window,
    metric,
    source,
    model,
    country,
    models,
    countries,
}) => {
    const totals = entryTotals(entries);
    const max = Math.max(...entries.map((e) => metricValue(e, metric)), 1);

    return (
        <>
            <section
                id={BOARD_ID}
                class="board-region mb-8 overflow-visible rounded-lg border border-border bg-panel"
            >
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                    <div>
                        <div class="text-xs tracking-[0.06em] text-muted uppercase">
                            Leaderboard
                        </div>
                        <div class="text-lg font-extrabold tracking-[-0.02em]">
                            Ranked by {METRIC_LABELS[metric].toLowerCase()}
                        </div>
                        <div class="text-xs text-muted">
                            {WINDOW_LABELS[window]}
                        </div>
                    </div>
                    <div class="board-window-seg w-full min-w-0 sm:w-auto">
                        {WINDOWS.map((w) => (
                            <Button
                                key={w}
                                variant={w === window ? 'primary' : 'ghost'}
                                href={boardHref({
                                    window: w,
                                    metric,
                                    source,
                                    model,
                                    country,
                                })}
                                class="board-window-seg__btn !min-h-0 rounded-md px-2 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-sm"
                            >
                                <span class="sm:hidden">
                                    {WINDOW_LABELS_SHORT[w]}
                                </span>
                                <span class="hidden sm:inline">
                                    {WINDOW_LABELS[w]}
                                </span>
                            </Button>
                        ))}
                    </div>
                </div>

                <div class="board-stat-bar">
                    {METRICS.map((m) => {
                        const active = m === metric;
                        const hideMobile = m === 'cached';
                        return (
                            <Button
                                key={m}
                                variant={active ? 'secondary' : 'ghost'}
                                href={boardHref({
                                    window,
                                    metric: m,
                                    source,
                                    model,
                                    country,
                                })}
                                class={`board-stat-bar__cell !min-h-0 flex-col justify-center gap-1 rounded-none px-3 py-3 sm:px-4 sm:py-4 ${
                                    hideMobile
                                        ? 'board-stat-bar__cell--mobile-hide '
                                        : ''
                                }${active ? 'bg-panel2' : ''}`}
                            >
                                <span class="board-stat-bar__label">
                                    {METRIC_LABELS[m]}
                                </span>
                                <span
                                    class={`board-stat-bar__value ${
                                        active ? 'text-text' : 'text-muted'
                                    }`}
                                >
                                    {formatMetric(m, totals[m])}
                                </span>
                            </Button>
                        );
                    })}
                </div>

                <BoardFilters
                    window={window}
                    metric={metric}
                    source={source}
                    model={model}
                    country={country}
                    models={models}
                    countries={countries}
                />

                <div class="px-3 pt-4 pb-4 sm:px-5">
                    {entries.length === 0 ? (
                        <div class={empty}>
                            No builders on the board yet for this window.{' '}
                            <a href="/start">Be the first →</a>
                        </div>
                    ) : (
                        <div class="flex flex-col gap-1">
                            {entries.map((e) => {
                                const value = metricValue(e, metric);
                                const pct = Math.max(
                                    4,
                                    Math.round((value / max) * 100),
                                );
                                const tip = tipLines(e, metric);
                                return (
                                    <details
                                        key={e.username}
                                        class="group rounded-md open:bg-panel2 hover:bg-panel2"
                                    >
                                        <summary class="grid cursor-pointer list-none grid-cols-[2.5rem_7rem_1fr_4.5rem] items-center gap-2 px-1 py-1.5 [&::-webkit-details-marker]:hidden">
                                            <span class="text-xs font-semibold text-muted tabular-nums">
                                                #{e.rank}
                                            </span>
                                            <span class="truncate text-sm font-semibold text-text">
                                                {e.username}
                                            </span>
                                            <svg
                                                class="h-3 w-full overflow-hidden rounded-sm bg-panel2"
                                                viewBox="0 0 100 12"
                                                preserveAspectRatio="none"
                                                aria-hidden="true"
                                            >
                                                <rect
                                                    x="0"
                                                    y="0"
                                                    width={String(pct)}
                                                    height="12"
                                                    class="fill-accent"
                                                />
                                            </svg>
                                            <span class="text-right text-sm font-semibold text-text tabular-nums">
                                                {formatMetric(metric, value)}
                                            </span>
                                        </summary>
                                        <div class="border-t border-border px-3 py-2 text-xs leading-relaxed text-muted">
                                            {tip.map((line) => (
                                                <div
                                                    key={line}
                                                    class="text-text first:font-semibold"
                                                >
                                                    {line}
                                                </div>
                                            ))}
                                            <a
                                                class="mt-2 inline-block font-medium text-accent"
                                                href={`/u/${e.username}`}
                                            >
                                                View profile →
                                            </a>
                                        </div>
                                    </details>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>
            <BoardScript />
        </>
    );
};

export { METRIC_LABELS, WINDOW_LABELS };
