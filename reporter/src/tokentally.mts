#!/usr/bin/env node
// tokenmaxer reporter — TypeScript source compiled to a zero-dependency .mjs.
//
// Reads Claude Code / Codex session transcripts, sums token usage per model, and
// POSTs cumulative per-session totals to the tokenmaxer.quest API. Reporting is
// idempotent (keyed by session id), so running it on SessionStart and SessionEnd
// can never double-count.
//
// What leaves the machine: per-session token counts, model names, session ids,
// and timestamps — never prompts, code, file paths, or credentials. Append
// --dry-run to any command to print the exact payloads instead of sending them.
// The Cursor session cookie (when used) is sent only to cursor.com.
//
// Config: ~/.tokenmaxer/config.json  =>  { "apiBase": "https://...", "token": "tt_..." }
// (env TOKENMAXER_API_BASE / TOKENMAXER_TOKEN override the file.)
// Legacy fallbacks: ~/.tokentally/config.json and TOKENTALLY_* env vars.
//
// Usage:
//   tokenmaxer claude-sessionend        # hook: parse the just-ended transcript (stdin JSON)
//   tokenmaxer claude-sessionstart      # hook: catch up recent Claude sessions
//   tokenmaxer codex-sessionstart       # hook: catch up recent Codex sessions
//   tokenmaxer opencode-sessionstart    # hook: catch up recent opencode sessions
//   tokenmaxer pi-sessionstart          # hook: catch up recent pi sessions
//   tokenmaxer claude-report <path>     # parse one Claude transcript
//   tokenmaxer codex-report <path>      # parse one Codex rollout
//   tokenmaxer opencode-report <sessID> # parse one opencode session
//   tokenmaxer pi-report <path>         # parse one pi session file
//   tokenmaxer cursor-sync              # sync recent Cursor dashboard usage
//   tokenmaxer backfill [claude|codex|opencode|pi|cursor] # one-time: upload ALL past history
//   tokenmaxer set-profile-url <https-url>|--clear # set or clear public profile link

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// ------------------------------------------------------------------ types ----

export interface ReporterTotals {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    reasoning_tokens: number;
}

export interface ParsedTranscript {
    session_id: string | null;
    started_at: number | null;
    models: Map<string, ReporterTotals>;
}

export interface CodexPendingUsage {
    model: string;
    last: Record<string, unknown>;
}

export interface ParsedCodexRollout extends ParsedTranscript {
    parent_id: string | null;
    pending_inherited: CodexPendingUsage[];
}

export interface ReporterRow extends ReporterTotals {
    session_id: string;
    model: string;
    started_at: number;
}

export interface ReporterConfig {
    apiBase: string;
    token: string;
    cursorCookie?: string;
}

interface ParseOpts {
    sessionId?: string;
    fallbackStartedAt?: number | null;
}

type TotalsKey = keyof ReporterTotals;

interface ClaudeUsageRow {
    key: string | null;
    model: string;
    usage: ReporterTotals;
}

interface CodexParseState {
    sessionId: string | null;
    startedAt: number | null;
    currentModel: string;
    metaSeen: boolean;
    parentId: string | null;
    parentSpawn: boolean;
    inherited: boolean;
    pending: CodexPendingUsage[];
}

interface PiParseState {
    sessionId: string | null;
    startedAt: number | null;
    currentModel: string;
}

interface InheritedRun {
    consumed: number;
    matched: number;
    distinctive: boolean;
    steps: number;
}

interface PostOpts {
    path?: string;
    chunkSize?: number;
}

interface CursorSyncOpts {
    sinceMs?: number;
    post?: PostOpts;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
    return value !== null && typeof value === 'object'
        ? (value as JsonObject)
        : {};
}

const CATCHUP_DAYS =
    Number.parseInt(
        process.env.TOKENMAXER_DAYS ?? process.env.TOKENTALLY_DAYS ?? '3',
        10,
    ) || 3;
const MAX_SESSIONS_PER_REQUEST = 200;
// Bulk history backfill posts to a separate endpoint in larger chunks.
const HISTORY_CHUNK = 500;
// --dry-run (any command): print the exact payloads to stdout instead of POSTing.
const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) process.argv = process.argv.filter((a) => a !== '--dry-run');

// ---------------------------------------------------------------- parsing ----

function emptyTotals(): ReporterTotals {
    return {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
    };
}

function toMs(ts: unknown): number | null {
    if (typeof ts !== 'string') return null;
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : null;
}

/** Yield each parseable JSON object from a JSONL text, skipping bad lines. */
function* jsonlObjects(text: string): Generator<JsonObject> {
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (parsed !== null && typeof parsed === 'object') {
                yield parsed as JsonObject;
            }
        } catch {
            /* skip unparseable line */
        }
    }
}

// One assistant transcript line's usage, or null when it carries none.
// `key` is `${message.id}:${requestId}` when either id is present; streamed
// chunks of one API message share it, so keyed rows dedupe last-wins.
function claudeUsageRow(obj: JsonObject): ClaudeUsageRow | null {
    if (obj.type !== 'assistant') return null;
    const msg = asObject(obj.message);
    const usage = asObject(msg.usage);
    if (!msg.usage || typeof msg.usage !== 'object') return null;
    const messageId = typeof msg.id === 'string' ? msg.id : '';
    const requestId = typeof obj.requestId === 'string' ? obj.requestId : '';
    return {
        key: messageId || requestId ? `${messageId}:${requestId}` : null,
        model:
            typeof msg.model === 'string' && msg.model ? msg.model : 'unknown',
        usage: {
            input_tokens: num(usage.input_tokens),
            output_tokens: num(usage.output_tokens),
            cache_read_tokens: num(usage.cache_read_input_tokens),
            cache_creation_tokens: num(usage.cache_creation_input_tokens),
            reasoning_tokens: 0,
        },
    };
}

function sumClaudeRows(rows: ClaudeUsageRow[]): Map<string, ReporterTotals> {
    const models = new Map<string, ReporterTotals>();
    for (const { model, usage } of rows) {
        const t = models.get(model) ?? emptyTotals();
        for (const k of Object.keys(usage) as TotalsKey[]) t[k] += usage[k];
        models.set(model, t);
    }
    return models;
}

/**
 * Parse a Claude Code transcript (JSONL). One transcript = one session that may
 * touch several models. Returns { session_id, started_at, models: {model: totals} }.
 *
 * Streaming writes several transcript lines per API message, each carrying
 * cumulative usage; rows sharing a `message.id`/`requestId` key are deduped
 * last-wins so only the final chunk counts. Rows without either id can never
 * collide and are all kept.
 */
