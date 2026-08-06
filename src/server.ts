import handler from '@tanstack/react-start/server-entry';
import app from '@/index';
import { shouldUseHono } from '@/server/dispatch';
import type { Env } from '@/types';

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        const url = new URL(request.url);
        if (url.hostname.startsWith('www.')) {
            url.hostname = url.hostname.slice(4);
            return Response.redirect(url.toString(), 301);
        }

        if (shouldUseHono(request)) {
            return app.fetch(request, env, ctx);
        }

        // Cloudflare bindings are available via `cloudflare:workers` inside Start.
        return handler.fetch(request);
    },
};
