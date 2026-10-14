import { describe, expect, it } from 'vitest';
import {
    grokBotSessionId,
    isGrokBotModel,
    partitionGrokBot,
} from '@/lib/grok-bot';
import type { SessionUsageInput } from '@/types';
import { isGrokBotModel as reporterIsGrokBotModel } from '../../reporter/src/lib/grok-bot';

function row(
    model: string,
    session_id = 'cursor-2026-07-19',
): SessionUsageInput {
    return {
        session_id,
        model,
        day: 20260719,
        started_at: 1_000,
        input_tokens: 1,
        output_tokens: 2,
        cache_read_tokens: 3,
        cache_creation_tokens: 4,
        reasoning_tokens: 0,
    };
}

describe('isGrokBotModel', () => {
    const grokBot = [
        'grok-bot-default',
        'grok-bot-automation',
        'grok-bot-cua',
        'grok-bot',
        'GROK-BOT-DEFAULT',
        'sand-default',
        'sand-automation',
        ' sand ',
    ];
    // Grok models used inside the editor are ordinary Cursor usage, and
    // nothing merely containing the words may match.
    const cursor = [
        'grok-4.7-high',
        'cursor-grok-4.6-high-fast',
        'grok-code-fast-1',
        'grok-bottle',
        'sandbox-model',
        'composer-2.5-fast',
        'claude-opus-5-low',
        '',
    ];

    it('matches Grok Bot product rows and nothing else', () => {
        for (const m of grokBot) expect(isGrokBotModel(m), m).toBe(true);
        for (const m of cursor) expect(isGrokBotModel(m), m).toBe(false);
    });

    it('agrees with the reporter copy of the rule', () => {
        for (const m of [...grokBot, ...cursor]) {
            expect(reporterIsGrokBotModel(m), m).toBe(isGrokBotModel(m));
        }
    });
});

describe('grokBotSessionId', () => {
    it('rewrites the cursor day prefix and leaves other ids alone', () => {
        expect(grokBotSessionId('cursor-2026-07-19')).toBe(
            'grok-bot-2026-07-19',
        );
        expect(grokBotSessionId('grok-bot-2026-07-19')).toBe(
            'grok-bot-2026-07-19',
        );
        expect(grokBotSessionId('abc')).toBe('abc');
    });
});

describe('partitionGrokBot', () => {
    it('passes non-cursor sources through untouched', () => {
        const groups = partitionGrokBot(
            'claude_code',
            [row('grok-bot-default', 's1')],
            ['s1'],
        );
        expect(groups).toEqual([
            {
                source: 'claude_code',
                sessions: [row('grok-bot-default', 's1')],
                replaceSessions: ['s1'],
            },
        ]);
    });

    it('claims the matching Grok Bot day even when the batch has no Bot rows', () => {
        // A legacy reporter may send this day's Bot rows in a later, unclaimed
        // batch; the claim must ride with the batch that claims the Cursor day.
        const groups = partitionGrokBot(
            'cursor',
            [row('composer-2.5-fast')],
            ['cursor-2026-07-19', 'other-id'],
        );
        expect(groups).toEqual([
            {
                source: 'cursor',
                sessions: [row('composer-2.5-fast')],
                replaceSessions: ['cursor-2026-07-19', 'other-id'],
            },
            {
                source: 'grok_bot',
                sessions: [],
                replaceSessions: ['grok-bot-2026-07-19'],
            },
        ]);
    });

    it('moves Grok Bot rows from an old reporter to their own source and session', () => {
        const groups = partitionGrokBot(
            'cursor',
            [
                row('composer-2.5-fast'),
                row('grok-bot-default'),
                row('grok-bot-cua', 'cursor-2026-07-20'),
            ],
            ['cursor-2026-07-19', 'cursor-2026-07-20', 'cursor-2026-07-21'],
        );
        expect(groups).toHaveLength(2);
        expect(groups[0]).toEqual({
            source: 'cursor',
            sessions: [row('composer-2.5-fast')],
            replaceSessions: [
                'cursor-2026-07-19',
                'cursor-2026-07-20',
                'cursor-2026-07-21',
            ],
        });
        expect(groups[1]).toEqual({
            source: 'grok_bot',
            sessions: [
                row('grok-bot-default', 'grok-bot-2026-07-19'),
                row('grok-bot-cua', 'grok-bot-2026-07-20'),
            ],
            replaceSessions: [
                'grok-bot-2026-07-19',
                'grok-bot-2026-07-20',
                'grok-bot-2026-07-21',
            ],
        });
    });

    it('keeps the cursor claim when every row moved away', () => {
        // The day was fully re-reported and has no editor usage left, so the
        // stale Cursor rows must still be cleared.
        const groups = partitionGrokBot(
            'cursor',
            [row('grok-bot-default')],
            ['cursor-2026-07-19'],
        );
        expect(groups[0]).toEqual({
            source: 'cursor',
            sessions: [],
            replaceSessions: ['cursor-2026-07-19'],
        });
        expect(groups[1]?.source).toBe('grok_bot');
    });

    it('does not claim a Grok Bot day the batch merely continues', () => {
        const groups = partitionGrokBot(
            'cursor',
            [row('grok-bot-default')],
            [],
        );
        expect(groups[1]?.replaceSessions).toEqual([]);
    });
});
