import type { FC } from 'react';

/** SVG rank bar; remount (via key) to replay the width grow animation. */
export const BoardBar: FC<{ pct: number }> = function BoardBar({ pct }) {
    return (
        <svg
            className="h-3 w-full overflow-hidden rounded-sm bg-panel2"
            viewBox="0 0 100 12"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <rect
                x="0"
                y="0"
                width={String(pct)}
                height="12"
                className="board-bar-fill fill-accent"
            />
        </svg>
    );
};
