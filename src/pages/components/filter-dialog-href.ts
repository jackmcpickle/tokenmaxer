import { boardHref } from '@/pages/leaderboard-href';
import type { Metric, TimeWindow } from '@/types';

export type FilterDialogBase = {
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
};

export type FilterDimension = 'source' | 'model' | 'country';

/** Href for one filter-dialog option (`undefined` value clears that dimension). */
export function filterDialogOptionHref(
    dimension: FilterDimension,
    base: FilterDialogBase,
    value: string | undefined,
): string {
    return boardHref({
        window: base.window,
        metric: base.metric,
        source: dimension === 'source' ? value : base.source,
        model: dimension === 'model' ? value : base.model,
        country: dimension === 'country' ? value : base.country,
    });
}
