import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type FC,
} from 'react';
import {
    type LeaderboardEntry,
    grandTotal,
    metricValue,
} from '@/lib/aggregate';
import { formatTokens, formatUsd } from '@/lib/format';
import { BoardBar } from '@/pages/components/board-bar';
import { BoardFilters } from '@/pages/components/board-filters';
import { BOARD_ID, BoardScript } from '@/pages/components/board-script';
import { Button } from '@/pages/components/button';
import { boardHref } from '@/pages/leaderboard-href';
import { empty } from '@/pages/ui';
import { METRICS, type Metric, type TimeWindow } from '@/types';

/** Rows shown initially / each Load more click. */
export const BOARD_PAGE_SIZE = 10;

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

function filterKey(opts: {
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
}): string {
    return [
        opts.window,
        opts.metric,
        opts.source ?? '',
        opts.model ?? '',
        opts.country ?? '',
    ].join('|');
}

type BoxEl = { offsetHeight: number };

export const LeaderboardChart: FC<{
    entries: LeaderboardEntry[];
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
    models: string[];
    countries: string[];
    /** TanStack Start: client nav, no HTML swap, load-more + bar motion. */
    spa?: boolean;
    /** Filter navigation in flight — keep prior rows / reserve height. */
    pending?: boolean;
}> = ({
    entries,
    window,
    metric,
    source,
    model,
    country,
    models,
    countries,
    spa,
    pending = false,
}) => {
    const key = filterKey({ window, metric, source, model, country });
    const listRef = useRef<BoxEl | null>(null);
    const [minListHeight, setMinListHeight] = useState<number | undefined>();
    const [displayEntries, setDisplayEntries] = useState(entries);
    const [visibleCount, setVisibleCount] = useState(BOARD_PAGE_SIZE);

    // Keep prior rows visible while the next filter load is in flight.
    useEffect(() => {
        if (!pending) setDisplayEntries(entries);
    }, [entries, pending]);

    useEffect(() => {
        setVisibleCount(BOARD_PAGE_SIZE);
    }, [key]);

    useLayoutEffect(() => {
        if (!spa) return;
        const el = listRef.current;
        if (pending && el) {
            setMinListHeight(el.offsetHeight);
            return;
        }
        setMinListHeight(undefined);
    }, [pending, spa]);

    const totals = entryTotals(displayEntries);
    const max = Math.max(
        ...displayEntries.map((e) => metricValue(e, metric)),
        1,
    );
    // SPA: page in chunks of 10. Static HTML (no hydration): show everyone.
    const shown = spa ? displayEntries.slice(0, visibleCount) : displayEntries;
    const hasMore = Boolean(spa) && visibleCount < displayEntries.length;

    const sectionStyle = (
        minListHeight
            ? {
                  ['--board-list-min-height' as string]: `${minListHeight}px`,
              }
            : undefined
    ) as CSSProperties | undefined;

    return (
        <>
            <section
                id={BOARD_ID}
                data-spa-board={spa ? 'true' : undefined}
                aria-busy={pending ? 'true' : undefined}
                className="board-region mb-8 overflow-visible rounded-lg border border-border bg-panel"
                style={sectionStyle}
            >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                    <div>
                        <div className="text-xs tracking-[0.06em] text-muted uppercase">
                            Leaderboard
                        </div>
                        <div className="text-lg font-extrabold tracking-[-0.02em]">
                            {`Ranked by ${METRIC_LABELS[metric].toLowerCase()}`}
                        </div>
                        <div className="text-xs text-muted">
                            {WINDOW_LABELS[window]}
                        </div>
                    </div>
                    <div className="board-window-seg w-full min-w-0 sm:w-auto">
                        {WINDOWS.map((w) => (
                            <Button
                                key={w}
                                spa={spa}
                                variant={w === window ? 'primary' : 'ghost'}
                                href={boardHref({
                                    window: w,
                                    metric,
                                    source,
                                    model,
                                    country,
                                })}
                                className="board-window-seg__btn !min-h-0 rounded-md px-2 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-sm"
                            >
                                <span className="sm:hidden">
                                    {WINDOW_LABELS_SHORT[w]}
                                </span>
                                <span className="hidden sm:inline">
                                    {WINDOW_LABELS[w]}
                                </span>
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="board-stat-bar">
                    {METRICS.map((m) => {
                        const active = m === metric;
                        const hideMobile = m === 'cached';
                        return (
                            <Button
                                key={m}
                                spa={spa}
                                variant={active ? 'secondary' : 'ghost'}
                                href={boardHref({
                                    window,
                                    metric: m,
                                    source,
                                    model,
                                    country,
                                })}
                                className={`board-stat-bar__cell !min-h-0 flex-col justify-center gap-1 rounded-none px-3 py-3 sm:px-4 sm:py-4 ${
                                    hideMobile
                                        ? 'board-stat-bar__cell--mobile-hide '
                                        : ''
                                }${active ? 'bg-panel2' : ''}`}
                            >
                                <span className="board-stat-bar__label">
                                    {METRIC_LABELS[m]}
                                </span>
                                <span
                                    className={`board-stat-bar__value ${
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
                    spa={spa}
                    window={window}
                    metric={metric}
                    source={source}
                    model={model}
                    country={country}
                    models={models}
                    countries={countries}
                />

                <div className="px-3 pt-4 pb-4 sm:px-5">
                    {displayEntries.length === 0 ? (
                        <div className={empty}>
                            No builders on the board yet for this window.{' '}
                            <a href="/start">Be the first →</a>
                        </div>
                    ) : (
                        <div
                            ref={listRef as never}
                            className="board-entry-list flex flex-col gap-1"
                        >
                            {shown.map((e) => {
                                const value = metricValue(e, metric);
                                const pct = Math.max(
                                    4,
                                    Math.round((value / max) * 100),
                                );
                                const tip = tipLines(e, metric);
                                return (
                                    <details
                                        key={e.username}
                                        className="group rounded-md open:bg-panel2 hover:bg-panel2"
                                    >
                                        <summary className="grid cursor-pointer list-none grid-cols-[2.5rem_7rem_1fr_4.5rem] items-center gap-2 px-1 py-1.5 [&::-webkit-details-marker]:hidden">
                                            <span className="text-xs font-semibold text-muted tabular-nums">
                                                #{e.rank}
                                            </span>
                                            <span className="truncate text-sm font-semibold text-text">
                                                {e.username}
                                            </span>
                                            <BoardBar
                                                key={`${key}:${e.username}`}
                                                pct={pct}
                                            />
                                            <span className="text-right text-sm font-semibold text-text tabular-nums">
                                                {formatMetric(metric, value)}
                                            </span>
                                        </summary>
                                        <div className="border-t border-border px-3 py-2 text-xs leading-relaxed text-muted">
                                            {tip.map((line) => (
                                                <div
                                                    key={line}
                                                    className="text-text first:font-semibold"
                                                >
                                                    {line}
                                                </div>
                                            ))}
                                            <a
                                                className="mt-2 inline-block font-medium text-accent"
                                                href={`/u/${e.username}`}
                                            >
                                                View profile →
                                            </a>
                                        </div>
                                    </details>
                                );
                            })}
                            {hasMore && (
                                <div className="pt-3">
                                    <Button
                                        variant="secondary"
                                        type="button"
                                        className="w-full sm:w-auto"
                                        onClick={() =>
                                            setVisibleCount(
                                                (n) => n + BOARD_PAGE_SIZE,
                                            )
                                        }
                                    >
                                        Load more
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>
            {!spa && <BoardScript />}
        </>
    );
};

export { METRIC_LABELS, WINDOW_LABELS };
