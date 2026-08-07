import { forwardRef } from 'react';
import { BoardNav } from '@/pages/components/board-nav';
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

export type DialogHandle = {
    showModal: () => void;
    close: () => void;
};

export const FilterDialog = forwardRef<
    DialogHandle,
    {
        dimension: FilterDimension;
        title: string;
        base: FilterDialogBase;
        options: Array<{ value: string | undefined; label: string }>;
        active?: string;
        spa?: boolean;
    }
>(function FilterDialog({ dimension, title, base, options, active, spa }, ref) {
    const id = `filter-dialog-${dimension}`;
    return (
        <dialog
            id={id}
            className="board-filter-dialog"
            aria-labelledby={`${id}-title`}
            ref={ref as never}
        >
            <div className="board-filter-dialog__header">
                <h2
                    id={`${id}-title`}
                    className="board-filter-dialog__title"
                >
                    {title}
                </h2>
                <button
                    type="button"
                    className="board-filter-dialog__close"
                    data-filter-close
                    aria-label={`Close ${title.toLowerCase()} filter`}
                    onClick={(e) => {
                        const dlg = (
                            e.currentTarget as unknown as {
                                closest: (s: string) => DialogHandle | null;
                            }
                        ).closest('dialog');
                        dlg?.close();
                    }}
                >
                    ×
                </button>
            </div>
            <div className="board-filter-dialog__body">
                {options.map((opt) => {
                    const isActive =
                        opt.value === undefined
                            ? active === undefined
                            : opt.value === active;
                    const href =
                        opt.value === undefined
                            ? boardHref({
                                  window: base.window,
                                  metric: base.metric,
                                  source:
                                      dimension === 'source'
                                          ? undefined
                                          : base.source,
                                  model:
                                      dimension === 'model'
                                          ? undefined
                                          : base.model,
                                  country:
                                      dimension === 'country'
                                          ? undefined
                                          : base.country,
                              })
                            : boardHref({
                                  window: base.window,
                                  metric: base.metric,
                                  source:
                                      dimension === 'source'
                                          ? opt.value
                                          : base.source,
                                  model:
                                      dimension === 'model'
                                          ? opt.value
                                          : base.model,
                                  country:
                                      dimension === 'country'
                                          ? opt.value
                                          : base.country,
                              });
                    return (
                        <BoardNav
                            key={opt.value ?? '__all__'}
                            spa={spa}
                            className="board-filter-option"
                            href={href}
                            aria-current={isActive ? 'true' : undefined}
                            onClick={(e) => {
                                const dlg = (
                                    e.currentTarget as unknown as {
                                        closest: (
                                            s: string,
                                        ) => DialogHandle | null;
                                    }
                                ).closest('dialog');
                                dlg?.close();
                            }}
                        >
                            {opt.label}
                        </BoardNav>
                    );
                })}
            </div>
        </dialog>
    );
});
