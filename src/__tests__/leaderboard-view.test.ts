import { describe, expect, it } from 'vitest';
import {
    initialBoardView,
    showMoreBoard,
    stepBoardView,
} from '@/pages/leaderboard-view';

const pageSize = 10;
const previous = [{ id: 'previous' }];
const incoming = [{ id: 'incoming' }];

describe('stepBoardView', () => {
    it('keeps the previous rows while a filter load is pending', () => {
        const start = initialBoardView(previous, '7d', pageSize);
        const pending = stepBoardView(start, {
            entries: incoming,
            pending: true,
            key: '7d',
            pageSize,
        });
        expect(pending.displayEntries).toEqual(previous);
        expect(pending.visibleCount).toBe(pageSize);
    });

    it('shows the new rows when the filter load completes', () => {
        const start = initialBoardView(previous, '7d', pageSize);
        const pending = stepBoardView(start, {
            entries: incoming,
            pending: true,
            key: '7d',
            pageSize,
        });
        const done = stepBoardView(pending, {
            entries: incoming,
            pending: false,
            key: '7d',
            pageSize,
        });
        expect(done.displayEntries).toEqual(incoming);
        expect(done.visibleCount).toBe(pageSize);
    });

    it('updates entries without resetting the page when the filter key stays the same', () => {
        const start = showMoreBoard(
            initialBoardView(previous, '7d', pageSize),
            pageSize,
        );
        const next = stepBoardView(start, {
            entries: incoming,
            pending: false,
            key: '7d',
            pageSize,
        });
        expect(next.displayEntries).toEqual(incoming);
        expect(next.visibleCount).toBe(pageSize * 2);
    });

    it('resets pagination only when the filter key changes after loading more than ten rows', () => {
        const rows = Array.from({ length: 11 }, (_, index) => ({
            id: String(index),
        }));
        const expanded = showMoreBoard(
            initialBoardView(rows, '7d|tokens', pageSize),
            pageSize,
        );
        expect(expanded.visibleCount).toBe(20);

        const sameKey = stepBoardView(expanded, {
            entries: rows,
            pending: false,
            key: '7d|tokens',
            pageSize,
        });
        expect(sameKey).toBe(expanded);

        const changed = stepBoardView(expanded, {
            entries: incoming,
            pending: false,
            key: '30d|tokens',
            pageSize,
        });
        expect(changed.displayEntries).toEqual(incoming);
        expect(changed.visibleCount).toBe(pageSize);
        expect(changed.visibleKey).toBe('30d|tokens');
    });
});
