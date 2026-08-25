import { useState, type FC, type ReactNode } from 'react';
import type { ClaimSnippets } from '@/lib/claim-snippets';
import { CopyButton } from '@/pages/components/copy-button';
import { copyrow, muted, panel } from '@/pages/ui';

const TABS: Array<{ id: string; label: string }> = [
    { id: 'agent', label: 'Agent' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'opencode', label: 'opencode' },
    { id: 'pi', label: 'pi' },
    { id: 'cursor', label: 'Cursor' },
];

export const StartSetup: FC<{
    snippets: ClaimSnippets;
    splitLayout: boolean;
    children?: ReactNode;
}> = ({ snippets, splitLayout, children }) => {
    const [tab, setTab] = useState('agent');
    return (
        <div
            className={
                splitLayout
                    ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]'
                    : ''
            }
        >
            <div className={`${panel} min-w-0`}>
                <h2 className="mt-0">One-time setup</h2>
                <p className={muted}>
                    Installs the open-source{' '}
                    <a href="https://www.npmjs.com/package/tokenmaxer">
                        <code>tokenmaxer</code>
                    </a>{' '}
                    reporter from npm and writes your config (the token lives
                    only in <code>~/.tokenmaxer/config.json</code>, never in
                    shared settings). It uploads only per-session token counts,
                    model names, session ids and timestamps — never prompts,
                    code, or credentials; run any command with{' '}
                    <code>--dry-run</code> to see the exact payload. Run in a
                    terminal:
                </p>
                <div className={copyrow}>
                    <pre id="r-setup">{snippets.setup}</pre>
                    <CopyButton text={snippets.setup} />
                </div>

                <div className="mt-6 mb-4 flex flex-wrap border-b border-border">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            className={`tab${t.id === tab ? ' tab-active' : ''}`}
                            type="button"
                            data-tab={t.id}
                            onClick={() => {
                                setTab(t.id);
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div
                    id="tab-agent"
                    className={`tab-panel${tab === 'agent' ? '' : ' hidden'}`}
                >
                    <p className={muted}>
                        Run the one-time setup above yourself (so your token
                        never enters the chat), then paste this into your coding
                        agent — it will do the rest.
                    </p>
                    <div className={copyrow}>
                        <pre id="r-agent">{snippets.agent}</pre>
                        <CopyButton text={snippets.agent} />
                    </div>
                </div>

                <div
                    id="tab-claude"
                    className={`tab-panel${tab === 'claude' ? '' : ' hidden'}`}
                >
                    <h2>Claude Code hooks</h2>
                    <p className={muted}>
                        Merge into <code>~/.claude/settings.json</code>:
                    </p>
                    <div className={copyrow}>
                        <pre id="r-claude">{snippets.claude}</pre>
                        <CopyButton text={snippets.claude} />
                    </div>
                </div>

                <div
                    id="tab-codex"
                    className={`tab-panel${tab === 'codex' ? '' : ' hidden'}`}
                >
                    <h2>Codex hooks</h2>
                    <p className={muted}>
                        Add to <code>~/.codex/config.toml</code>. Codex has no
                        SessionEnd hook, so your latest session reports when you
                        next launch Codex.
                    </p>
                    <div className={copyrow}>
                        <pre id="r-codex">{snippets.codex}</pre>
                        <CopyButton text={snippets.codex} />
                    </div>
                </div>

                <div
                    id="tab-opencode"
                    className={`tab-panel${tab === 'opencode' ? '' : ' hidden'}`}
                >
                    <h2>opencode hook</h2>
                    <p className={muted}>
                        opencode has no shell hooks, so add a wrapper function
                        to your <code>~/.bashrc</code> or <code>~/.zshrc</code>.
                        It reports your latest sessions each time opencode
                        exits:
                    </p>
                    <div className={copyrow}>
                        <pre id="r-opencode">{snippets.opencode}</pre>
                        <CopyButton text={snippets.opencode} />
                    </div>
                </div>

                <div
                    id="tab-pi"
                    className={`tab-panel${tab === 'pi' ? '' : ' hidden'}`}
                >
                    <h2>pi hook</h2>
                    <p className={muted}>
                        Same idea for pi — add a wrapper function to your{' '}
                        <code>~/.bashrc</code> or <code>~/.zshrc</code>:
                    </p>
                    <div className={copyrow}>
                        <pre id="r-pi">{snippets.pi}</pre>
                        <CopyButton text={snippets.pi} />
                    </div>
                </div>

                <div
                    id="tab-cursor"
                    className={`tab-panel${tab === 'cursor' ? '' : ' hidden'}`}
                >
                    <h2>Cursor</h2>
                    <p className={muted}>
                        Cursor doesn&apos;t expose token usage to hooks, so the
                        reporter reads your own usage from Cursor&apos;s
                        dashboard API using the Cursor login already on this
                        machine. That login is sent{' '}
                        <strong>only to cursor.com</strong> — it never reaches
                        tokenmaxer servers, and only the resulting token counts
                        are uploaded. Add this to{' '}
                        <code>~/.cursor/hooks.json</code> so every session
                        triggers a sync:
                    </p>
                    <div className={copyrow}>
                        <pre id="r-cursor">{snippets.cursor}</pre>
                        <CopyButton text={snippets.cursor} />
                    </div>
                    <p className={`${muted} mt-3 text-[13px]`}>
                        If auto-auth fails (Cursor not logged in on this
                        machine), see the{' '}
                        <a href="https://github.com/jackmcpickle/tokenmaxer/tree/main/reporter">
                            reporter README
                        </a>{' '}
                        for the manual <code>cursorCookie</code> fallback.
                    </p>
                </div>

                <h2>Backfill past history (optional)</h2>
                <p className={muted}>
                    The hooks only report new sessions. To include sessions from
                    before you installed tokenmaxer.quest, run this once — it
                    computes token-count summaries from your local Claude Code,
                    Codex, opencode, pi and Cursor transcripts and uploads only
                    those summaries (idempotent, so it&apos;s safe to re-run).
                    Use <code>--dry-run</code> first to inspect the payload, and
                    add <code>claude</code>, <code>codex</code>,{' '}
                    <code>opencode</code>, <code>pi</code> or{' '}
                    <code>cursor</code> to limit it to one tool:
                </p>
                <div className={copyrow}>
                    <pre id="r-backfill">tokenmaxer backfill</pre>
                    <CopyButton text="tokenmaxer backfill" />
                </div>
            </div>
            {children}
        </div>
    );
};
