import type { Metric, Source, TimeWindow } from '@/types';

export const SOURCE_LABELS: Record<Source, string> = {
    claude_code: 'Claude Code',
    codex: 'Codex',
    opencode: 'opencode',
    pi: 'pi',
    cursor: 'Cursor',
};

export function boardHref(opts: {
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
}): string {
    const q = new URLSearchParams();
    q.set('window', opts.window);
    q.set('metric', opts.metric);
    if (opts.source) q.set('source', opts.source);
    if (opts.model) q.set('model', opts.model);
    if (opts.country) q.set('country', opts.country);
    return `/?${q.toString()}`;
}