export function parseClaudeTranscript(
    text: string,
    opts: ParseOpts = {},
): ParsedTranscript {
    let sessionId = opts.sessionId ?? null;
    let startedAt: number | null = null;
    const keyed = new Map<string, ClaudeUsageRow>();
    const unkeyed: ClaudeUsageRow[] = [];

    for (const obj of jsonlObjects(text)) {
        if (startedAt === null) startedAt = toMs(obj.timestamp);
        if (!sessionId && typeof obj.sessionId === 'string')
            sessionId = obj.sessionId;
        const row = claudeUsageRow(obj);
        if (!row) continue;
        if (row.key === null) unkeyed.push(row);
        else keyed.set(row.key, row);
    }

    const models = sumClaudeRows([...keyed.values(), ...unkeyed]);

    return {
        session_id: sessionId ?? opts.sessionId ?? null,
        started_at: startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}

function addCodexUsage(
    models: Map<string, ReporterTotals>,
    model: string,
    last: Record<string, unknown>,
): void {
    const t = models.get(model) ?? emptyTotals();
    t.input_tokens += num(last.input_tokens);
    t.output_tokens += num(last.output_tokens);
    t.cache_read_tokens += num(last.cached_input_tokens);
    t.cache_creation_tokens += num(last.cache_write_input_tokens);
    t.reasoning_tokens += num(last.reasoning_output_tokens);
    models.set(model, t);
}

// Codex subagent/fork children replay part of the parent rollout's history —
// including its token_count events — before their own first turn. Counting
// those would double-count usage already reported under the parent session
// (the parent and child have distinct session ids, so server idempotency
// cannot catch it).
//
// `spawn: true` (thread-spawn subagents) means the file carries a trigger_turn
// boundary marker separating replay from real usage. Forks have no such
// marker of their own — a later trigger_turn in a fork's file would be from
// the fork spawning its own subagent — so they are always resolved against
// the parent rollout at EOF instead.
function codexParentMeta(
    payload: JsonObject,
): { id: string; spawn: boolean } | null {
    const source = asObject(payload.source);
    const subagent = asObject(source.subagent);
    const threadSpawn = asObject(subagent.thread_spawn);
    const spawnId = threadSpawn.parent_thread_id ?? subagent.parent_thread_id;
    if (typeof spawnId === 'string' && spawnId)
        return { id: spawnId, spawn: true };
    const forkId = source.forked_from_id ?? payload.forked_from_id;
    if (typeof forkId === 'string' && forkId)
        return { id: forkId, spawn: false };
    return null;
}

// Multi-agent v2 rollouts mark the child's first real turn with an
// inter_agent_communication_metadata event carrying trigger_turn: true.
// Everything before it is replayed parent history.
function isCodexTurnBoundary(obj: JsonObject, payload: JsonObject): boolean {
    if (
        obj.type !== 'inter_agent_communication_metadata' &&
        !(
            obj.type === 'event_msg' &&
            payload.type === 'inter_agent_communication_metadata'
        )
    ) {
        return false;
    }
    const info = asObject(payload.info);
    return payload.trigger_turn === true || info.trigger_turn === true;
}

function applyCodexSessionMeta(
    payload: JsonObject,
    state: CodexParseState,
): void {
    if (typeof payload.id === 'string')
        state.sessionId = state.sessionId ?? payload.id;
    const m = modelFromContext(payload);
    if (m) state.currentModel = m;
    // Only the file's own (first) session_meta can declare this session's
    // parent. Later session_meta lines — appended on resume, or the parent's
    // own meta inside replayed history — must not (re-)arm inheritance: after
    // the boundary that would divert genuine child usage into pending, and a
    // replayed grandparent id would make prefix matching hit the wrong file.
    if (state.metaSeen) return;
    state.metaSeen = true;
    const parent = codexParentMeta(payload);
    if (parent) {
        state.parentId = parent.id;
        state.parentSpawn = parent.spawn;
        state.inherited = true;
    }
}

function applyCodexTurnContext(
    payload: JsonObject,
    state: CodexParseState,
): void {
    const m = modelFromContext(payload);
    if (m) state.currentModel = m;
}

function processCodexLine(
    obj: JsonObject,
    state: CodexParseState,
    models: Map<string, ReporterTotals>,
): void {
    if (state.startedAt === null) state.startedAt = toMs(obj.timestamp);
    const payload = asObject(obj.payload);

    if (obj.type === 'session_meta') {
        applyCodexSessionMeta(payload, state);
        return;
    }
    if (obj.type === 'turn_context') {
        applyCodexTurnContext(payload, state);
        return;
    }
    // The boundary marker only delimits a thread-spawn child's own replay;
    // forks resolve against the parent rollout at EOF instead. The first
    // marker in a spawn child's file is its own spawn boundary: replayed
    // parent history does not carry markers, and markers from the child's
    // own later subagent activity can only appear after this one has
    // disarmed inheritance (v1 files predate the marker entirely and never
    // contain one, so they always take the EOF resolution path).
    if (
        state.inherited &&
        state.parentSpawn &&
        isCodexTurnBoundary(obj, payload)
    ) {
        dropInheritedPending(state, models);
        return;
    }
    if (obj.type === 'event_msg' && payload.type === 'token_count') {
        const info = asObject(payload.info);
        const last = info.last_token_usage;
        if (!last || typeof last !== 'object') return;
        if (state.inherited) {
            // Possibly replayed parent history — hold until the turn boundary
            // (dropped there) or EOF (resolved against the parent rollout).
            state.pending.push({
                model: state.currentModel,
                last: last as Record<string, unknown>,
            });
            return;
        }
        addCodexUsage(
            models,
            state.currentModel,
            last as Record<string, unknown>,
        );
    }
}

// Discard held replay, but keep a zero-total row for every model it touched:
// the pre-fix reporter posted the replayed usage under those (session, model)
// keys, and the server upsert can only overwrite the inflated rows if a
// corrected report still submits them.
function dropInheritedPending(
    state: CodexParseState,
    models: Map<string, ReporterTotals>,
): void {
    for (const { model } of state.pending) {
        if (!models.has(model)) models.set(model, emptyTotals());
    }
    state.pending.length = 0;
    state.inherited = false;
}

/**
 * Parse a Codex rollout (JSONL). Attributes each turn's `last_token_usage` to the
 * model active at that point (from session_meta / turn_context).
 *
 * Subagent/fork children (session_meta declares a parent) replay parent token
 * history before their own first turn; those events are excluded at the
 * trigger_turn boundary. Legacy children without the boundary marker return
 * the held events in `pending_inherited` plus `parent_id` — pass the parent
 * rollout text to resolveCodexInherited() to strip the replayed prefix.
 */
export function parseCodexRollout(
    text: string,
    opts: ParseOpts = {},
): ParsedCodexRollout {
    const models = new Map<string, ReporterTotals>();
    const state: CodexParseState = {
        sessionId: opts.sessionId ?? null,
        startedAt: null,
        currentModel: 'unknown',
        metaSeen: false,
        parentId: null,
        parentSpawn: false,
        inherited: false,
        pending: [],
    };

    for (const obj of jsonlObjects(text)) {
        processCodexLine(obj, state, models);
    }

    return {
        session_id: state.sessionId ?? opts.sessionId ?? null,
        started_at: state.startedAt ?? opts.fallbackStartedAt ?? null,
        models,
        parent_id: state.parentId,
        // Emptied at the boundary, so anything left is unresolved held usage.
        pending_inherited: state.pending,
    };
}

function codexUsageKey(last: Record<string, unknown>): string {
    return [
        num(last.input_tokens),
        num(last.cached_input_tokens),
        num(last.cache_write_input_tokens),
        num(last.output_tokens),
        num(last.reasoning_output_tokens),
    ].join('|');
}

/** Ordered token-count tuple sequence of a rollout, for parent-prefix matching. */
function codexTokenSequence(text: string): string[] {
    const keys: string[] = [];
    for (const obj of jsonlObjects(text)) {
        const payload = asObject(obj.payload);
        if (obj.type !== 'event_msg' || payload.type !== 'token_count')
            continue;
        const last = asObject(payload.info).last_token_usage;
        if (last && typeof last === 'object')
            keys.push(codexUsageKey(last as Record<string, unknown>));
    }
    return keys;
}

// A tuple with real input is very unlikely to repeat by coincidence; all-zero
// or output-only tuples can.
function isDistinctiveKey(key: string): boolean {
    return !key.startsWith('0|');
}

// Walk childKeys against parentKeys starting at parentKeys[start]. Replayed
// prefixes occasionally carry a token_count row duplicated back-to-back that
// the parent's own file has only once; a strict positional walk would stop at
// the duplicate and leave the whole inherited prefix counted. A child tuple
// equal to the immediately preceding child tuple is therefore consumed
// without advancing the parent. Skipped duplicates count toward `consumed`
// (they are replayed rows and must be dropped with the rest) but never
// toward `matched` — the evidence thresholds and the distinctive-tuple
// requirement are measured on genuine parent matches only, so the tolerance
// does not weaken the bar. Every comparison, including a skip, is charged
// one step against `budget`.
function matchInheritedRun(
    parentKeys: string[],
    childKeys: string[],
    start: number,
    budget: number,
): InheritedRun {
    const run: InheritedRun = {
        consumed: 0,
        matched: 0,
        distinctive: false,
        steps: 0,
    };
    let p = start;
    while (run.consumed < childKeys.length && run.steps < budget) {
        run.steps += 1;
        const key = childKeys[run.consumed];
        if (key === undefined) break;
        if (p < parentKeys.length && parentKeys[p] === key) {
            run.matched += 1;
            if (isDistinctiveKey(key)) run.distinctive = true;
            run.consumed += 1;
            p += 1;
        } else if (run.consumed > 0 && key === childKeys[run.consumed - 1]) {
            run.consumed += 1;
        } else {
            break;
        }
    }
    return run;
}

// Replayed history is the parent's rollout from its beginning up to the
// spawn/fork point, so a genuine replay normally matches the parent's own
// initial token sequence — the comparison is anchored at the parent's start
// so a coincidental value match elsewhere in the parent (identical small
// turns are common) cannot silently discard genuine child usage. When the
// anchor misses (parent file compacted since the spawn, or the parent is
// itself a subagent whose file starts with its own inherited replay), an
// interior match is accepted only with stronger evidence: at least three
// matched tuples. Either way the matched run must contain a distinctive
// tuple — real replay always carries input-bearing turns, while all-zero or
// output-only tuples are exactly the ones that repeat by coincidence. A
// single-event match may always be coincidence and is never dropped — the
// cost is at most one duplicated turn for a parent that spawned after a
// single turn, which the source audit also treated as unconfirmable.
// Adjacent duplicate child tuples are tolerated (see matchInheritedRun); the
// returned length counts child events consumed, duplicates included, while
// the thresholds count genuine parent matches only.
function inheritedPrefixLength(
    parentKeys: string[],
    childKeys: string[],
): number {
    const anchored = matchInheritedRun(parentKeys, childKeys, 0, Infinity);
    if (anchored.matched >= 2 && anchored.distinctive) return anchored.consumed;

    // Bound the interior scan: a pathological parent full of repeated
    // non-distinctive tuples must not turn a session-end hook quadratic.
    // On exhaustion, fall through with the best run found so far (counting
    // is the safe direction).
    let steps = 200_000;
    let best: InheritedRun | null = null;
    for (let i = 1; i < parentKeys.length && steps > 0; i += 1) {
        steps -= 1;
        if (parentKeys[i] !== childKeys[0]) continue;
        const run = matchInheritedRun(parentKeys, childKeys, i, steps);
        steps -= run.steps;
        if (
            best === null ||
            run.matched > best.matched ||
            (run.matched === best.matched && run.consumed > best.consumed)
        ) {
            best = run;
        }
    }
    if (best !== null && best.matched >= 3 && best.distinctive)
        return best.consumed;
    return 0;
}

/**
 * Resolve a child rollout's held token events (a legacy thread-spawn file
 * without the trigger_turn marker, or any fork). The initial run matching the
 * parent rollout's own initial token sequence is replayed parent history and
 * is dropped; the remainder is genuine child usage and is counted. `parent`
 * is the parent rollout's text (or its precomputed token sequence); without
 * it (parent not found locally) everything is counted, preserving the old
 * behaviour.
 */
export function resolveCodexInherited(
    parsed: ParsedCodexRollout,
    parent?: string | string[] | null,
): ParsedCodexRollout {
    const pending = parsed.pending_inherited ?? [];
    if (pending.length === 0) return parsed;
    const parentKeys = Array.isArray(parent)
        ? parent
        : typeof parent === 'string' && parent
          ? codexTokenSequence(parent)
          : [];
    const drop = inheritedPrefixLength(
        parentKeys,
        pending.map((p) => codexUsageKey(p.last)),
    );
    // Zero-total rows for dropped models keep the server upsert able to
    // overwrite rows the pre-fix reporter inflated for this session.
    for (const { model } of pending.slice(0, drop)) {
        if (!parsed.models.has(model)) parsed.models.set(model, emptyTotals());
    }
    for (const { model, last } of pending.slice(drop)) {
        addCodexUsage(parsed.models, model, last);
    }
    parsed.pending_inherited = [];
    return parsed;
}

function modelFromContext(payload: JsonObject): string | null {
    if (typeof payload.model === 'string' && payload.model)
        return payload.model;
    const nested =
        asObject(payload.turn_context).model ?? asObject(payload.info).model;
    return typeof nested === 'string' && nested ? nested : null;
}

function opencodeTimestamp(msg: JsonObject): number | null {
    const time = asObject(msg.time);
    const created = time.created ?? time.start ?? msg.timestamp;
    return typeof created === 'number' ? created : toMs(created);
}

// Written defensively — opencode has revised its message shape, so both nested
// (`tokens.cache.read`) and flat (`cache_read`) keys are tolerated.
function accumulateOpencodeTokens(
    models: Map<string, ReporterTotals>,
    msg: JsonObject,
): void {
    const tokens = asObject(msg.tokens);
    if (!msg.tokens || typeof msg.tokens !== 'object') return;
    const model =
        typeof msg.modelID === 'string' && msg.modelID
            ? msg.modelID
            : 'unknown';
    const cache = asObject(tokens.cache);
    const t = models.get(model) ?? emptyTotals();
    t.input_tokens += num(tokens.input);
    t.output_tokens += num(tokens.output);
    t.reasoning_tokens += num(tokens.reasoning);
    t.cache_read_tokens += num(cache.read ?? tokens.cache_read);
    t.cache_creation_tokens += num(cache.write ?? tokens.cache_write);
    models.set(model, t);
}

/**
 * Parse a set of opencode assistant messages (each `msg_*.json` under
 * `storage/message/<sessionID>/` is one message object). Sums the `tokens.*`
 * block per model.
 */
export function parseOpencodeMessages(
    messages: unknown[],
    opts: ParseOpts = {},
): ParsedTranscript {
    const models = new Map<string, ReporterTotals>();
    let sessionId = opts.sessionId ?? null;
    let startedAt: number | null = null;

    for (const raw of messages) {
        if (!raw || typeof raw !== 'object') continue;
        const msg = raw as JsonObject;
        if (!sessionId && typeof msg.sessionID === 'string')
            sessionId = msg.sessionID;
        const ts = opencodeTimestamp(msg);
        if (ts !== null && (startedAt === null || ts < startedAt))
            startedAt = ts;
        if (msg.role === 'assistant') accumulateOpencodeTokens(models, msg);
    }

    return {
        session_id: sessionId ?? opts.sessionId ?? null,
        started_at: startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}

/**
 * Bucket Cursor dashboard usage events by UTC day + model into session rows.
 * One synthetic session per day ("cursor-YYYY-MM-DD"); re-summing a whole day
 * on every run keeps ingestion idempotent (server upserts by session+model).
 */
export function parseCursorEvents(events: unknown[]): ReporterRow[] {
    // 'YYYY-MM-DD' -> Map(model -> totals)
    const days = new Map<string, Map<string, ReporterTotals>>();
    for (const raw of Array.isArray(events) ? events : []) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as JsonObject;
        const ms = Number(e.timestamp);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        const u = asObject(e.tokenUsage);
        if (!e.tokenUsage || typeof e.tokenUsage !== 'object') continue;
        const day = new Date(ms).toISOString().slice(0, 10);
        const model =
            typeof e.model === 'string' && e.model ? e.model : 'unknown';
        const byModel = days.get(day) ?? new Map<string, ReporterTotals>();
        const t = byModel.get(model) ?? emptyTotals();
        t.input_tokens += num(u.inputTokens);
        t.output_tokens += num(u.outputTokens);
        t.cache_read_tokens += num(u.cacheReadTokens);
        t.cache_creation_tokens += num(u.cacheWriteTokens);
        byModel.set(model, t);
        days.set(day, byModel);
    }
    const rows: ReporterRow[] = [];
    for (const [day, byModel] of days) {
        const startedAt = Date.parse(`${day}T00:00:00Z`);
        for (const [model, t] of byModel) {
            rows.push({
                session_id: `cursor-${day}`,
                model,
                started_at: startedAt,
                ...t,
            });
        }
    }
    return rows;
}

function piUsage(obj: JsonObject): JsonObject | null {
    if (obj.usage && typeof obj.usage === 'object') return asObject(obj.usage);
    const nested = asObject(obj.message).usage;
    return nested && typeof nested === 'object' ? asObject(nested) : null;
}

function piModel(obj: JsonObject): string | null {
    const m =
        obj.model ??
        obj.modelID ??
        asObject(obj.message).model ??
        asObject(obj.usage).model;
    return typeof m === 'string' && m ? m : null;
}

function piSessionId(obj: JsonObject): string | null {
    if (typeof obj.sessionId === 'string') return obj.sessionId;
    if (typeof obj.session_id === 'string') return obj.session_id;
    return null;
}

function accumulatePiUsage(t: ReporterTotals, usage: JsonObject): void {
    t.input_tokens += num(usage.input ?? usage.input_tokens);
    t.output_tokens += num(usage.output ?? usage.output_tokens);
    t.cache_read_tokens += num(
        usage.cacheRead ?? usage.cache_read ?? usage.cache_read_input_tokens,
    );
    t.cache_creation_tokens += num(
        usage.cacheWrite ??
            usage.cache_write ??
            usage.cache_creation_input_tokens,
    );
    t.reasoning_tokens += num(
        usage.reasoning ??
            usage.reasoning_tokens ??
            usage.reasoning_output_tokens,
    );
}

function processPiLine(
    obj: JsonObject,
    state: PiParseState,
    models: Map<string, ReporterTotals>,
    seen: Set<string>,
): void {
    if (state.startedAt === null)
        state.startedAt = toMs(obj.timestamp ?? obj.time);
    if (!state.sessionId) state.sessionId = piSessionId(obj);

    const model = piModel(obj);
    if (model) state.currentModel = model;

    const usage = piUsage(obj);
    if (!usage) return;

    // Skip records already counted on another branch of the tree.
    if (typeof obj.id === 'string') {
        if (seen.has(obj.id)) return;
        seen.add(obj.id);
    }

    const t = models.get(state.currentModel) ?? emptyTotals();
    accumulatePiUsage(t, usage);
    models.set(state.currentModel, t);
}

/**
 * Parse a pi session file (JSONL). pi stores a *tree* of records keyed by
 * `id`/`parentId` in one file, so the same record can appear more than once —
 * we dedupe by `id` before summing each record's `usage` per active model.
 */
export function parsePiRollout(
    text: string,
    opts: ParseOpts = {},
): ParsedTranscript {
    const models = new Map<string, ReporterTotals>();
    const seen = new Set<string>();
    const state: PiParseState = {
        sessionId: opts.sessionId ?? null,
        startedAt: null,
        currentModel: 'unknown',
    };

    for (const obj of jsonlObjects(text)) {
        processPiLine(obj, state, models, seen);
    }

    return {
        session_id: state.sessionId ?? opts.sessionId ?? null,
        started_at: state.startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}

function num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0
        ? Math.floor(v)
        : 0;
}

/** session id from a filename, stripping known prefixes/suffixes. */
export function sessionIdFromPath(path: string): string {
    let name = basename(path).replace(/\.jsonl$/iu, '');
    name = name.replace(/^rollout-/iu, '');
    return name;
}

/** Claude Code `<synthetic>` turns — never report or score. */
function isSyntheticModel(model: unknown): boolean {
    if (typeof model !== 'string') return false;
    const m = model.toLowerCase().trim().replace(/^<|>$/gu, '');
    return m === 'synthetic';
}

/** Turn a parsed result into API session rows (one per model). */
export function toRows(parsed: ParsedTranscript, path?: string): ReporterRow[] {
    const sid = parsed.session_id ?? sessionIdFromPath(path ?? '');
    const startedAt = parsed.started_at ?? Date.now();
    const rows: ReporterRow[] = [];
    for (const [model, t] of parsed.models) {
        if (isSyntheticModel(model)) continue;
        rows.push({ session_id: sid, model, started_at: startedAt, ...t });
    }
    return rows;
}

// ------------------------------------------------------------- filesystem ----

function walkJsonl(
    dir: string,
    sinceMs: number,
    match: (name: string) => boolean,
): string[] {
    const out: string[] = [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...walkJsonl(full, sinceMs, match));
        } else if (e.isFile() && match(e.name)) {
            if (sinceMs <= 0) {
                out.push(full);
                continue;
            }
            try {
                if (statSync(full).mtimeMs >= sinceMs) out.push(full);
            } catch {
                /* ignore */
            }
        }
    }
    return out;
}

