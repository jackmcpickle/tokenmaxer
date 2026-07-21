import { homedir } from 'node:os';
import { join } from 'node:path';
import { asObject, jsonlObjects, toMs } from '../lib/parse-utils';
import { accumulateModelUsage, usageFromFields } from '../lib/totals';
import type {
    JsonObject,
    ParseOpts,
    ParsedTranscript,
    ReporterTotals,
} from '../lib/types';
import { PI_USAGE_FIELDS } from '../lib/usage-fields';

interface PiParseState {
    sessionId: string | null;
    startedAt: number | null;
    currentModel: string;
}

interface PiKeyedUsage {
    model: string;
    usage: ReporterTotals;
}

function piUsage(obj: JsonObject): JsonObject | null {
    if (obj.usage && typeof obj.usage === 'object') return asObject(obj.usage);
    const nested = asObject(obj.message).usage;
    return nested && typeof nested === 'object' ? asObject(nested) : null;
}

// `model_change` records carry the new model as `modelId` (plus a provider we
// don't need); assistant messages carry `model` on the nested message. The
// message-level model wins over the entry-level one (CodexBar's order) — the
// nested message records what was actually served. Candidates are iterated
// so an empty or non-string value falls through to the next instead of
// masking it.
function piModel(obj: JsonObject): string | null {
    const msg = asObject(obj.message);
    const candidates = [
        msg.model,
        obj.model,
        msg.modelId,
        obj.modelId,
        obj.modelID,
        asObject(obj.usage).model,
    ];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

function piSessionId(obj: JsonObject): string | null {
    if (typeof obj.sessionId === 'string') return obj.sessionId;
    if (typeof obj.session_id === 'string') return obj.session_id;
    return null;
}

// A blank id doesn't identify a record; treat it as unkeyed. Any non-blank
// id dedupes, whatever its length — a repeated oversized-id record summed
// twice would inflate totals, which is worse than an unbounded id set
// (bounded by the session file's own size anyway).
function piEntryId(obj: JsonObject): string | null {
    if (typeof obj.id !== 'string') return null;
    const id = obj.id.trim();
    return id || null;
}

function processPiLine(
    obj: JsonObject,
    state: PiParseState,
    models: Map<string, ReporterTotals>,
    keyed: Map<string, PiKeyedUsage>,
): void {
    if (state.startedAt === null)
        state.startedAt = toMs(obj.timestamp ?? obj.time);
    if (!state.sessionId) state.sessionId = piSessionId(obj);

    const model = piModel(obj);
    if (model) state.currentModel = model;

    const usage = piUsage(obj);
    if (!usage) return;

    const totals = usageFromFields(usage, PI_USAGE_FIELDS);
    // Records with an id can repeat on another branch of the tree: keep the
    // last occurrence per id and sum once at the end. Unkeyed records are
    // always summed.
    const id = piEntryId(obj);
    if (id) {
        keyed.set(id, { model: state.currentModel, usage: totals });
        return;
    }
    accumulateModelUsage(models, state.currentModel, totals);
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
    const keyed = new Map<string, PiKeyedUsage>();
    const state: PiParseState = {
        sessionId: opts.sessionId ?? null,
        startedAt: null,
        currentModel: 'unknown',
    };

    for (const obj of jsonlObjects(text)) {
        processPiLine(obj, state, models, keyed);
    }
    for (const { model, usage } of keyed.values()) {
        accumulateModelUsage(models, model, usage);
    }

    return {
        session_id: state.sessionId ?? opts.sessionId ?? null,
        started_at: state.startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}

// pi stores one JSONL file per session, nested under a per-directory slug.
export function piDirs(): string[] {
    const explicit =
        process.env.PI_CODING_AGENT_SESSION_DIR ?? process.env.PI_AGENT_DIR;
    const dirs = explicit ? [explicit] : [];
    dirs.push(join(homedir(), '.pi', 'agent', 'sessions'));
    return dirs;
}
