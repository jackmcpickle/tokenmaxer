import { describe, expect, it } from 'vitest';
import { boardHref } from '@/pages/leaderboard-href';

describe('boardHref', () => {
    it('builds query with only set filters', () => {
        expect(
            boardHref({ window: '7d', metric: 'total', source: 'codex' }),
        ).toBe('/?window=7d&metric=total&source=codex');
        expect(
            boardHref({
                window: '30d',
                metric: 'cost',
                source: 'claude_code',
                model: 'sonnet',
                country: 'AU',
            }),
        ).toBe(
            '/?window=30d&metric=cost&source=claude_code&model=sonnet&country=AU',
        );
    });
});
