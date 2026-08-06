import { SESSION_COOKIE, resolveSession } from '@/lib/session';
import type { Env, UserRow } from '@/types';

function cookieValue(req: Request, name: string): string | undefined {
    const header = req.headers.get('Cookie');
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        if (trimmed.slice(0, eq) === name) {
            const value = trimmed.slice(eq + 1);
            return value.length > 0 ? value : undefined;
        }
    }
    return undefined;
}

/** Raw session id from the Cookie header, if present. */
export function sessionIdFromRequest(req: Request): string | null {
    return cookieValue(req, SESSION_COOKIE) ?? null;
}

/** Resolve the logged-in user from a Request's session cookie. */
export async function userFromRequest(
    req: Request,
    env: Env,
): Promise<UserRow | null> {
    const sessionId = sessionIdFromRequest(req);
    if (!sessionId) return null;
    return resolveSession(env.DB, sessionId, Date.now());
}
