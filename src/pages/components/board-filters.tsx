import type { FC } from 'hono/jsx';
import { countryName, flagEmoji } from '@/lib/countries';
import { familyLabel } from '@/lib/model-family';
import { FilterDialog } from '@/pages/components/filter-dialog';
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
  root.querySelectorAll('dialog.board-filter-dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  });
  document.addEventListener('click', (e) => {
    if (!menu || !menu.open) return;
    if (!menu.contains(e.target)) menu.open = false;
  });
})();`;

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
            class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-5"
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

            {/* eslint-disable-next-line */}
            <script dangerouslySetInnerHTML={{ __html: FILTER_SCRIPT }} />
        </div>
    );
};
