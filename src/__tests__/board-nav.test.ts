import { describe, expect, it } from 'vitest';
import { boardHrefToSearch } from '@/pages/components/board-nav';
import { BOARD_PAGE_SIZE } from '@/pages/leaderboard-chart';
import { boardHref } from '@/pages/leaderboard-href';

describe('boardHrefToSearch', () => {
    it('parses board filter hrefs into router search', () => {
        expect(
            boardHrefToSearch(
                boardHref({
                    window: '30d',
                    metric: 'cost',
                    source: 'codex',
                    model: 'sonnet',
                    country: 'AU',
                }),
            ),
        ).toEqual({
            window: '30d',
            metric: 'cost',
            source: 'codex',
            model: 'sonnet',
            country: 'AU',
        });
    });

    it('omits unset optional filters', () => {
        expect(
            boardHrefToSearch(boardHref({ window: '7d', metric: 'total' })),
        ).toEqual({ window: '7d', metric: 'total' });
    });
});

describe('BOARD_PAGE_SIZE', () => {
    it('pages the board ten rows at a time', () => {
        expect(BOARD_PAGE_SIZE).toBe(10);
    });
});
