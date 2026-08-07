import { useRef, type FC, type RefObject } from 'react';
import { countryName, flagEmoji } from '@/lib/countries';
import { familyLabel } from '@/lib/model-family';
import {
    FilterDialog,
    type DialogHandle,
} from '@/pages/components/filter-dialog';
import { FilterPill } from '@/pages/components/filter-pill';
import { boardHref, SOURCE_LABELS } from '@/pages/leaderboard-href';
import { SOURCES, type Metric, type Source, type TimeWindow } from '@/types';

function sourceLabel(source: string): string {
    return SOURCE_LABELS[source as Source] ?? source;
}

function openDialog(ref: RefObject<DialogHandle | null>): void {
    ref.current?.showModal();
}

function closeMenu(menuRef: RefObject<{ open: boolean } | null>): void {
    if (menuRef.current) menuRef.current.open = false;
}

export const BoardFilters: FC<{
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
    models: string[];
    countries: string[];
    spa?: boolean;
}> = ({ window, metric, source, model, country, models, countries, spa }) => {
    const base = { window, metric, source, model, country };
    const sourceDlg = useRef<DialogHandle | null>(null);
    const modelDlg = useRef<DialogHandle | null>(null);
    const countryDlg = useRef<DialogHandle | null>(null);
    const menuRef = useRef<{ open: boolean } | null>(null);

    return (
        <div
            id="board-filters"
            className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-5"
        >
            <details
                className="board-filter-menu"
                ref={menuRef as never}
            >
                <summary className="board-filter-menu__trigger">Filter</summary>
                <div className="board-filter-menu__panel">
                    <button
                        type="button"
                        className="board-filter-menu__item"
                        data-filter-dialog="source"
                        onClick={
                            spa
                                ? () => {
                                      closeMenu(menuRef);
                                      openDialog(sourceDlg);
                                  }
                                : undefined
                        }
                    >
                        Source
                    </button>
                    <button
                        type="button"
                        className="board-filter-menu__item"
                        data-filter-dialog="model"
                        onClick={
                            spa
                                ? () => {
                                      closeMenu(menuRef);
                                      openDialog(modelDlg);
                                  }
                                : undefined
                        }
                    >
                        Model
                    </button>
                    {countries.length > 0 && (
                        <button
                            type="button"
                            className="board-filter-menu__item"
                            data-filter-dialog="country"
                            onClick={
                                spa
                                    ? () => {
                                          closeMenu(menuRef);
                                          openDialog(countryDlg);
                                      }
                                    : undefined
                            }
                        >
                            Country
                        </button>
                    )}
                </div>
            </details>

            {source && (
                <FilterPill
                    spa={spa}
                    label={sourceLabel(source)}
                    href={boardHref({
                        window,
                        metric,
                        model,
                        country,
                    })}
                    ariaLabel="Clear source filter"
                />
            )}
            {model && (
                <FilterPill
                    spa={spa}
                    label={familyLabel(model)}
                    href={boardHref({
                        window,
                        metric,
                        source,
                        country,
                    })}
                    ariaLabel="Clear model filter"
                />
            )}
            {country && (
                <FilterPill
                    spa={spa}
                    label={`${flagEmoji(country)} ${countryName(country)}`}
                    href={boardHref({
                        window,
                        metric,
                        source,
                        model,
                    })}
                    ariaLabel="Clear country filter"
                />
            )}

            <FilterDialog
                ref={sourceDlg}
                spa={spa}
                dimension="source"
                title="Source"
                base={base}
                active={source}
                options={[
                    { value: undefined, label: 'All' },
                    ...SOURCES.map((s) => ({
                        value: s,
                        label: SOURCE_LABELS[s],
                    })),
                ]}
            />
            <FilterDialog
                ref={modelDlg}
                spa={spa}
                dimension="model"
                title="Model"
                base={base}
                active={model}
                options={[
                    { value: undefined, label: 'All' },
                    ...models.map((m) => ({
                        value: m,
                        label: familyLabel(m),
                    })),
                ]}
            />
            {countries.length > 0 && (
                <FilterDialog
                    ref={countryDlg}
                    spa={spa}
                    dimension="country"
                    title="Country"
                    base={base}
                    active={country}
                    options={[
                        { value: undefined, label: 'All' },
                        ...countries.map((code) => ({
                            value: code,
                            label: `${flagEmoji(code)} ${countryName(code)}`,
                        })),
                    ]}
                />
            )}
        </div>
    );
};
