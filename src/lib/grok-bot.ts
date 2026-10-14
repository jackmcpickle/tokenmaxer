import type { SessionUsageInput, Source } from '@/types';

// Grok Bot is a Cursor (Anysphere) product: it is billed through the Cursor
// account and arrives in the same dashboard usage feed as editor usage, told
// apart only by the model name (`grok-bot-default`, `grok-bot-automation`,
// `grok-bot-cua`; early builds used the codename `sand-*`). Grok models used
// inside the editor (`grok-4.7-high`, `cursor-grok-4.6-high-fast`) are
// ordinary Cursor usage and must not match.
//
// Mirrors reporter/src/lib/grok-bot.ts. Reporters older than the split still
// upload Grok Bot rows as Cursor; the partition below re-tags them on ingest
// so an un-upgraded hook cannot resurrect them under the wrong source.
const GROK_BOT_MODEL = /^(?:grok-bot|sand)(?:-|$)/iu;

const CURSOR_SESSION_PREFIX = 'cursor-';
const GROK_BOT_SESSION_PREFIX = 'grok-bot-';

export function isGrokBotModel(model: string): boolean {
    return GROK_BOT_MODEL.test(model.trim());
}

/** `cursor-<UTC day>` -> `grok-bot-<UTC day>`; any other id is kept as is. */
export function grokBotSessionId(sessionId: string): string {
    return sessionId.startsWith(CURSOR_SESSION_PREFIX)
        ? `${GROK_BOT_SESSION_PREFIX}${sessionId.slice(CURSOR_SESSION_PREFIX.length)}`
        : sessionId;
}

export interface IngestGroup {
    source: Source;
    sessions: SessionUsageInput[];
    replaceSessions: string[];
}

/**
 * Split one validated upload into the groups that are actually stored, one
 * per source. Only `cursor` payloads are touched: Grok Bot rows move to
 * `grok_bot` under the matching `grok-bot-<day>` session.
 *
 * A claimed `cursor-<day>` means the reporter re-summed that whole day, Grok
 * Bot included, so it also claims `grok-bot-<day>`, even when this batch
 * carries none of that day's Bot rows. A legacy reporter may send them in a
 * later, unclaimed batch, and without the claim the stale Bot rows would
 * never be cleared. An upgraded reporter posts its Grok Bot rows (with their
 * own claim) right after the Cursor post, so the brief gap self-heals.
 *
 * The Cursor group keeps its claims even when every row moved away: the day
 * was fully re-reported and has no editor usage left, so its stale Cursor
 * rows must go. Empty groups are dropped by the caller.
 */
export function partitionGrokBot(
    source: Source,
    sessions: readonly SessionUsageInput[],
    replaceSessions: readonly string[],
): IngestGroup[] {
    if (source !== 'cursor') {
        return [
            {
                source,
                sessions: [...sessions],
                replaceSessions: [...replaceSessions],
            },
        ];
    }
    const cursor: SessionUsageInput[] = [];
    const grokBot: SessionUsageInput[] = [];
    for (const s of sessions) {
        if (isGrokBotModel(s.model)) {
            grokBot.push({ ...s, session_id: grokBotSessionId(s.session_id) });
        } else {
            cursor.push(s);
        }
    }
    return [
        {
            source: 'cursor',
            sessions: cursor,
            replaceSessions: [...replaceSessions],
        },
        {
            source: 'grok_bot',
            sessions: grokBot,
            replaceSessions: replaceSessions
                .filter((id) => id.startsWith(CURSOR_SESSION_PREFIX))
                .map(grokBotSessionId),
        },
    ];
}
