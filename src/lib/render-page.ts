import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

/** Render a full HTML document (Layout includes `<html>`) for Hono responses. */
export function renderPage(node: ReactElement): string {
    return `<!DOCTYPE html>${renderToString(node)}`;
}
