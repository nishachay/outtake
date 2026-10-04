# AGENTS.md

`[ OUTTAKE ]` — a verified archive of unreleased music. Every track is a public
YouTube video that has been machine-checked as playable. **We host nothing; we
link out.** Trust is the product, so a track that has not passed verification must
never be visible.

Currently **288 tracks / 12 artists**, in `scripts/catalog.json`. Scale target is
**3,000 tracks / 88 artists** — see `TODO.md` for the roadmap and `lib/probe.ts`
for why the data layer is being rewritten.

## Commands

```bash
npm run typecheck   # tsc --noEmit — the ONLY real gate; there is no test suite
npm run build       # typechecks again + prerenders /, /artist/*, sitemap
npm run dev         # Turbopack, http://localhost:3000
npm run db:push     # apply schema straight to Neon (no migration files are committed)
npm run db:import   # catalog.json -> Neon (idempotent, never deletes)
npm run db:export   # Neon -> catalog.json (merge-only; review the diff before committing)
npm run db:prefilter        # dry-run triage of the pending queue
npm run db:prefilter:apply  # same, but writes
```

**Verification has no test framework.** There is no vitest/jest config and no test
script. To validate a change: `npm run typecheck && npm run build`, plus a
throwaway `npx tsx` script for anything behavioural (that is how the probe verdict
table below was verified).

### Environment gotchas on this machine

- **`next build` takes ~10 minutes** (drvfs + low RAM). Budget for it; use a long
  timeout and don't assume it hung.
- **Kill stray node/next processes before building** — a stale `next-server` will
  happily serve old routes and make your change look like it did nothing.
- `node -v` sometimes shows a stale snap **v10**. Next 15 needs ≥18. Node comes from
  nvm (v20.20.2) — `source ~/.nvm/nvm.sh` first if the version is wrong.
- npm is slow here: `--no-audit --no-fund --cache=/home/nishachay/.npm-linux-cache`.
- Build needs **any** `AUTH_SECRET` in the env or `authSecret()` throws
  (`AUTH_SECRET=x npm run build`).
- No lint gate — `eslint.ignoreDuringBuilds: true`. `typecheck` + `build` only.

## The verification contract

`lib/probe.ts` is the gate, and its verdict mapping is subtle. It was **inverted
until commit `5afda81`**; verify against this table, not against intuition.

| Reality | oEmbed | Verdict |
|---|---|---|
| active + embeddable | `200` | `active` |
| exists, embedding disabled by uploader | `401` | `blocked` |
| **private, deleted, or nonexistent — indistinguishable** | `404` | `unknown` |
| malformed id | `400` | `invalid` |
| network error / timeout / abort | throw | `unknown` |

Two rules an agent will otherwise break:

1. **`unknown` is not `dead`.** oEmbed returns 404 for private, deleted and
   nonexistent alike, so the server can never *prove* a video is gone. Escalation
   lives in `nextStatusFor()` (`lib/schema.ts`) and requires `DEAD_THRESHOLD` (2)
   consecutive misses. Any `active` or `blocked` result resets the streak — a
   blocked video is demonstrably alive.
2. **`active` means "exists and embeddable", not "plays".** Region-blocked,
   Content-ID-claimed and age-restricted videos also return 200. Google documents
   this gap. Real playability comes from **player `onError`** codes
   (`100` removed/private, `101`/`150` owner blocks embedding, `5` HTML5/claim
   block, `153` missing Referer), which nothing wires up yet.

Only the admin `songs`/`approve` handlers and `refresh` may write `active`. Public
endpoints never set status.

`db:export` is the other half: it removes **only confirmed-dead** rows. Rows that
are merely unplayable right now stay in the bundle carrying their status, so pages
filter them out today and they return automatically when they heal. The old rule
(`status === "active"` only) meant one 300 ms timeout deleted a track for good.

## YouTube constraints that shape the code

Not optional, and not obvious from the code:

- **Do not scrape playlists.** Prohibited by consumer ToS §3 and Developer Policies
  III.E.6/III.D.7/III.I.14, and the pagination endpoint `/youtubei/` is
  `Disallow`ed in robots.txt. Use `playlistItems.list` — 1 unit per 50 videos,
  10,000 units/day free.
- **API data must be refreshed or deleted within 30 days** (III.E.4.d), and the
  36-month derived-metrics amendment explicitly excludes titles and creator names.
  This is why `catalog.json` is being demoted to a build artifact.
- **No background/hidden player** (III.I.9). `#yt-mount` is a 1×1 `opacity: 0.001`
  iframe and is therefore non-compliant — the visible player on the platter replaces it.
