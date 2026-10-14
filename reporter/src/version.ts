// The package version is stamped into the bundle at build time via esbuild
// `--define:TOKENMAXER_VERSION` (see reporter/package.json "build"), so the published
// .mjs reports its own version without reading package.json at runtime.
declare const TOKENMAXER_VERSION: string | undefined;

export const VERSION: string =
    typeof TOKENMAXER_VERSION === 'string' && TOKENMAXER_VERSION.length > 0
        ? TOKENMAXER_VERSION
        : '0.0.0-dev';

export function printVersion(): void {
    process.stdout.write(`${VERSION}\n`);
}
