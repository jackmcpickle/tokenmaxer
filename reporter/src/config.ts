import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DRY_RUN } from './lib/flags';
import type { JsonObject, ReporterConfig } from './lib/types';

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

/** Env var that overrides the token in the config file, if set. */
export function tokenEnvOverride():
    | 'TOKENMAXER_TOKEN'
    | 'TOKENTALLY_TOKEN'
    | null {
    if (process.env.TOKENMAXER_TOKEN) return 'TOKENMAXER_TOKEN';
    if (process.env.TOKENTALLY_TOKEN) return 'TOKENTALLY_TOKEN';
    return null;
}

function existingConfigPath(): string | null {
    const preferred = join(homedir(), '.tokenmaxer', 'config.json');
    if (existsSync(preferred)) return preferred;
    const legacy = join(homedir(), '.tokentally', 'config.json');
    if (existsSync(legacy)) return legacy;
    return null;
}

/** Write a new token into the config file we loaded (or ~/.tokenmaxer). */
export function persistToken(token: string, apiBase: string): string {
    const path =
        existingConfigPath() ?? join(homedir(), '.tokenmaxer', 'config.json');
    let existing: JsonObject = {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed !== null && typeof parsed === 'object') {
            existing = parsed as JsonObject;
        }
    } catch {
        // Missing or invalid file: start a fresh object.
    }
    const next: JsonObject = { ...existing, token };
    if (typeof next.apiBase !== 'string' || next.apiBase.length === 0) {
        next.apiBase = apiBase;
    }
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Write aside and rename so a failed write cannot truncate the live file.
    const tmp = `${path}.${process.pid}.tmp`;
    try {
        writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, {
            mode: 0o600,
        });
        renameSync(tmp, path);
        chmodSync(dir, 0o700);
        chmodSync(path, 0o600);
    } catch (err) {
        try {
            unlinkSync(tmp);
        } catch {
            // Best-effort cleanup; the original config is still intact.
        }
        throw err;
    }
    return path;
}

/** Home-relative display path for messages (`~/.tokenmaxer/config.json`). */
export function displayConfigPath(path: string): string {
    const home = homedir();
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
