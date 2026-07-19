import { describe, expect, it } from 'vitest';
import { aboutMarkdown } from '@/content/about.md';
import { llmsFullTxt } from '@/content/llms-full';
import { llmsTxt } from '@/content/llms';
import { startMarkdown } from '@/content/start.md';

describe('aboutMarkdown', () => {
    it('has title and core sections', () => {
        const md = aboutMarkdown();
        expect(md).toMatch(/^# About tokenmaxer\.quest/m);
        expect(md).toContain('## What it tracks');
        expect(md).toContain('## Where the numbers come from');
        expect(md).toContain('## The honest part');
        expect(md).toContain('## Accounts & privacy');
        expect(md).toContain('Claude Code');
        expect(md).toContain('Cursor');
    });
});

describe('startMarkdown', () => {
    it('includes setup placeholders and tool sections', () => {
        const md = startMarkdown('https://tokenmaxer.quest');
        expect(md).toMatch(/^# Get started/m);
        expect(md).toContain('YOUR_USERNAME');
        expect(md).toContain('YOUR_TOKEN');
        expect(md).toContain('https://tokenmaxer.quest/tokentally.mjs');
        expect(md).toContain('## Agent prompt');
        expect(md).toContain('## Claude Code');
        expect(md).toContain('## Codex');
        expect(md).toContain('## opencode');
        expect(md).toContain('## pi');
        expect(md).toContain('## Cursor');
        expect(md).toContain('POST /api/register');
    });
});

describe('llmsTxt', () => {
    it('matches llms.txt shape with absolute .md and API links', () => {
        const md = llmsTxt('https://tokenmaxer.quest');
        expect(md).toMatch(/^# tokenmaxer\.quest/m);
        expect(md).toMatch(/^>/m);
        expect(md).toContain('## Docs');
        expect(md).toContain('## API');
        expect(md).toContain(
            '[Leaderboard](https://tokenmaxer.quest/index.md)',
        );
        expect(md).toContain(
            '[About](https://tokenmaxer.quest/about.md)',
        );
        expect(md).toContain(
            '[Get started](https://tokenmaxer.quest/start.md)',
        );
        expect(md).toContain('https://tokenmaxer.quest/api/leaderboard');
        expect(md).toContain('https://tokenmaxer.quest/api/u/:username');
        expect(md).toContain('## Optional');
    });
});

describe('llmsFullTxt', () => {
    it('inlines about + start and stays under 50KB', () => {
        const md = llmsFullTxt('https://tokenmaxer.quest');
        expect(md).toContain('# About tokenmaxer.quest');
        expect(md).toContain('# Get started');
        expect(md).toContain('/index.md');
        expect(md.length).toBeLessThan(50_000);
    });
});
