import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(rootDir, './src') },
        tsconfigPaths: true,
    },
    server: { port: 3000 },
    plugins: [
        cloudflare({ viteEnvironment: { name: 'ssr' } }),
        tanstackStart(),
        viteReact(),
    ],
});
