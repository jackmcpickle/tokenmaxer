import type { FC } from 'react';
import { countryName, flagEmoji } from '@/lib/countries';
import { familyLabel } from '@/lib/model-family';
import { FilterDialog } from '@/pages/components/filter-dialog';
import { FilterPill } from '@/pages/components/filter-pill';
import { boardHref, SOURCE_LABELS } from '@/pages/leaderboard-href';
import { SOURCES, type Metric, type Source, type TimeWindow } from '@/types';

function sourceLabel(source: string): string {
    return SOURCE_LABELS[source as Source] ?? source;
}

export const BoardFilters: FC<{
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
    models: string[];
    countries: string[];
}> = ({ window, metric, source, model, country, models, countries }) => {
    const base = { window, metric, source, model, country };

    return (
        <div
            id="board-filters"
            className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-5"
        >
            <details className="board-filter-menu">
                <summary className="board-filter-menu__trigger">Filter</summary>
                <div className="board-filter-menu__panel">
                    <button
                        type="button"
                        className="board-filter-menu__item"
                        data-filter-dialog="source"
                    >
                        Source
                    </button>
                    <button
                        type="button"
                        className="board-filter-menu__item"
                        data-filter-dialog="model"
                    >
                        Model
                    </button>
                    {countries.length > 0 && (
                        <button
                            type="button"
                            className="board-filter-menu__item"
                            data-filter-dialog="country"
                        >
                            Country
                        </button>
                    )}
                </div>
            </details>

            {source && (
                <FilterPill
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
