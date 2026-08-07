import { Link } from '@tanstack/react-router';
import type { FC, MouseEventHandler, ReactNode } from 'react';
import type { Metric, Source, TimeWindow } from '@/types';

export type BoardSearch = {
    window?: TimeWindow;
    metric?: Metric;
    source?: Source;
    model?: string;
    country?: string;
};

/** Parse a `boardHref(...)` path into TanStack search params. */
export function boardHrefToSearch(href: string): BoardSearch {
    const q = href.includes('?')
        ? new URLSearchParams(href.slice(href.indexOf('?') + 1))
        : new URLSearchParams();
    const out: BoardSearch = {};
    const window = q.get('window');
    const metric = q.get('metric');
    const source = q.get('source');
    const model = q.get('model');
    const country = q.get('country');
    if (window) out.window = window as TimeWindow;
    if (metric) out.metric = metric as Metric;
    if (source) out.source = source as Source;
    if (model) out.model = model;
    if (country) out.country = country;
    return out;
}

type BoardNavProps = {
    href: string;
    className?: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
    'aria-label'?: string;
    'aria-current'?: 'true' | undefined;
    /** When true, use TanStack client navigation (no full document swap). */
    spa?: boolean;
};

/**
 * Same-page board filter link. In SPA mode uses the router so React keeps the
 * board mounted (no HTML swap / layout jump). Otherwise a plain anchor for the
 * progressive-enhancement BoardScript path.
 */
export const BoardNav: FC<BoardNavProps> = function BoardNav({
    href,
    className,
    children,
    spa,
    onClick,
    ...rest
}) {
    if (spa) {
        return (
            <Link
                to="/"
                search={boardHrefToSearch(href)}
                className={className}
                resetScroll={false}
                preload="intent"
                onClick={onClick}
                {...rest}
            >
                {children}
            </Link>
        );
    }
    return (
        <a
            className={className}
            href={href}
            onClick={onClick}
            {...rest}
        >
            {children}
        </a>
    );
};