- **No overlays on the player's pixels** (RMF). `controls: 0` is fine (documented
  playerVar); your own UI on top is not. Viewport ≥200×200, and send `origin=` plus
  `Referrer-Policy: strict-origin-when-cross-origin` or you get error 153.
- **No ads on song pages.** Consumer ToS forbids "selling ads on a page where
  Content from the Service is the primary basis for such sales." `/song/[id]` *is* a
  YouTube video. `/` and `/artist/*` are fine.
- **Made-For-Kids lookup** is a documented obligation for every embedded video.

## Data model

Schema is `lib/schema.ts`; client is `lib/db.ts` (neon-http, returns `null` when
`DATABASE_URL` is unset). Tables: `artists`, `songs`, `song_versions`, `candidates`,
`pending_submissions`.

- **`status` is a `varchar`, not a PG enum.** The allowed values live only in
  `SONG_STATUSES` (`active | dead | private | blocked | unknown`) — nothing at the
  database level stops an invalid value.
- **All timestamps are `timestamp(..., { withTimezone: true })`,** which the driver
  returns as **`Date` objects, not ISO strings.** Anything crossing into a shared
  type (e.g. `Variant` in `lib/dataloader.ts`) must normalise via `.toISOString()` —
  there is a local `iso()` helper in `lib/api-core.ts` for this. Getting this wrong
  is a typecheck error; getting it wrong in `scripts/export-catalog.ts` is a silent
  `"2026-10-04T…"` vs `Date` mismatch in the bundle.
- **Song ids are the YouTube id**; versions are `${songId}__v${n}`, 1-based
  (`versionIdOf`). Routes key on `songs.id`, **not** `songs.slug`.
- `(artist_id, slug)` is deliberately **not unique** — 3,000 tracks collide on titles
  like "Intro" within one artist.
- Artist lookup is by `slug` (lowercase, dashes).
- `candidates` is harvest staging. Nothing touches `songs` until a candidate is
  promoted, so a bad scrape is a `DELETE` instead of a git revert.
- `report_count` has been removed. Reports are retired; `/api/report` returns 410.

### Artist ids are currently inconsistent

`scripts/import-catalog.ts` writes `artists.id = slug`; the admin API writes
`randomUUID()`. Two id shapes in one table means imports and admin-created artists
never reconcile. Unresolved — pick slug and backfill.

## Known live bugs

Present on this branch. Do not assume they are fixed.

| Bug | Where |
|---|---|
| Collab videos attach to the wrong artist — `eq(s.id, probe.youtubeId)` is **not artist-scoped**, so a Drake video gets appended as a version of Charlie Puth's song and the `-b` copy path at `:581` never runs | `lib/api-core.ts:551` |
| Shuffle is a fresh dice roll per skip (`Math.floor(Math.random() * q.length)`), so it can replay a track or go backwards. Also duplicated: the ENDED handler inlines `playQueue` logic instead of calling `next()`, and the two have drifted | `components/shell/player-context.tsx:231`, `:334` |
| `PlayerProvider` polls `setCur` every 250 ms at the context root, so **every** `usePlayer()` consumer re-renders 4×/sec — including all 97 `TrackRow`s on an artist page | `player-context.tsx:462` |
| Refs mutated during render (`live.current = …`, `toggleRef.current = …`) — unsupported under concurrent rendering | `player-context.tsx:125`, `:522-526` |
| `localStorage` written inside state updater functions — works only because it's idempotent under StrictMode double-invoke | `player-context.tsx:291`, `:268` |
| `document.title` overwritten and never restored, so it leaks across route transitions | `player-context.tsx:552` |
| `ArtistsForm` reads `data.artist.existing`; the handler returns `created`. Success message is always wrong | `components/admin/ArtistsForm.tsx:36` |
| No `orderBy` on the refresh query, so the same rows are re-probed forever and the rest starve | `lib/api-core.ts:407` |
| `/api/admin/refresh` is not yet cursor-batched — still ~120 sequential probes against a function timeout. `TODO.md` phase 3 | `lib/api-core.ts` |

## Architecture

**Two serverless functions only** (Vercel Hobby budget): `app/api/[...path]/route.ts`
(catch-all, all logic delegated) and the Auth.js route. `lib/api-core.ts` holds every
handler and maps `ApiError(status, msg)` → `{error}` JSON.

Public: `health`, `artists`, `songs` (`?all=1`), `songs/:id`, `submit` (POST, needs DB
else 503). `report` is retired and always 410.
Admin (Bearer `ADMIN_KEY` or an authenticated GitHub session via `lib/auth.ts`):
`verify?url=`, `pending`, `approve`, `reject`, `artists`, `songs`, `refresh`. There is
no `GET` for admin `artists` or admin `songs` — don't call one.