function claudeDirs(): string[] {
    const home = homedir();
    return [
        join(home, '.claude', 'projects'),
        join(home, '.config', 'claude', 'projects'),
    ];
}

function codexDirs(): string[] {
    const home = homedir();
    return [
        join(home, '.codex', 'sessions'),
        join(home, '.codex', 'archived_sessions'),
    ];
}

const CODEX_ROLLOUT_FILE = /^rollout-.*\.jsonl$/iu;

// Index of local Codex rollouts by session UUID, used to resolve the
// declared parent of subagent/fork children whose replayed history must be
// matched against the parent rollout. Filenames look like
// rollout-2026-07-18T09-00-00-<uuid>.jsonl; keys are lowercased so lookups
// by parent_thread_id are case-insensitive. Files without a trailing UUID
// are keyed by their stripped name minus any leading timestamp.
let codexRolloutsById: Map<string, string> | null = null;

function fileSize(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return -1;
    }
}

// True when both paths name the same on-disk file, regardless of path
// spelling (case-insensitive filesystems, symlinks, ./ prefixes).
function isSameFile(a: string, b: string): boolean {
    try {
        const sa = statSync(a);
        const sb = statSync(b);
        return sa.dev === sb.dev && sa.ino === sb.ino;
    } catch {
        return resolve(a) === resolve(b);
    }
}

