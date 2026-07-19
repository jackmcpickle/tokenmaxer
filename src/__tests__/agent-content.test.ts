import { describe, expect, it } from 'vitest';
import { aboutMarkdown } from '@/content/about.md';
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
