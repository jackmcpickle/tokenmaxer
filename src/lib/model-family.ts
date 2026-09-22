/**
 * Bundles versioned model ids into stable filter families for the leaderboard UI.
 * Raw model strings stay in the DB; filters match by family (e.g. all Sonnet variants).
 */

const FAMILY_LABELS: Record<string, string> = {
    sonnet: 'Sonnet',
    opus: 'Opus',
    haiku: 'Haiku',
    fable: 'Fable',
    codex: 'Codex',
    gpt: 'GPT',
};

const KNOWN_FAMILY_CHECKS: ReadonlyArray<{
    id: string;
    match: (m: string) => boolean;
}> = [
    { id: 'sonnet', match: (m) => m.includes('sonnet') },
    { id: 'opus', match: (m) => m.includes('opus') },
    { id: 'haiku', match: (m) => m.includes('haiku') },
    { id: 'fable', match: (m) => m.includes('fable') },
    // Codex before GPT so gpt-*-codex lands in Codex.
    { id: 'codex', match: (m) => m.includes('codex') },
    { id: 'gpt', match: (m) => m.includes('gpt') || /^o[0-9]/u.test(m) },
];

/** Claude Code `<synthetic>` internal turns — never show or score. */
export function isSyntheticModel(model: string): boolean {
    const m = model.toLowerCase().trim().replace(/^<|>$/gu, '');
    return m === 'synthetic';
}

function unknownFamilyId(m: string): string {
    const stripped = m
        .replace(/-\d{8}$/u, '')
        .replace(/-\d+(?:\.\d+)*(?:-\d+)*$/u, '');
    return stripped || m;
}

/** Family id for a raw model string, or null to hide from the filter list. */
export function familyOf(model: string): string | null {
    const m = model.toLowerCase().trim();
    if (!m || isSyntheticModel(m)) return null;

    for (const { id, match } of KNOWN_FAMILY_CHECKS) {
        if (match(m)) return id;
    }

    return unknownFamilyId(m);
}

export function familyLabel(family: string): string {
    return FAMILY_LABELS[family] ?? family;
}

/** Unique family ids present in a list of raw model ids, sorted by label. */
export function distinctFamilies(models: string[]): string[] {
    const set = new Set<string>();
    for (const model of models) {
        const family = familyOf(model);
        if (family) set.add(family);
    }
    return [...set].sort((a, b) =>
        familyLabel(a).localeCompare(familyLabel(b)),
    );
}
