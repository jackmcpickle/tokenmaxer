import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
    backfill,
    claudeCatchup,
    claudeSessionEnd,
    codexCatchup,
    cursorSyncCommand,
    opencodeCatchup,
    piCatchup,
    reportOne,
    reportOneOpencode,
} from './commands';
import { loadConfig } from './config';
import { runLogin } from './login';
import { runSetProfileUrl } from './profile';
import { runRotate } from './rotate';
import { printVersion } from './version';
import { runWhoami } from './whoami';

interface CommandDoc {
    name: string;
    // Other spellings `main` accepts for the same command.
    aliases?: string[];
    // One `[syntax, one-liner]` row per form; the first row is the canonical
    // form. All rows appear in the `help` listing.
    rows: Array<[string, string]>;
    // Paragraphs shown by `tokenmaxer <command> --help`.
    details: string[];
    needsToken: boolean;
}

const CATCHUP_WINDOW =
    'Only sessions touched in the last TOKENMAXER_DAYS days (default 3) are ' +
    'scanned. Re-running is safe: each session replaces its own rows on the ' +
    'server, so nothing is double-counted.';

const HOOK_NOTE =
    'Wired into the agent hooks that the setup page generates — you do not ' +
    'normally run this by hand. Errors never fail the host session.';

// Commands you run yourself.
const USER_COMMANDS: CommandDoc[] = [
    {
        name: 'login',
        rows: [['login', 'open a browser login link to manage hackathons']],
        details: [
            'Asks the server for a one-time login link for the account that ' +
                'owns the configured token, prints it, and opens it in your ' +
                'default browser. Use it to create and manage hackathons on ' +
                'the site.',
        ],
        needsToken: true,
    },
    {
        name: 'backfill',
        rows: [
            [
                'backfill [claude|codex|opencode|pi|cursor]',
                'one-time: upload ALL past history (optionally scoped to one source)',
            ],
        ],
        details: [
            'Walks every local session transcript for each supported tool and ' +
                'uploads the cumulative per-session token totals. Cursor has ' +
                'no local transcripts, so its usage is fetched from the ' +
                'cursor.com dashboard API (at most 90 days back); that fetch ' +
                'also covers Grok Bot, which is billed through Cursor.',
            'Name one source to limit the upload to that tool. Re-running is ' +
                'safe: each session replaces its own rows on the server, so ' +
                'nothing is double-counted.',
            'Exits 1 if any rows were rejected or withheld; re-run the same ' +
                'command to repair.',
        ],
        needsToken: true,
    },
    {
        name: 'cursor-sync',
        rows: [['cursor-sync', 'sync recent Cursor dashboard usage']],
        details: [
            'Reads your Cursor login from the local Cursor state database ' +
                '(or the "cursorCookie" entry in config.json as a fallback), ' +
                'fetches recent usage events from cursor.com, and uploads ' +
                'them. Grok Bot turns arrive in the same feed and are ' +
                'uploaded as their own source. The Cursor session token is ' +
                'sent only to cursor.com.',
            CATCHUP_WINDOW,
        ],
        needsToken: true,
    },
    {
        name: 'set-profile-url',
        rows: [
            ['set-profile-url <https-url>', 'set your public profile link'],
            ['set-profile-url --clear', 'clear your public profile link'],
        ],
        details: [
            'Sets the link shown next to your name on the leaderboard. The ' +
                'URL must use https. Pass --clear instead of a URL to remove ' +
                'the link.',
        ],
        needsToken: true,
    },
    {
        name: 'rotate',
        rows: [['rotate', 'replace your token (requires the current one)']],
        details: [
            'Asks the server to issue a new token in exchange for the current ' +
                'one. The old token stops working immediately. The new token ' +
                'is printed and saved to config.json.',
            'If TOKENMAXER_TOKEN is set in the environment it overrides the ' +
                'file, so update or unset it afterwards. The request times ' +
                'out after TOKENMAXER_ROTATE_TIMEOUT_MS (default 10000).',
        ],
        needsToken: true,
    },
    {
        name: 'whoami',
        rows: [['whoami', 'print the username for the configured token']],
        details: [
            'Looks up which account the configured token belongs to and ' +
                'prints its username. Run it after install or rotate to ' +
                'confirm the token works.',
        ],
        needsToken: true,
    },
    {
        name: 'version',
        rows: [['version', 'print the reporter version']],
        details: [
            'Prints the installed reporter version and exits. --version and ' +
                '-v do the same.',
        ],
        needsToken: false,
    },
    {
        name: 'help',
        rows: [['help [command]', 'show this help']],
        details: [
            'With no argument, lists every command. With a command name, ' +
                'shows what that command does, the same as running the ' +
                'command with --help or -h.',
        ],
        needsToken: false,
    },
];