function addCodexRolloutToIndex(map: Map<string, string>, f: string): void {
    const m = basename(f).match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu,
    );
    const key = (
        m?.[1] ??
        sessionIdFromPath(f).replace(
            /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/iu,
            '',
        )
    ).toLowerCase();
    const prev = map.get(key);
    // Duplicate copies of one session (e.g. a stale copy left in
    // archived_sessions): rollouts are append-only, so the larger file has
    // the more complete history — matching against a truncated copy would
    // let replayed events past the truncation point be counted. A file that
    // cannot be stat'ed scores -1, so an unreadable copy never displaces a
    // readable one (and never gets pinned by a failure on the other side).
    if (prev !== undefined && fileSize(f) <= fileSize(prev)) return;
    map.set(key, f);
}

// Backfill already enumerates every rollout; let it seed the index instead
// of paying a second full directory walk on the first parent lookup.
function seedCodexRolloutIndex(files: string[]): void {
    if (codexRolloutsById !== null) return;
    codexRolloutsById = new Map();
    for (const f of files) addCodexRolloutToIndex(codexRolloutsById, f);
}

function codexRolloutPathById(
    id: string,
    nearDir: string | null,
): string | null {
    if (typeof id !== 'string' || !id) return null;
    const lower = id.toLowerCase();
    // Session-end hooks handle a single file; a parent usually sits in the
    // same dated directory as its child, so probe there before paying a
    // full recursive walk of every session directory for one lookup.
    if (codexRolloutsById === null && nearDir) {
        try {
            // Same duplicate rule as addCodexRolloutToIndex: a stale
            // truncated copy of the session may sit beside the complete one,
            // and matching against it would count replayed events past the
            // truncation point. Larger file wins; -1 for an unstattable one.
            let bestPath: string | null = null;
            let bestSize = -1;
            for (const n of readdirSync(nearDir)) {
                if (
                    !CODEX_ROLLOUT_FILE.test(n) ||
                    !n.toLowerCase().includes(lower)
                )
                    continue;
                const full = join(nearDir, n);
                const size = fileSize(full);
                if (bestPath === null || size > bestSize) {
                    bestPath = full;
                    bestSize = size;
                }
            }
            if (bestPath !== null) return bestPath;
        } catch {
            /* fall through to the full index */
        }
    }
    if (codexRolloutsById === null) {
        seedCodexRolloutIndex(
            codexDirs().flatMap((d) =>
                walkJsonl(d, 0, (n) => CODEX_ROLLOUT_FILE.test(n)),
            ),
        );
    }
    return codexRolloutsById?.get(lower) ?? null;
}

