/** Hook / setup snippets shown on /start after (and before) a username claim. */

export type ClaimSnippets = {
    setup: string;
    claude: string;
    codex: string;
    opencode: string;
    pi: string;
    cursor: string;
    agent: string;
};

export function claimSnippets(
    base: string,
    username: string,
    token: string,
): ClaimSnippets {
    const setup =
        'npm install -g tokenmaxer && \\\n' +
        '  mkdir -p ~/.tokenmaxer && \\\n' +
        `  printf '%s' '${JSON.stringify({ apiBase: base, token })}' > ~/.tokenmaxer/config.json`;
    const claude = JSON.stringify(
        {
            hooks: {
                SessionStart: [
                    {
                        type: 'shell',
                        command: 'tokenmaxer claude-sessionstart',
                    },
                ],
                SessionEnd: [
                    { type: 'shell', command: 'tokenmaxer claude-sessionend' },
                ],
            },
        },
        null,
        2,
    );
    const codex =
        '[[hooks.session_start]]\n' +
        'type = "command"\n' +
        'command = "tokenmaxer codex-sessionstart"';
    const opencode =
        '# add to ~/.bashrc or ~/.zshrc\n' +
        'opencode() { command opencode "$@"; tokenmaxer opencode-sessionstart; }';
    const pi =
        '# add to ~/.bashrc or ~/.zshrc\n' +
        'pi() { command pi "$@"; tokenmaxer pi-sessionstart; }';
    const cursor = JSON.stringify(
        {
            version: 1,
            hooks: {
                sessionStart: [{ command: 'tokenmaxer cursor-sync' }],
            },
        },
        null,
        2,
    );
    const agent =
        'Help me finish setting up tokenmaxer.quest, an open-source token-usage leaderboard.\n' +
        'It uploads only per-session token counts, model names, session ids and timestamps -\n' +
        'never prompts, code, or credentials. Source: https://github.com/jackmcpickle/tokenmaxer\n' +
        'I already ran the one-time setup, so ~/.tokenmaxer/config.json holds my API token.\n' +
        `Read ${base}/start.md for the exact hook snippets, then:\n` +
        '1. Install the reporter: npm install -g tokenmaxer (a single zero-dependency script - review it first if you like).\n' +
        '2. Detect which coding tools I use (Claude Code / Codex / opencode / pi / Cursor) and configure the matching hooks from start.md.\n' +
        '3. Run "tokenmaxer backfill --dry-run" and show me a sample of what would be uploaded, then run "tokenmaxer backfill".\n' +
        `4. Confirm my sessions appear at ${base}/u/${username}`;
    return { setup, claude, codex, opencode, pi, cursor, agent };
}
