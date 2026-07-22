import type { FC } from 'hono/jsx';
import { countryName, flagEmoji } from '@/lib/countries';
import { familyLabel } from '@/lib/model-family';
import { FilterPill } from '@/pages/components/filter-pill';
import { boardHref, SOURCE_LABELS } from '@/pages/leaderboard-href';
import { SOURCES, type Metric, type Source, type TimeWindow } from '@/types';

const FILTER_SCRIPT = `(() => {
  const root = document.getElementById('board-filters');
  if (!root) return;
  const menu = root.querySelector('details.board-filter-menu');
  root.querySelectorAll('[data-filter-dialog]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = 'filter-dialog-' + btn.getAttribute('data-filter-dialog');
      const dlg = document.getElementById(id);
      if (menu) menu.open = false;
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    });
  });
  root.querySelectorAll('[data-filter-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dlg = btn.closest('dialog');
      if (dlg) dlg.close();
    });
  });
  document.addEventListener('click', (e) => {
    if (!menu || !menu.open) return;
    if (!menu.contains(e.target)) menu.open = false;
  });
})();`;

type FilterBase = {
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
};

function sourceLabel(source: string): string {
    return SOURCE_LABELS[source as Source] ?? source;
}

const FilterDialog: FC<{
    id: string;
    title: string;
    base: FilterBase;
    options: Array<{ value: string | undefined; label: string }>;
    active?: string;
}> = ({ id, title, base, options, active }) => (
    <dialog
        id={id}
        class="board-filter-dialog"
    >
        <div class="board-filter-dialog__header">
            <h2 class="board-filter-dialog__title">{title}</h2>
            <button
                type="button"
                class="board-filter-dialog__close"
                data-filter-close
                aria-label={`Close ${title.toLowerCase()} filter`}
            >
                ×
            </button>
        </div>
        <div class="board-filter-dialog__body">
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
                                  id === 'filter-dialog-source'
                                      ? undefined
                                      : base.source,
                              model:
                                  id === 'filter-dialog-model'
                                      ? undefined
                                      : base.model,
                              country:
                                  id === 'filter-dialog-country'
                                      ? undefined
                                      : base.country,
                          })
                        : boardHref({
                              window: base.window,
                              metric: base.metric,
                              source:
                                  id === 'filter-dialog-source'
                                      ? opt.value
                                      : base.source,
                              model:
                                  id === 'filter-dialog-model'
                                      ? opt.value
                                      : base.model,
                              country:
                                  id === 'filter-dialog-country'
                                      ? opt.value
                                      : base.country,
                          });
                return (
                    <a
                        key={opt.value ?? '__all__'}
                        class="board-filter-option"
                        href={href}
                        aria-current={isActive ? 'true' : undefined}
                    >
                        {opt.label}
                    </a>
                );
            })}
        </div>
    </dialog>
);

export const BoardFilters: FC<{
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
    models: string[];
    countries: string[];
}> = ({ window, metric, source, model, country, models, countries }) => {
    const base: FilterBase = { window, metric, source, model, country };

    return (
        <div
            id="board-filters"
            class="flex flex-wrap items-center gap-2"
        >
            <details class="board-filter-menu">
                <summary class="board-filter-menu__trigger">Filter</summary>
                <div class="board-filter-menu__panel">
                    <button
                        type="button"
                        class="board-filter-menu__item"
                        data-filter-dialog="source"
                    >
                        Source
                    </button>
                    <button
                        type="button"
                        class="board-filter-menu__item"
                        data-filter-dialog="model"
                    >
                        Model
                    </button>
                    {countries.length > 0 && (
                        <button
                            type="button"
                            class="board-filter-menu__item"
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
                id="filter-dialog-source"
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
                id="filter-dialog-model"
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
                    id="filter-dialog-country"
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

            <script dangerouslySetInnerHTML={{ __html: FILTER_SCRIPT }} />
        </div>
    );
};
