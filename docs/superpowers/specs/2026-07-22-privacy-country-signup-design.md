# Privacy page, required country, signup redesign

Date: 2026-07-22

## Goal

Three related changes to tokenmaxer.quest:

1. A dedicated **/privacy** page (plus **/privacy.md** for agents) linked from the footer, stating plainly what session data we store and what we never store.
2. A **required country** field at signup (ISO 3166-1 alpha-2), shown on the public profile, filterable on the homepage and footprint leaderboards, with per-country read caching.
3. A **redesigned signup** that reads like a real sign-up form: an upfront privacy notice (store / never-store), the private-by-default stance, and a clear lost-key warning ("no email, no recovery — contact us if stuck").

## Non-goals

- No flags on leaderboard rows (filter only).
- No flag/country on the `/about` page.
- No email, password, or account-recovery mechanism (unchanged).

## Data model

Migration `drizzle/0003_country.sql`:

```sql
ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT 'AU';
CREATE INDEX IF NOT EXISTS idx_users_country ON users (country);
```

`DEFAULT 'AU'` backfills all existing users to Australia. New signups always supply a country explicitly; the default only exists to satisfy the NOT-NULL add for existing rows.

## Country reference + validation

New `src/lib/countries.ts`:

- `COUNTRIES: { code: string; name: string }[]` — full ISO 3166-1 alpha-2 list, sorted by name.
- `isValidCountry(code: string): boolean` — membership check against an uppercased Set.
- `flagEmoji(code: string): string` — derive the flag from the two letters via regional-indicator code points. Nothing extra is stored.

`validate.ts`:

- `validateCountry(raw: unknown): Result<string>` — must be a string; trim + uppercase; exactly 2 chars; must pass `isValidCountry`. Errors otherwise.
- Add `'privacy'` to the `RESERVED` username set.

## Register flow

`routes/register.ts`:

- Parse `country` from the request body.
- Validate with `validateCountry`; missing/invalid → `400` with the validator error.
- Insert `country` into the new column alongside existing fields.

`pages/start.tsx`:

- Add a **required** `<select id="country">` with a leading disabled/empty `Select country…` option, then `COUNTRIES` mapped to `<option value={code}>{name}</option>`.
- Client script: read `country`, include it in the POST body; block submit with an inline error if empty.
- **Redesign**: add a privacy notice near the form — a two-column "What we store / What we never store" list, the honor-system + private-by-default stance, and a bold lost-key warning ("no email, no recovery — lose the token and the username is stranded; rotate while you still hold it; email jackmcpickle@gmail.com if you're stuck"). Reuse existing `panel` / `spotlight` / `notice` styles from `pages/ui`.

## Country on profile

`lib/aggregate.ts`:

- `getProfile`: select `country`; add `country: string` to the `Profile` interface.

`pages/profile.tsx`:

- Render `flagEmoji(country)` + country name near the username header.

## Leaderboard country filter + per-country cache

`lib/aggregate.ts`:

- `LeaderboardQuery.country?: string`.
- `getLeaderboard`: when `q.country` set, add `u.country = ?` condition + bind (uppercased).
- New `getDistinctCountries(db): Promise<string[]>` — countries that have at least one user with usage (join users↔session_usage, distinct country), sorted.

`lib/cached-aggregate.ts`:

- `leaderboardCacheKey`: append `query.country ?? ''` so each country is a distinct cache entry.
- New `cachedDistinctCountries` with KV key `agg:countries:v1`.

`index.tsx` `/` and `/footprint` routes:

- Parse `country` query param (validate against the reference list; ignore invalid).
- Pass `country` to `cachedLeaderboard` and to the `Home` / `Footprint` components.
- Fetch `cachedDistinctCountries` for the dropdown; render only countries that have users.

`pages/home.tsx` + `pages/footprint.tsx`:

- Add a country filter dropdown alongside the existing window/metric/source/model filters. Options limited to countries returned by `getDistinctCountries`, each shown as `flagEmoji(code) + name`. Leaderboard rows stay flag-free.

`routes/leaderboard.ts` (API):

- Accept and validate a `country` param for parity; pass to `getLeaderboard`.

## Privacy page

- `src/pages/privacy.tsx` — Layout-wrapped page. Sections: **What we store** (per-session token counts by model/tool, username, country, optional profile URL, SHA-256 token hash, transient rate-limit IP), **What we never store** (prompts, code, file paths, email, password, raw token), honor-system note, token/recovery reality, contact for lost keys.
- `src/content/privacy.md.ts` — plaintext equivalent.
- `agent-pages.ts` — `servePrivacyMarkdown`, wired like `serveAboutMarkdown`.
- `index.tsx` — `/privacy` route: `servePrivacyMarkdown` for non-browser requests, else the HTML page.
- `pages/layout.tsx` footer — change the "Privacy & honor system" link from `/about` to `/privacy`.

## Tests (`src/__tests__`, existing patterns)

- `validateCountry`: valid, lowercase-normalized, invalid code, wrong length, non-string.
- register: valid country persists; missing/invalid → 400.
- leaderboard: `country` filter narrows results; cache keys differ by country; `getDistinctCountries` returns only countries with users.
- privacy route: HTML for browsers, markdown for agents.
- migration applies and existing rows read as `AU`.

## Open decisions (resolved)

- Country dropdown default: blank `Select country…` prompt (conscious choice).
- Footprint page: gets the country filter too.
- Homepage/footprint dropdown: only countries with users.
- `/about`: untouched (no flags).