// Commands wired into agent hooks (SessionStart/SessionEnd) — not run by hand.
const HOOK_COMMANDS: CommandDoc[] = [
    {
        name: 'claude-sessionend',
        rows: [
            [
                'claude-sessionend',
                'parse the just-ended Claude transcript (stdin JSON)',
            ],
        ],
        details: [
            'Reads the Claude Code SessionEnd hook payload from stdin, takes ' +
                'its transcript_path, and reports the whole session it ' +
                'belongs to (a session can span several files, including ' +
                'subagent transcripts). Recent sessions are caught up at the ' +
                'same time. Without a payload it behaves like ' +
                'claude-sessionstart.',
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'claude-sessionstart',
        rows: [['claude-sessionstart', 'catch up recent Claude sessions']],
        details: [
            'Scans local Claude Code transcripts and uploads per-session ' +
                'totals for any that changed recently, so sessions that ended ' +
                'without a hook firing are still counted.',
            CATCHUP_WINDOW,
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'codex-sessionstart',
        aliases: ['codex-sessionend'],
        rows: [['codex-sessionstart', 'catch up recent Codex sessions']],
        details: [
            'Scans local Codex rollout files and uploads per-session totals ' +
                'for any that changed recently. codex-sessionend is an alias.',
            CATCHUP_WINDOW,
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'opencode-sessionstart',
        aliases: ['opencode-sessionend'],
        rows: [['opencode-sessionstart', 'catch up recent opencode sessions']],
        details: [
            'Reads recent sessions from the local opencode database and ' +
                'uploads their per-session totals. opencode-sessionend is an ' +
                'alias.',
            CATCHUP_WINDOW,
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'pi-sessionstart',
        aliases: ['pi-sessionend'],
        rows: [['pi-sessionstart', 'catch up recent pi sessions']],
        details: [
            'Scans local pi session files and uploads per-session totals ' +
                'for any that changed recently. pi-sessionend is an alias.',
            CATCHUP_WINDOW,
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'claude-report',
        rows: [
            ['claude-report <path>', 'parse and report one Claude transcript'],
        ],
        details: [
            'Parses one Claude Code transcript and reports the complete ' +
                'session it belongs to, including sibling files that share ' +
                'the session id. Exits 1 if the path does not exist.',
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'codex-report',
        rows: [['codex-report <path>', 'parse and report one Codex rollout']],
        details: [
            'Parses one Codex rollout file and reports its session totals.',
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'opencode-report',
        rows: [
            [
                'opencode-report <sessionID>',
                'parse and report one opencode session',
            ],
        ],
        details: [
            'Reads one session by id from the local opencode database and ' +
                'reports its totals.',
            HOOK_NOTE,
        ],
        needsToken: true,
    },
    {
        name: 'pi-report',
        rows: [['pi-report <path>', 'parse and report one pi session file']],
        details: [
            'Parses one pi session file and reports its session totals.',
            HOOK_NOTE,
        ],
        needsToken: true,
    },
];

const ALL_COMMANDS: CommandDoc[] = [...USER_COMMANDS, ...HOOK_COMMANDS];

function fmtRows(docs: CommandDoc[], pad: number): string[] {
    return docs.flatMap((doc) =>
        doc.rows.map(([c, d]) => `  ${c.padEnd(pad)}  ${d}`),
    );
}

function printHelp(): void {
    const pad = Math.max(
        ...ALL_COMMANDS.flatMap((doc) => doc.rows.map(([c]) => c.length)),
    );
    process.stdout.write(
        [
            'tokenmaxer — report per-session token usage to a tokenmaxer leaderboard.',
            '',
            'Usage: tokenmaxer <command> [args] [--dry-run]',
            '       tokenmaxer <command> --help',
            '       tokenmaxer --version | -v',
            '',
            'Commands you run:',
            ...fmtRows(USER_COMMANDS, pad),
            '',
            'Hook commands (wired into agent SessionStart/SessionEnd; not run by hand):',
            ...fmtRows(HOOK_COMMANDS, pad),
            '',
            'Run `tokenmaxer <command> --help` for details on one command.',
            'Append --dry-run to any command to print payloads instead of sending.',
            '',
            'Config: ~/.tokenmaxer/config.json => { "apiBase": "https://...", "token": "tt_..." }',
            '  (env TOKENMAXER_API_BASE / TOKENMAXER_TOKEN override the file.)',
            'Get a token and hooks at <https://tokenmaxer.quest/start>.',
            '',
        ].join('\n'),
    );
}

// Wrap a paragraph at `width` columns for terminal output.
export function wrap(text: string, width = 78): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/u)) {
        if (!word) continue;
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function printCommandHelp(doc: CommandDoc): void {
    const [first] = doc.rows;
    const summary = first ? first[1] : '';
    const out: string[] = [`tokenmaxer ${doc.name} — ${summary}`, '', 'Usage:'];
    for (const [syntax] of doc.rows) {
        out.push(
            `  tokenmaxer ${syntax}${doc.needsToken ? ' [--dry-run]' : ''}`,
        );
    }
    if (doc.aliases?.length) {
        out.push(
            `  (also: ${doc.aliases.map((a) => `tokenmaxer ${a}`).join(', ')})`,
        );
    }
    for (const para of doc.details) {
        out.push('', ...wrap(para));
    }
    out.push('');
    if (doc.needsToken) {
        out.push(
            ...wrap(
                'Needs a token: ~/.tokenmaxer/config.json or the ' +
                    'TOKENMAXER_TOKEN / TOKENMAXER_API_BASE environment ' +
                    'variables. Append --dry-run to print the exact request ' +
                    'instead of sending it.',
            ),
        );
    } else {
        out.push('Needs no token or network access.');
    }
    out.push('');
    process.stdout.write(out.join('\n'));
}

const HELP_FLAGS = new Set<string | undefined>([
    'help',
    '--help',
    '-h',
    undefined,
]);

const VERSION_FLAGS = new Set<string | undefined>([
    'version',
    '--version',
    '-v',
]);

const COMMAND_HELP_FLAGS = new Set<string>(['--help', '-h']);

function findCommand(name: string | undefined): CommandDoc | undefined {
    return ALL_COMMANDS.find(
        (doc) =>
            doc.name === name || doc.aliases?.includes(name ?? '') === true,
    );
}

// `tokenmaxer <command> --help|-h [anything…]` and `tokenmaxer help <command>`
// both show that command's help. Any other arguments are ignored. Must run
// before config loading so help never needs a token. Returns `true` when the
// request was a help request (even for an unknown command) and was handled.
function handleCommandHelp(argv: string[]): boolean {
    const [cmd, ...rest] = argv;
    const wantsHelp = rest.some((arg) => COMMAND_HELP_FLAGS.has(arg));
    const asked =
        cmd === 'help'
            ? wantsHelp
                ? 'help'
                : rest[0]
            : wantsHelp
              ? cmd
              : undefined;
    if (asked === undefined) return false;
    const doc = findCommand(asked);
    if (doc) {
        printCommandHelp(doc);
        return true;
    }
    process.stderr.write(
        `tokenmaxer: unknown command "${asked}" — run \`tokenmaxer help\` to list commands\n`,
    );
    return true;
}

function userCommand(
    cmd: string | undefined,
): (() => Promise<void>) | undefined {
    const userCmds: Record<string, () => Promise<void>> = {
        'set-profile-url': () => runSetProfileUrl(process.argv.slice(3)),
        rotate: () => runRotate(process.argv.slice(3)),
        whoami: () => runWhoami(process.argv.slice(3)),
        login: () => runLogin(),
    };
    if (cmd === undefined || !Object.hasOwn(userCmds, cmd)) return undefined;
    return userCmds[cmd];
}

// help / version forms that need no config. Returns `true` when handled.
function handleInfoCommands(argv: string[]): boolean {
    if (handleCommandHelp(argv)) return true;
    const [cmd] = argv;
    if (HELP_FLAGS.has(cmd)) {
        printHelp();
        return true;
    }
    if (VERSION_FLAGS.has(cmd)) {
        printVersion();
        return true;
    }
    return false;
}

export async function main(): Promise<void> {
    const cmd = process.argv[2];
    if (handleInfoCommands(process.argv.slice(2))) return;
    const userCmd = userCommand(cmd);
    if (userCmd) {
        await userCmd();
        return;
    }
    const cfg = loadConfig();
    switch (cmd) {
        case 'claude-sessionend':
            await claudeSessionEnd(cfg);
            break;
        case 'claude-sessionstart':
            await claudeCatchup(cfg);
            break;
        case 'codex-sessionstart':
        case 'codex-sessionend':
            await codexCatchup(cfg);
            break;
        case 'opencode-sessionstart':
        case 'opencode-sessionend':
            await opencodeCatchup(cfg);
            break;
        case 'pi-sessionstart':
        case 'pi-sessionend':
            await piCatchup(cfg);
            break;
        case 'claude-report':
            await reportOne(cfg, process.argv[3], 'claude_code');
            break;
        case 'codex-report':
            await reportOne(cfg, process.argv[3], 'codex');
            break;
        case 'opencode-report':
            await reportOneOpencode(cfg, process.argv[3]);
            break;
        case 'pi-report':
            await reportOne(cfg, process.argv[3], 'pi');
            break;
        case 'cursor-sync':
            await cursorSyncCommand(cfg);
            break;
        case 'backfill': {
            // Optional scope: `backfill claude|codex|opencode|pi|cursor`.
            const scope = process.argv[3];
            const only = [
                'claude',
                'codex',
                'opencode',
                'pi',
                'cursor',
            ].includes(scope ?? '')
                ? scope
                : undefined;
            await backfill(cfg, only);
            break;
        }
        default:
            process.stderr.write(
                'usage: tokenmaxer <claude-sessionend|claude-sessionstart|codex-sessionstart|opencode-sessionstart|pi-sessionstart|claude-report <path>|codex-report <path>|opencode-report <sessionID>|pi-report <path>|cursor-sync|backfill [claude|codex|opencode|pi|cursor]|set-profile-url (<https-url>|--clear)|rotate|whoami|version> [--dry-run]\n',
            );
    }
}

// Only run as a CLI when executed directly — importing (tests) must not trigger it.
// argv[1] may be a symlink (global/npx bin); resolve it so import.meta.url matches.
export function invokedDirectlyAs(argvPath: string | undefined): boolean {
    if (typeof argvPath !== 'string') return false;
    let resolved = argvPath;
    try {
        resolved = realpathSync(argvPath);
    } catch {
        // fall back to the raw path
    }
    return import.meta.url === pathToFileURL(resolved).href;
}
