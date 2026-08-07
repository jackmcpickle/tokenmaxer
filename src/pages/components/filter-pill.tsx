import type { FC } from 'react';
import { BoardNav } from '@/pages/components/board-nav';

export const FilterPill: FC<{
    label: string;
    href: string;
    ariaLabel: string;
    spa?: boolean;
}> = ({ label, href, ariaLabel, spa }) => (
    <span className="filter-pill inline-flex items-center gap-1 rounded-md bg-panel2 px-2.5 py-1 text-[12px] font-medium text-text">
        <span>{label}</span>
        <BoardNav
            spa={spa}
            className="filter-pill__clear text-muted no-underline hover:text-text"
            href={href}
            aria-label={ariaLabel}
        >
            ×
        </BoardNav>
    </span>
);
