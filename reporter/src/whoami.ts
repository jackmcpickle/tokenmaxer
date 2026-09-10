import { loadConfig } from './config';
import { DRY_RUN } from './lib/flags';
import { asObject } from './lib/parse-utils';
import type { ReporterConfig } from './lib/types';

export function parseWhoamiArgs(argv: string[]): void {
    if (argv.length > 0) {
        throw new Error('usage: tokenmaxer whoami [--dry-run]');
    }
}

export function buildWhoamiDryRun(endpoint: string): {
    method: 'GET';
    url: string;
    headers: { Authorization: 'Bearer <redacted>' };
} {
    return {
        method: 'GET',
        url: endpoint,
        headers: { Authorization: 'Bearer <redacted>' },
    };
}

export function parseWhoamiUsername(data: unknown, status: number): string {
    const payload = asObject(data);
    if (typeof payload.username === 'string' && payload.username.length > 0) {
        return payload.username;
    }
    throw new Error(
        typeof payload.error === 'string'
            ? payload.error
            : `whoami failed (${status})`,
    );
}

async function whoami(cfg: ReporterConfig, argv: string[]): Promise<void> {
    parseWhoamiArgs(argv);
    const endpoint = `${cfg.apiBase}/api/whoami`;
    if (DRY_RUN) {
        process.stdout.write(
            `${JSON.stringify(buildWhoamiDryRun(endpoint), null, 2)}\n`,
        );
        return;
    }
    const res = await fetch(`${cfg.apiBase}/api/whoami`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
        const payload = asObject(data);
        throw new Error(
            typeof payload.error === 'string'
                ? payload.error
                : `whoami failed (${res.status})`,
        );
    }
    process.stdout.write(`${parseWhoamiUsername(data, res.status)}\n`);
}

export async function runWhoami(argv: string[]): Promise<void> {
    try {
        await whoami(loadConfig(), argv);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tokenmaxer: ${message}\n`);
        process.exit(1);
    }
}
