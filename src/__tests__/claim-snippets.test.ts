import { describe, expect, it } from 'vitest';
import { claimSnippets } from '@/lib/claim-snippets';

describe('claimSnippets', () => {
    const s = claimSnippets('https://tokenmaxer.quest', 'alice', 'tt_secret');

    it('writes the token into ~/.tokenmaxer/config.json', () => {
        expect(s.setup).toContain('npm install -g tokenmaxer');
        expect(s.setup).toContain('mkdir -p ~/.tokenmaxer');
        expect(s.setup).toContain(
            `printf '%s' '${JSON.stringify({ apiBase: 'https://tokenmaxer.quest', token: 'tt_secret' })}'`,
        );
    });

    it('points the agent prompt at this username and start.md', () => {
        expect(s.agent).toContain(
            'Read https://tokenmaxer.quest/start.md for the exact hook snippets',
        );
        expect(s.agent).toContain(
            'Confirm my sessions appear at https://tokenmaxer.quest/u/alice',
        );
    });

    it('emits Claude, Codex, and Cursor hook configs', () => {
        expect(JSON.parse(s.claude)).toMatchObject({
            hooks: {
                SessionStart: [
                    {
                        type: 'shell',
                        command: 'tokenmaxer claude-sessionstart',
                    },
                ],
            },
        });
        expect(s.codex).toContain('tokenmaxer codex-sessionstart');
        expect(JSON.parse(s.cursor)).toMatchObject({
            version: 1,
            hooks: { sessionStart: [{ command: 'tokenmaxer cursor-sync' }] },
        });
    });
});
