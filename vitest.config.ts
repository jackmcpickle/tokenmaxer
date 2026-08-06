import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        // Mirror wrangler's `Data` rule: import *.ttf as an ArrayBuffer.
        {
            name: 'ttf-as-arraybuffer',
            transform(_code, id) {
                if (!id.endsWith('.ttf')) return null;
                const base64 = readFileSync(id).toString('base64');
                return `const b = atob(${JSON.stringify(base64)});
const bytes = new Uint8Array(b.length);
for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
export default bytes.buffer;`;
            },
        },
        // Layout imports compiled CSS as a string (`?raw`) for Hono SSR.
        {
            name: 'css-as-raw-string',
            transform(code, id) {
                if (!id.includes('.css')) return null;
                if (id.includes('?raw') || id.endsWith('.css')) {
                    // Only treat explicit ?raw or direct css string modules.
                    if (!id.includes('?raw') && !id.includes('app.css')) {
                        return null;
                    }
                    if (id.includes('?raw') || id.endsWith('app.css')) {
                        const file = id.split('?')[0] ?? id;
                        if (!file.endsWith('.css')) return null;
                        const css = readFileSync(file, 'utf8');
                        return `export default ${JSON.stringify(css)};`;
                    }
                }
                return null;
            },
            load(id) {
                if (!id.includes('.css')) return null;
                const file = id.split('?')[0] ?? id;
                if (!file.endsWith('.css')) return null;
                if (id.includes('?raw') || file.endsWith('app.css')) {
                    const css = readFileSync(file, 'utf8');
                    return `export default ${JSON.stringify(css)};`;
                }
                return null;
            },
        },
    ],
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            '@': new URL('./src', import.meta.url).pathname,
            // Workers entry; Node tests use the node build of the same API.
            '@cf-wasm/resvg/workerd': '@cf-wasm/resvg/node',
        },
    },
});