// Parent token sequences by session id, memoized so a parent that spawned
// many children is read and tokenized once per run — only sessions actually
// referenced as a parent are ever loaded. Read failures are not cached, so a
// transient error on one child does not leave every later sibling resolving
// against nothing.
const codexSequencesById = new Map<string, string[]>();
export function codexParentSequenceById(
    parentId: string | null | undefined,
    childPath?: string | null,
): string[] | null {
    if (typeof parentId !== 'string' || !parentId) return null;
    const id = parentId.toLowerCase();
    const path = codexRolloutPathById(
        id,
        childPath ? dirname(childPath) : null,
    );
    if (!path) return null;
    // A parent that resolves to the child's own file (self-referential or
    // colliding metadata) must not be matched against — the child's whole
    // sequence would match itself and every token would be dropped. This
    // check must run before the cache (a hit for a legitimate earlier child
    // must not bypass it) and on file identity rather than path spelling:
    // the hook may supply an unnormalized or case-variant path (APFS is
    // case-insensitive) that names the same file under a different string.
    if (childPath && isSameFile(path, childPath)) return null;
    const cached = codexSequencesById.get(id);
    if (cached) return cached;
    let keys: string[];
    try {
        keys = codexTokenSequence(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
    codexSequencesById.set(id, keys);
    return keys;
}

// opencode stores one JSON file per message under storage/message/<sessionID>/.
function opencodeMessageRoots(): string[] {
    const roots: string[] = [];
    if (process.env.OPENCODE_DATA_DIR)
        roots.push(join(process.env.OPENCODE_DATA_DIR, 'storage', 'message'));
    if (process.env.XDG_DATA_HOME)
        roots.push(
            join(process.env.XDG_DATA_HOME, 'opencode', 'storage', 'message'),
        );
    roots.push(
        join(homedir(), '.local', 'share', 'opencode', 'storage', 'message'),
    );
    return roots;
}

// pi stores one JSONL file per session, nested under a per-directory slug.
function piDirs(): string[] {
    const explicit =
        process.env.PI_CODING_AGENT_SESSION_DIR ?? process.env.PI_AGENT_DIR;
    const dirs = explicit ? [explicit] : [];
    dirs.push(join(homedir(), '.pi', 'agent', 'sessions'));
    return dirs;
}

function parseOpencodeFiles(
    texts: string[],
    opts: ParseOpts,
): ParsedTranscript {
    const messages: unknown[] = [];
    for (const text of texts) {
        try {
            messages.push(JSON.parse(text));
        } catch {
            /* skip unreadable message file */
        }
    }
    return parseOpencodeMessages(messages, opts);
}

// Read every message JSON in one opencode session dir, tracking the newest mtime.
function readOpencodeSessionTexts(
    dir: string,
): { texts: string[]; newest: number } | null {
    let files;
    try {
        files = readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    let newest = 0;
    const texts: string[] = [];
    for (const f of files) {
        if (!f.isFile() || !/\.json$/iu.test(f.name)) continue;
        const full = join(dir, f.name);
        try {
            const st = statSync(full);
            if (st.mtimeMs > newest) newest = st.mtimeMs;
            texts.push(readFileSync(full, 'utf8'));
        } catch {
            /* ignore */
        }
    }
    return { texts, newest };
}

/**
 * Walk opencode's message store, grouping the per-message JSON files back into
 * sessions (one session = one directory). A session is included when any of its
 * message files was modified at/after `sinceMs`.
 */
function collectOpencodeRows(sinceMs: number): ReporterRow[] {
    const rows: ReporterRow[] = [];
    for (const root of opencodeMessageRoots()) {
        let sessions;
        try {
            sessions = readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const s of sessions) {
            if (!s.isDirectory()) continue;
            const res = readOpencodeSessionTexts(join(root, s.name));
            if (!res || res.texts.length === 0 || res.newest < sinceMs)
                continue;
            const parsed = parseOpencodeFiles(res.texts, {
                sessionId: s.name,
                fallbackStartedAt: res.newest,
            });
            rows.push(...toRows(parsed, s.name));
        }
    }
    return rows;
}

function opencodeSessionCandidates(sessionArg: string): string[] {
    // Accept either an absolute session directory or a bare sessionID.
    try {
        if (statSync(sessionArg).isDirectory()) return [sessionArg];
    } catch {
        /* not a path — treat as sessionID below */
    }
    return opencodeMessageRoots().map((root) => join(root, sessionArg));
}

function reportOneOpencodeSession(sessionArg: string): ReporterRow[] {
    for (const dir of opencodeSessionCandidates(sessionArg)) {
        const res = readOpencodeSessionTexts(dir);
        if (!res || res.texts.length === 0) continue;
        const parsed = parseOpencodeFiles(res.texts, {
            sessionId: basename(dir),
        });
        return toRows(parsed, basename(dir));
    }
    return [];
}

// ------------------------------------------------------------------ io -------

function readConfigFile(dirName: string): JsonObject | null {
    try {
        const raw = readFileSync(
            join(homedir(), dirName, 'config.json'),
            'utf8',
        );
        const parsed: unknown = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object'
            ? (parsed as JsonObject)
            : null;
    } catch {
        return null;
    }
}

export function loadConfig(): ReporterConfig {
    // Prefer ~/.tokenmaxer; fall back to legacy ~/.tokentally.
    const file =
        readConfigFile('.tokenmaxer') ?? readConfigFile('.tokentally') ?? {};
    const apiBase =
        process.env.TOKENMAXER_API_BASE ??
        process.env.TOKENTALLY_API_BASE ??
        file.apiBase;
    const token =
        process.env.TOKENMAXER_TOKEN ??
        process.env.TOKENTALLY_TOKEN ??
        file.token;
    if (!apiBase || !token) {
        // Dry runs never send anything, so let them work before configuration.
        if (DRY_RUN) {
            return {
                apiBase: String(apiBase ?? 'https://tokenmaxer.quest').replace(
                    /\/+$/u,
                    '',
                ),
                token: String(token ?? 'DRY_RUN'),
                cursorCookie:
                    typeof file.cursorCookie === 'string'
                        ? file.cursorCookie
                        : undefined,
            };
        }
        throw new Error(
            'tokenmaxer not configured (missing apiBase/token in ~/.tokenmaxer/config.json)',
        );
    }
    return {
        apiBase: String(apiBase).replace(/\/+$/u, ''),
        token: String(token),
        cursorCookie:
            typeof file.cursorCookie === 'string'
                ? file.cursorCookie
                : undefined,
    };
}

// Cursor stores its auth JWT in the app's global state SQLite DB.
function cursorDbPaths(): string[] {
    const home = homedir();
    return [
        join(
            home,
            'Library',
            'Application Support',
            'Cursor',
            'User',
            'globalStorage',
            'state.vscdb',
        ),
        join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        join(
            process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
            'Cursor',
            'User',
            'globalStorage',
            'state.vscdb',
        ),
    ];
}

// Older Cursor builds store the value JSON-quoted; current builds store the raw JWT.
function normalizeCursorToken(value: unknown): string | null {
    let token = typeof value === 'string' ? value : null;
    if (token?.startsWith('"')) {
        try {
            const parsed: unknown = JSON.parse(token);
            token = typeof parsed === 'string' ? parsed : token;
        } catch {
            /* keep raw */
        }
    }
    return typeof token === 'string' && token ? token : null;
}

// Read cursorAuth/accessToken from one state.vscdb and build the session cookie.
// Cookie format is {userId}::{jwt}; userId comes from the JWT sub claim.
function cursorTokenFromDb(path: string): string | null {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        const row = db
            .prepare(
                "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'",
            )
            .get() as { value?: unknown } | undefined;
        const token = normalizeCursorToken(row?.value);
        if (!token) return null;
        const sub = jwtSub(token);
        return sub ? `${sub}::${token}` : null;
    } finally {
        db.close();
    }
}

// Try each known state.vscdb location; fall back to cfg.cursorCookie.
function cursorSessionToken(cfg: ReporterConfig): string | null {
    for (const path of cursorDbPaths()) {
        try {
            const token = cursorTokenFromDb(path);
            if (token) return token;
        } catch {
            /* try next path / fallback */
        }
    }
    return typeof cfg.cursorCookie === 'string' && cfg.cursorCookie
        ? cfg.cursorCookie
        : null;
}

function jwtSub(jwt: string): string | null {
    try {
        const segment = jwt.split('.')[1];
        if (!segment) return null;
        const payload: unknown = JSON.parse(
            Buffer.from(segment, 'base64url').toString('utf8'),
        );
        // sub looks like "auth0|user_xxx"; the cookie wants the trailing id part.
        const sub = String(asObject(payload).sub ?? '');
        return sub.includes('|') ? (sub.split('|').pop() ?? null) : sub || null;
    } catch {
        return null;
    }
}

async function readStdin(): Promise<string> {
    if (process.stdin.isTTY) return '';
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

async function postBatch(
    cfg: ReporterConfig,
    source: string,
    batch: ReporterRow[],
    path: string,
): Promise<number> {
    if (DRY_RUN) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    dryRun: true,
                    url: `${cfg.apiBase}${path}`,
                    body: { source, sessions: batch },
                },
                null,
                2,
            )}\n`,
        );
        return batch.length;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(`${cfg.apiBase}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.token}`,
            },
            body: JSON.stringify({ source, sessions: batch }),
            signal: controller.signal,
        });
        if (res.ok) {
            const data: unknown = await res.json().catch(() => ({}));
            const accepted = asObject(data).accepted;
            return typeof accepted === 'number' ? accepted : batch.length;
        }
        process.stderr.write(`tokenmaxer: ingest failed (${res.status})\n`);
        return 0;
    } finally {
        clearTimeout(timer);
    }
}

async function postSessions(
    cfg: ReporterConfig,
    source: string,
    rows: ReporterRow[],
    opts: PostOpts = {},
): Promise<{ accepted: number }> {
    if (rows.length === 0) return { accepted: 0 };
    const path = opts.path ?? '/api/ingest';
    const chunkSize = opts.chunkSize ?? MAX_SESSIONS_PER_REQUEST;
    const batches: ReporterRow[][] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
        batches.push(rows.slice(i, i + chunkSize));
    }
    const acceptedCounts = await Promise.all(
        batches.map((batch) => postBatch(cfg, source, batch, path)),
    );
    return { accepted: acceptedCounts.reduce((sum, n) => sum + n, 0) };
}

function parseFile(path: string, source: string): ReporterRow[] {
    const text = readFileSync(path, 'utf8');
    let fallbackStartedAt: number | null = null;
    try {
        fallbackStartedAt = statSync(path).mtimeMs;
    } catch {
        /* ignore */
    }
    let parsed: ParsedTranscript | ParsedCodexRollout;
    if (source === 'codex') {
        const codexParsed = parseCodexRollout(text, { fallbackStartedAt });
        if (codexParsed.pending_inherited.length > 0) {
            // A session naming itself as parent is bogus metadata — treat
            // as parent-not-found (count everything) rather than matching
            // the child against its own history.
            const selfParent =
                typeof codexParsed.session_id === 'string' &&
                codexParsed.parent_id?.toLowerCase() ===
                    codexParsed.session_id.toLowerCase();
            resolveCodexInherited(
                codexParsed,
                selfParent
                    ? null
                    : codexParentSequenceById(codexParsed.parent_id, path),
            );
        }
        parsed = codexParsed;
    } else if (source === 'pi')
        parsed = parsePiRollout(text, { fallbackStartedAt });
    else parsed = parseClaudeTranscript(text, { fallbackStartedAt });
    return toRows(parsed, path);
}

// --------------------------------------------------------------- commands ----

export function parseSetProfileUrlArgs(
    argv: string[],
): { clear: true } | { clear: false; url: string } {
    const args = argv.filter((a) => a !== '--dry-run');
    if (args.length === 1 && args[0] === '--clear') return { clear: true };
    if (
        args.length === 1 &&
        typeof args[0] === 'string' &&
        args[0].length > 0
    ) {
        return { clear: false, url: args[0] };
    }
    throw new Error(
        'usage: tokenmaxer set-profile-url <https-url> | tokenmaxer set-profile-url --clear [--dry-run]',
    );
}

export function buildProfileUrlBody(parsed: { clear: true }): { url: null };
export function buildProfileUrlBody(parsed: { clear: false; url: string }): {
    url: string;
};
export function buildProfileUrlBody(
    parsed: { clear: true } | { clear: false; url: string },
): { url: string | null } {
    return parsed.clear ? { url: null } : { url: parsed.url };
}

export function buildProfileUrlDryRun(args: {
    endpoint: string;
    body: { url: string | null };
}): {
    method: 'POST';
    url: string;
    headers: {
        'Content-Type': 'application/json';
        Authorization: 'Bearer <redacted>';
    };
    body: { url: string | null };
} {
    return {
        method: 'POST',
        url: args.endpoint,
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer <redacted>',
        },
        body: args.body,
    };
}

async function setProfileUrl(
    cfg: ReporterConfig,
    argv: string[],
): Promise<void> {
    const parsed = parseSetProfileUrlArgs(argv);
    const body: { url: string | null } = parsed.clear
        ? buildProfileUrlBody({ clear: true })
        : buildProfileUrlBody({ clear: false, url: parsed.url });
    const endpoint = `${cfg.apiBase}/api/profile`;
    if (DRY_RUN) {
        process.stdout.write(
            `${JSON.stringify(buildProfileUrlDryRun({ endpoint, body }), null, 2)}\n`,
        );
        return;
    }
    const res = await fetch(`${cfg.apiBase}/api/profile`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.token}`,
        },
        body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => ({}));
    const payload = asObject(data);
    if (!res.ok) {
        throw new Error(
            typeof payload.error === 'string'
                ? payload.error
                : `profile update failed (${res.status})`,
        );
    }
    if (payload.url) {
        process.stdout.write(`profile url: ${payload.url}\n`);
    } else {
        process.stdout.write('profile url: cleared\n');
    }
}

