import { walkJsonl } from './fs-walk';
import type { ReporterRow } from './types';

export function collectRowsFromJsonlDirs(options: {
    dirs: string[];
    sinceMs: number;
    match: (name: string) => boolean;
    parseFile: (path: string) => ReporterRow[];
    // Optional pre-parse pass over the walked list (e.g. dropping duplicate
    // copies of one session before their rows can race on the upsert).
    prepareFiles?: (files: string[]) => string[];
}): { files: string[]; rows: ReporterRow[] } {
    let files = options.dirs.flatMap((d) =>
        walkJsonl(d, options.sinceMs, options.match),
    );
    if (options.prepareFiles) files = options.prepareFiles(files);
    const rows: ReporterRow[] = [];
    for (const file of files) {
        try {
            rows.push(...options.parseFile(file));
        } catch {
            /* skip unreadable / unparseable file */
        }
    }
    return { files, rows };
}
