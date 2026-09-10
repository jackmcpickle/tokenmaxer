import {
    displayConfigPath,
    loadConfig,
    persistToken,
    tokenEnvOverride,
} from './config';
import { DRY_RUN } from './lib/flags';
import { asObject } from './lib/parse-utils';
import type { ReporterConfig } from './lib/types';

export function parseRotateArgs(argv: string[]): void {
    if (argv.length > 0) {
        throw new Error('usage: tokenmaxer rotate [--dry-run]');
    }
}

export function buildRotateDryRun(endpoint: string): {
    method: 'POST';
    url: string;
    headers: { Authorization: 'Bearer <redacted>' };
} {
    return {
        method: 'POST',
        url: endpoint,
        headers: { Authorization: 'Bearer <redacted>' },
    };
}

export function parseRotatedToken(data: unknown, status: number): string {
    const payload = asObject(data);
    if (typeof payload.token === 'string' && payload.token.startsWith('tt_')) {
        return payload.token;
    }
    throw new Error(
        typeof payload.error === 'string'
            ? payload.error
            : `token rotate failed (${status})`,
    );
}

async function rotate(cfg: ReporterConfig, argv: string[]): Promise<void> {
    parseRotateArgs(argv);
    const endpoint = `${cfg.apiBase}/api/token/rotate`;
    if (DRY_RUN) {
        process.stdout.write(
            `${JSON.stringify(buildRotateDryRun(endpoint), null, 2)}\n`,
        );
        return;
    }
    const res = await fetch(`${cfg.apiBase}/api/token/rotate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
        const payload = asObject(data);
        throw new Error(
            typeof payload.error === 'string'
                ? payload.error
                : `token rotate failed (${res.status})`,
        );
    }
    const token = parseRotatedToken(data, res.status);
    const path = persistToken(token, cfg.apiBase);
    process.stdout.write(`token: ${token}\n`);
    process.stdout.write(`saved ${displayConfigPath(path)}\n`);
    const envName = tokenEnvOverride();
    if (envName) {
        process.stderr.write(
            `tokenmaxer: ${envName} is set and overrides the config file; update or unset it\n`,
        );
    }
}

export async function runRotate(argv: string[]): Promise<void> {
    try {
        await rotate(loadConfig(), argv);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tokenmaxer: ${message}\n`);
        process.exit(1);
    }
}