**Rendering.** `/`, `/artist/[slug]` are SSG + ISR (`revalidate = 3600`) with
`generateStaticParams`. `/song/[slug]` is deliberate on-demand ISR
(`generateStaticParams()` returns `[]`, `dynamicParams = true`) so build time does not
scale with the catalog; the sitemap lists song URLs so crawlers trigger the renders.
Keep it that way.

**Migration in flight:** reads currently come from `scripts/catalog.json` via
`lib/dataloader.ts`. `getCatalog()` is O(n) with **no memoization** and has 19
callsites, several per request — it does not survive 3,000 tracks. It is being
replaced by `lib/queries.ts`, one targeted `LIMIT`ed query per page, Postgres as the
only source of truth, with `catalog.json` demoted to a build artifact. Don't add new
`getCatalog()` calls.

## Determinism is a billing constraint

Vercel charges **no ISR write unit when regenerated output is unchanged**, and Hobby
pauses a project for **30 days** if you exceed a limit with no overage. So
`Date.now()` / `Math.random()` reaching rendered output costs real money at 3,000
pages.

This is why `lib/feed.ts` hashes day/week keys and `lib/vault.ts` uses FNV-1a for
cover treatments, cat numbers and side letters — it is not just hydration
correctness. Any new randomized-looking value must be seeded the same way.

## Scale constraints

- **Vercel Hobby is non-commercial only.** Fine while nothing is monetised; Pro
  ($20/mo) before any of it is. Hobby also caps ISR writes at 200k/mo and pauses on
  exceed.
- `getCatalog()`-style full-catalog reads are the thing to eliminate. The indexes
  that make 3,000 tracks work are `(artist_id, status, title)`,
  `(status, surfaced_at)`, `(status, last_checked_at)`.
- **The client must never hold 3,000 tracks.** Home should ship ~20 and lazy-load a
  content-hashed columnar manifest (~21 KB brotli at 3,000 rows) on first play.
- JS budget: **100–150 KB gzipped first load.** The median mobile site ships 558 KB
  and still fails Core Web Vitals.
- oEmbed sends no `Cache-Control` and `vary: Referer`, so it defeats shared caches —
  every probe is a real origin hit. Don't add `Cache-Control` expectations around it.

## Environment

`.env.example` documents everything. Nothing is required for the public site to
render (it falls back to the bundle). Required for admin/DB: `DATABASE_URL`,
`ADMIN_KEY`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
`ADMIN_GITHUB_LOGINS`. `YOUTUBE_API_KEY` is now effectively required — it supplies
durations cheaply and unlocks playlist harvesting.

`lib/db.ts` reads `DATABASE_URL` **once at module load**, so changing it mid-process
has no effect.

## CI / deploy

- `ci.yml` → `npm ci`, `tsc --noEmit`, `npm run build` with **no `DATABASE_URL`**, on
  purpose, so the static path stays working. Don't "fix" that by adding a secret.
- `refresh.yml` → daily `17 4 * * *`: `db:import` then POST `/api/admin/refresh`.
  It ends in `|| echo "… no-op"`, so **total failure is currently invisible** — fix
  before trusting the freshness claim. Also: GitHub auto-disables scheduled workflows
  in public repos after 60 days of inactivity, which matters once this goes OSS.
- Single catch-all function keeps the function count at 1 — don't add API routes.

## Conventions

- Conventional Commits with a scope: `feat:`/`fix:`/`build:`/`docs:` + `(scope)`.
- Small commits, one logical step each.
- Copy rule: tracks are **"outtakes", never "grails"**. Also avoid leak/rare/
  exclusive/authentic. The brand is archival restraint.
- Never commit secrets or `.env`. `git status` should be clean before pushing.
- Light mode is warm paper (`#e7e4dc`), not inverted dark. Covers, hero and turntable
  stay dark in both themes.
- Portraits are self-hosted from Wikimedia Commons with provenance in
  `scripts/portrait-credits.json` (currently **missing `charlie-puth` and
  `the-weeknd`** — complete before the repo goes public). Never hotlink social CDNs.

## Git

`main` is the only remote branch. Scale work lives on **`feat/scale-foundation`** —
build there and merge when it holds up. Note `sourcing` (one commit, the review-queue
and prefilter work) **was never pushed to origin**; it exists only locally.

`README.md`, `RECOMMENDATIONS.md` and `SECURITY.md` are all stale — they document
scripts that no longer exist (`fetch_artist_art.js`, `discover_youtube.js`,
`db:verify`, `db:build`, `db:seed`, `refresh_songs.js`) and a report system that was
retired. Trust the code over those files until they're rewritten.