import { Hono } from 'hono';
import { aboutMarkdown } from '@/content/about.md';
import { homeMarkdown } from '@/content/home.md';
import { llmsTxt } from '@/content/llms';
import { llmsFullTxt } from '@/content/llms-full';
import { profileMarkdown, profileNotFoundMarkdown } from '@/content/profile.md';
import { startMarkdown } from '@/content/start.md';
import {
    INVITE_REQUIRED_MD,
    markdownBody,
    plainBody,
} from '@/lib/agent-markdown';
import { getLeaderboard, getProfile } from '@/lib/aggregate';
import { baseUrl } from '@/lib/base-url';
import { getInviteCookie, inviteSessionAllowed } from '@/lib/invite';
import { parseSourceParam, parseWindow } from '@/routes/leaderboard';
import type { Env } from '@/types';

export const agentPageRoutes = new Hono<{ Bindings: Env }>();

agentPageRoutes.get('/llms.txt', (c) =>
    plainBody(llmsTxt(baseUrl(c.env, c.req.url))),
);

agentPageRoutes.get('/llms-full.txt', (c) =>
    plainBody(llmsFullTxt(baseUrl(c.env, c.req.url))),
);

agentPageRoutes.get('/about.md', () => markdownBody(aboutMarkdown()));

agentPageRoutes.get('/start.md', async (c) => {
    const invited = await inviteSessionAllowed(
        c.env.INVITE_KEY,
        getInviteCookie(c),
    );
    if (!invited) return markdownBody(INVITE_REQUIRED_MD, { status: 403 });
    return markdownBody(startMarkdown(baseUrl(c.env, c.req.url)));
});

agentPageRoutes.get('/index.md', async (c) => {
    const window = parseWindow(c.req.query('window'));
    const source = parseSourceParam(c.req.query('source'));
    const modelRaw = c.req.query('model');
    const model = modelRaw && modelRaw.length > 0 ? modelRaw : undefined;
    const entries = await getLeaderboard(
        c.env.DB,
        { window, metric: 'total', source, model, limit: 10 },
        Date.now(),
    );
    return markdownBody(
        homeMarkdown({
            base: baseUrl(c.env, c.req.url),
            entries,
            window,
            source,
            model,
        }),
    );
});

agentPageRoutes.get('/u/:username{.+\\.md}', async (c) => {
    const raw = c.req.param('username');
    const username = raw.endsWith('.md') ? raw.slice(0, -3) : raw;
    const profile = await getProfile(c.env.DB, username);
    if (!profile) {
        return markdownBody(profileNotFoundMarkdown(username), {
            status: 404,
        });
    }
    return markdownBody(
        profileMarkdown({
            base: baseUrl(c.env, c.req.url),
            profile,
        }),
    );
});
