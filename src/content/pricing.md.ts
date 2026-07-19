import { listPrices } from '@/lib/pricing';

/** Agent-facing Markdown for GET /pricing.md (and Accept negotiation on /pricing). */
export function pricingMarkdown(): string {
    const rows = listPrices()
        .map(
            (p) =>
                `| \`${p.id}\` | ${p.input} | ${p.output} | ${p.cacheRead} | ${p.cacheWrite} |`,
        )
        .join('\n');

    return `# Reference pricing

Estimated USD per **1,000,000** tokens used for the leaderboard cost metric.
Matching is by longest case-insensitive substring of the model id. These are
approximations for the board — not invoices.

| Model id | Input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
${rows}

Unknown models fall back to a conservative Sonnet-like rate (3 / 15 / 0.3 / 3.75).
Rates live in \`src/lib/pricing.ts\` and update on redeploy.
`;
}
