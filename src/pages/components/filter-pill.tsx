import type { FC } from 'hono/jsx';

export const FilterPill: FC<{
    label: string;
    href: string;
    ariaLabel: string;
}> = ({ label, href, ariaLabel }) => (
    <span class="filter-pill inline-flex items-center gap-1 rounded-md bg-panel2 px-2.5 py-1 text-[12px] font-medium text-text">
        <span>{label}</span>
        <a
            class="filter-pill__clear text-muted no-underline hover:text-text"
            href={href}
            aria-label={ariaLabel}
        >
            ×
        </a>
    </span>
);