async function runSetProfileUrl(argv: string[]): Promise<void> {
    try {
        await setProfileUrl(loadConfig(), argv);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tokenmaxer: ${message}\n`);
        process.exit(1);
    }
}

async function claudeSessionEnd(cfg: ReporterConfig): Promise<void> {
    const stdin = await readStdin();
    let hook: JsonObject = {};
    try {
        const parsed: unknown = JSON.parse(stdin);
        if (parsed !== null && typeof parsed === 'object') {
            hook = parsed as JsonObject;
        }
    } catch {
        /* no hook payload */
    }
    const path = hook.transcript_path;
    // fall back to a scan when no transcript path is provided
    if (typeof path !== 'string' || !path) return claudeCatchup(cfg);
    const text = readFileSync(path, 'utf8');
    const parsed = parseClaudeTranscript(text, {
        sessionId:
            typeof hook.session_id === 'string' ? hook.session_id : undefined,
    });
    const rows = toRows(parsed, path);
    const { accepted } = await postSessions(cfg, 'claude_code', rows);
    process.stderr.write(
        `tokenmaxer: reported ${accepted} row(s) for the current session\n`,
    );
}

async function claudeCatchup(cfg: ReporterConfig): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const files = claudeDirs().flatMap((d) =>
        walkJsonl(d, since, (n) => n.endsWith('.jsonl')),
    );
    const rows = files.flatMap((f) => safeParse(f, 'claude_code'));
    const { accepted } = await postSessions(cfg, 'claude_code', rows);
    process.stderr.write(
        `tokenmaxer: caught up ${accepted} row(s) from ${files.length} file(s)\n`,
    );
}

async function codexCatchup(cfg: ReporterConfig): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const files = codexDirs().flatMap((d) =>
        walkJsonl(d, since, (n) => CODEX_ROLLOUT_FILE.test(n)),
    );
    const rows = files.flatMap((f) => safeParse(f, 'codex'));
    const { accepted } = await postSessions(cfg, 'codex', rows);
    process.stderr.write(
        `tokenmaxer: caught up ${accepted} row(s) from ${files.length} file(s)\n`,
    );
}

async function opencodeCatchup(cfg: ReporterConfig): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const rows = collectOpencodeRows(since);
    const { accepted } = await postSessions(cfg, 'opencode', rows);
    process.stderr.write(`tokenmaxer: caught up ${accepted} opencode row(s)\n`);
}

async function piCatchup(cfg: ReporterConfig): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const files = piDirs().flatMap((d) =>
        walkJsonl(d, since, (n) => n.endsWith('.jsonl')),
    );
    const rows = files.flatMap((f) => safeParse(f, 'pi'));
    const { accepted } = await postSessions(cfg, 'pi', rows);
    process.stderr.write(
        `tokenmaxer: caught up ${accepted} pi row(s) from ${files.length} file(s)\n`,
    );
}

async function reportOneOpencode(
    cfg: ReporterConfig,
    sessionArg: string | undefined,
): Promise<void> {
    if (!sessionArg) {
        process.stderr.write('tokenmaxer: missing opencode session id\n');
        return;
    }
    const rows = reportOneOpencodeSession(sessionArg);
    const { accepted } = await postSessions(cfg, 'opencode', rows);
    process.stderr.write(`tokenmaxer: reported ${accepted} opencode row(s)\n`);
}

// Unofficial dashboard endpoint — the only individual route to Cursor usage.
async function cursorFetchEvents(
    sessionToken: string,
    sinceMs: number,
): Promise<unknown[] | null> {
    const events: unknown[] = [];
    for (let page = 1; page <= 200; page += 1) {
        // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
        const res = await fetch(
            'https://cursor.com/api/dashboard/get-filtered-usage-events',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://cursor.com',
                    Cookie: `WorkosCursorSessionToken=${encodeURIComponent(sessionToken)}`,
                },
                body: JSON.stringify({
                    teamId: 0,
                    startDate: String(sinceMs),
                    endDate: String(Date.now()),
                    page,
                    pageSize: 1000,
                }),
            },
        );
        if (!res.ok) {
            process.stderr.write(
                `tokenmaxer: cursor usage fetch failed (${res.status})\n`,
            );
            return null;
        }
        // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
        const data: unknown = await res.json().catch(() => null);
        if (data === null) return null;
        const payload = asObject(data);
        const batch = payload.usageEvents ?? payload.usageEventsDisplay ?? [];
        if (!Array.isArray(batch) || batch.length === 0) break;
        events.push(...batch);
        if (batch.length < 1000) break;
    }
    return events;
}

async function cursorSync(
    cfg: ReporterConfig,
    opts: CursorSyncOpts = {},
): Promise<void> {
    const sessionToken = cursorSessionToken(cfg);
    if (!sessionToken) {
        process.stderr.write(
            'tokenmaxer: Cursor not configured (no state.vscdb token or cursorCookie)\n',
        );
        return;
    }
    const since = opts.sinceMs ?? Date.now() - CATCHUP_DAYS * 86_400_000;
    // Floor to UTC day start: rows are whole-day sums and the server upsert
    // replaces counts, so a partial oldest day would shrink stored totals.
    const d = new Date(since);
    const sinceMs = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
    );
    const events = await cursorFetchEvents(sessionToken, sinceMs);
    if (events === null) {
        process.stderr.write(
            'tokenmaxer: cursor sync aborted (fetch failed)\n',
        );
        return;
    }
    const rows = parseCursorEvents(events);
    const { accepted } = await postSessions(cfg, 'cursor', rows, opts.post);
    process.stderr.write(
        `tokenmaxer: cursor synced ${accepted} row(s) from ${events.length} event(s)\n`,
    );
}

function safeParse(path: string, source: string): ReporterRow[] {
    try {
        return parseFile(path, source);
    } catch {
        return [];
    }
}

/**
 * One-time bulk backfill: scan ALL local Claude/Codex transcripts (ignoring the
 * catch-up window) and POST them to /api/history. Idempotent, so it's safe to
 * run alongside the normal hooks and safe to re-run. Pass 'claude' or 'codex' to
 * limit the scan to one tool.
 */
async function backfillFiles(
    cfg: ReporterConfig,
    source: string,
    rows: ReporterRow[],
    label: string,
    fileCount: number,
): Promise<number> {
    const { accepted } = await postSessions(cfg, source, rows, {
        path: '/api/history',
        chunkSize: HISTORY_CHUNK,
    });
    process.stderr.write(
        `tokenmaxer: backfilled ${accepted} ${label} row(s) from ${fileCount} file(s)\n`,
    );
    return accepted;
}

async function backfill(
    cfg: ReporterConfig,
    only: string | undefined,
): Promise<void> {
    let total = 0;
    if (!only || only === 'claude') {
        const files = claudeDirs().flatMap((d) =>
            walkJsonl(d, 0, (n) => n.endsWith('.jsonl')),
        );
        const rows = files.flatMap((f) => safeParse(f, 'claude_code'));
        total += await backfillFiles(
            cfg,
            'claude_code',
            rows,
            'Claude Code',
            files.length,
        );
    }
    if (!only || only === 'codex') {
        const files = codexDirs().flatMap((d) =>
            walkJsonl(d, 0, (n) => CODEX_ROLLOUT_FILE.test(n)),
        );
        // This walk already saw every rollout — parent lookups for
        // subagent/fork children shouldn't pay for a second one.
        seedCodexRolloutIndex(files);
        const rows = files.flatMap((f) => safeParse(f, 'codex'));
        total += await backfillFiles(cfg, 'codex', rows, 'Codex', files.length);
    }
    if (!only || only === 'opencode') {
        const rows = collectOpencodeRows(0);
        const { accepted } = await postSessions(cfg, 'opencode', rows, {
            path: '/api/history',
            chunkSize: HISTORY_CHUNK,
        });
        total += accepted;
        process.stderr.write(
            `tokenmaxer: backfilled ${accepted} opencode row(s)\n`,
        );
    }
    if (!only || only === 'pi') {
        const files = piDirs().flatMap((d) =>
            walkJsonl(d, 0, (n) => n.endsWith('.jsonl')),
        );
        const rows = files.flatMap((f) => safeParse(f, 'pi'));
        total += await backfillFiles(cfg, 'pi', rows, 'pi', files.length);
    }
    if (!only || only === 'cursor') {
        await cursorSync(cfg, {
            sinceMs: Date.now() - 90 * 86_400_000,
            post: { path: '/api/history', chunkSize: HISTORY_CHUNK },
        });
    }
    process.stderr.write(
        `tokenmaxer: backfill complete — ${total} row(s) total\n`,
    );
}

async function reportOne(
    cfg: ReporterConfig,
    path: string | undefined,
    source: string,
): Promise<void> {
    if (!path) {
        process.stderr.write(`tokenmaxer: missing path for ${source} report\n`);
        return;
    }
    const rows = parseFile(path, source);
    const { accepted } = await postSessions(cfg, source, rows);
    process.stderr.write(`tokenmaxer: reported ${accepted} row(s)\n`);
}

// Commands you run yourself.
const USER_COMMANDS: Array<[string, string]> = [
    [
        'backfill [claude|codex|opencode|pi|cursor]',
        'one-time: upload ALL past history (optionally scoped to one source)',
    ],
    ['cursor-sync', 'sync recent Cursor dashboard usage'],
    ['set-profile-url <https-url>', 'set your public profile link'],
    ['set-profile-url --clear', 'clear your public profile link'],
    ['help', 'show this help'],
];

// Commands wired into agent hooks (SessionStart/SessionEnd) — not run by hand.
const HOOK_COMMANDS: Array<[string, string]> = [
    [
        'claude-sessionend',
        'parse the just-ended Claude transcript (stdin JSON)',
    ],
    ['claude-sessionstart', 'catch up recent Claude sessions'],
    ['codex-sessionstart', 'catch up recent Codex sessions'],
    ['opencode-sessionstart', 'catch up recent opencode sessions'],
    ['pi-sessionstart', 'catch up recent pi sessions'],
    ['claude-report <path>', 'parse and report one Claude transcript'],
    ['codex-report <path>', 'parse and report one Codex rollout'],
    ['opencode-report <sessionID>', 'parse and report one opencode session'],
    ['pi-report <path>', 'parse and report one pi session file'],
];

function printHelp(): void {
    const pad = Math.max(
        ...[...USER_COMMANDS, ...HOOK_COMMANDS].map(([c]) => c.length),
    );
    function fmt(rows: Array<[string, string]>): string[] {
        return rows.map(([c, d]) => `  ${c.padEnd(pad)}  ${d}`);
    }
    process.stdout.write(
        [
            'tokenmaxer — report per-session token usage to a tokenmaxer leaderboard.',
            '',
            'Usage: tokenmaxer <command> [args] [--dry-run]',
            '',
            'Commands you run:',
            ...fmt(USER_COMMANDS),
            '',
            'Hook commands (wired into agent SessionStart/SessionEnd; not run by hand):',
            ...fmt(HOOK_COMMANDS),
            '',
            'Append --dry-run to any command to print payloads instead of sending.',
            '',
            'Config: ~/.tokenmaxer/config.json => { "apiBase": "https://...", "token": "tt_..." }',
            '  (env TOKENMAXER_API_BASE / TOKENMAXER_TOKEN override the file.)',
            'Get a token and hooks at <https://tokenmaxer.quest/start>.',
            '',
        ].join('\n'),
    );
}

const HELP_FLAGS = new Set<string | undefined>([
    'help',
    '--help',
    '-h',
    undefined,
]);

async function main(): Promise<void> {
    const cmd = process.argv[2];
    if (HELP_FLAGS.has(cmd)) {
        printHelp();
        return;
    }
    if (cmd === 'set-profile-url') {
        await runSetProfileUrl(process.argv.slice(3));
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
            await cursorSync(cfg);
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
                'usage: tokenmaxer <claude-sessionend|claude-sessionstart|codex-sessionstart|opencode-sessionstart|pi-sessionstart|claude-report <path>|codex-report <path>|opencode-report <sessionID>|pi-report <path>|cursor-sync|backfill [claude|codex|opencode|pi|cursor]|set-profile-url (<https-url>|--clear)> [--dry-run]\n',
            );
    }
}

// Only run as a CLI when executed directly — importing (tests) must not trigger it.
// argv[1] may be a symlink (global/npx bin); resolve it so import.meta.url matches.
function invokedDirectlyAs(argvPath: string | undefined): boolean {
    if (typeof argvPath !== 'string') return false;
    let resolved = argvPath;
    try {
        resolved = realpathSync(argvPath);
    } catch {
        // fall back to the raw path
    }
    return import.meta.url === pathToFileURL(resolved).href;
}
const invokedDirectly = invokedDirectlyAs(process.argv[1]);
if (invokedDirectly) {
    main().catch((err: unknown) => {
        // Never break the host session — hooks must exit cleanly.
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tokenmaxer: ${message}\n`);
        process.exit(0);
    });
}
