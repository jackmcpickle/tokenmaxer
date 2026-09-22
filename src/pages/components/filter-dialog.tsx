import { forwardRef } from 'react';
import { BoardNav } from '@/pages/components/board-nav';
import {
    filterDialogOptionHref,
    type FilterDialogBase,
    type FilterDimension,
} from '@/pages/components/filter-dialog-href';

export type {
    FilterDialogBase,
    FilterDimension,
} from '@/pages/components/filter-dialog-href';

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
                    const href = filterDialogOptionHref(
                        dimension,
                        base,
                        opt.value,
                    );
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
