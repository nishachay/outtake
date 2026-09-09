# AGENTS.md

`{ OUTTAKE }` — "unreleased music vault". A **verified archive of unreleased music**: only YouTube videos that are currently playable. Trust is the product — never ship a track that has not passed verification. We never host audio/video; we only link to YouTube.

The curated slate is **288 tracks across 12 verified artists** (97 Charlie Puth outtakes, 50 The Weeknd vault tracks, 141 tracks across 10 more artists — every id oEmbed-verified; roster lives in `scripts/catalog.json`). The frontend is **Next.js 15 (App Router) + TypeScript + Tailwind**; the backend is a **single catch-all serverless API** backed by **Neon Postgres + Drizzle** (admin only) with a **static catalog fallback** for the public site.

## Run & verify

- Dev: `npm run dev` → http://localhost:3000 (Turbopack).
- Build: `npm run build` (typecheck + prerender all 288 songs / 12 artists). No lint gate (eslint ignoreDuringBuilds); rely on `npx tsc --noEmit` + `npm run build`.
- API smoke (no DB): `npm run build && npm start`, then `curl :3000/api/health` → `{"mode":"static-fallback", tracks: 304}`. Admin endpoints 401 without a bearer `ADMIN_KEY`, and 503 "database unavailable" when `DATABASE_URL` is unset.
- npm on this Windows-drvfs box is slow: install with `--no-audit --no-fund --cache=/home/nishachay/.npm-linux-cache` and long timeouts. `next build` takes ~10 min locally (drvfs + low RAM); when a stale `next-server` is running it can serve old routes — always kill all node/next PIDs before `next build`/`next start`.

## Architecture

**Static-first public site**: `/`, `/artist/[slug]`, `/song/[slug]` are SSG + ISR (`revalidate = 3600`, `generateStaticParams`) with `<title>`/meta/OG/Schema.org. Content reads the bundled `scripts/catalog.json` via `lib/dataloader.ts` — so the public site works with zero DB and stays SEO-friendly (works without JS).

**Single serverless API**: `app/api/[...path]/route.ts` is the one catch-all function (Hobby-safe, ≤12 funcs). Public: `health`, `artists`, `songs` (`?all=1`), `songs/:id`, `report` (POST), `submit` (POST "found an outtake"). Admin (Bearer `ADMIN_KEY` or an authenticated GitHub session via `lib/auth.ts`): `verify?url=`, `pending`, `approve`, `reject`, `artists`, `songs`, `refresh`. All logic lives in `lib/api-core.ts` (returns `ApiError(status,msg)` → JSON `{error}`).

**DB**: Neon Postgres, Drizzle. Schema in `lib/schema.ts` — `artists`, `songs`, `song_versions`, `reports`, `pending_submissions` (+ relations). Client in `lib/db.ts` (neon-http; returns `null` when `DATABASE_URL` unset so the app degrades to the static bundle). Never write raw SQL outside `lib/*`. Timezones: all timestamps ISO TEXT written by the app.

**Verification is sacred**: `lib/probe.ts` `probeYouTube()` — keyless `youtube.com/oembed` first (200→active, 404→dead, 401→private, 403→dead-as-embed-disabled; network failure → dead, never throws), optional `YOUTUBE_API_KEY` boosts status/duration. Only the admin `songs`/`approve` handlers and the `refresh` job may set a status to `active`; public endpoints never trust client status. A canonical song/version is auto-flagged `dead` after **3** reports (`REPORT_THRESHOLD` in `lib/schema.ts`); `refresh` resurrects it if it plays again. A collab id can appear in two artists' entries — never dedupe on id.

## Data model gotchas

- `songs.status`: `active` | `dead` | `private`. The canonical row's verdict is authoritative; versions are surfaced only when the canonical or a version is `active`.
- Versions: derived id = `${songId}__v${n}` (`versionIdOf`, 1-based); a version whose youtubeId equals the canonical id is skipped.
- Artist lookup by `slug` (lowercased, dashes). Song ids are stable strings; Charlie entries use the YouTube id.
- `scripts/catalog.json` only ever contains verified, playable videos. `scripts/import-catalog.ts` (`npm run db:import`) idempotently upserts catalog → Neon (artists, canonical songs, versions) — safe to run before the refresh job; requires `DATABASE_URL` in `.env`.

## Components & design

- `components/shell/` — persistent vault canvas: `AppShell` (rail + stage + deck), `PlayerSidebar` (turntable deck), `LeftRail`, `FloatingCapsule`, `AboutModal`, `Turntable` (SVG deck, no text), `player-context.tsx` (YT-iframe engine: queue, versions, likes, seek, shortcuts, reports).
- `components/vault/` — `VaultCover` (artist portrait under dark archival treatment + seeded crop/zoom/shade + accent bar; no text, never thumbnails), `TrackRow`, `HomeClient`/`ArtistClient`/`SongClient` (stage views), `SubmitForm`, `ArtistAvatar` (initials fallback). Brand is the `{ OUTTAKE }` wordmark only — no glyph.
- `components/admin/` — `ArtistsForm`, `SongsForm` (probe → approve flow), `PendingQueue`. Admin pages live under `app/admin/(vault)/` (auth-guarded layout); `app/admin/login/` stays outside the guard or logins redirect-loop.
- Portraits: self-hosted face crops in `public/assets/artists/` (Wikimedia Commons leads, visually reviewed; provenance in `scripts/portrait-credits.json`, credited in About modal). Never hotlink social CDNs (expiring URLs).
- Design tokens in `app/globals.css`: vault vars (`--bg-canvas`, `--pill-*`, monochrome + `#f43f5e`/`#f87171` red only); light mode is warm paper (`#e7e4dc` canvas), not inverted dark. Covers/hero/turntable stay dark in both themes. Copy rule: tracks are "outtakes", never "grails".

## Env

`.env.example` documents all vars. Vercel + GitHub Actions need: `DATABASE_URL` (required for DB/admin), `ADMIN_KEY`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `ADMIN_GITHUB_LOGINS` (comma-separated GitHub logins allowed to sign in), optional `YOUTUBE_API_KEY`. Public site works without any of them via the static bundle.

## Deploy / CI

- Vercel Hobby: Next.js preset, no `vercel.json` needed. One catch-all API function keeps the function count at 1.
- `.github/workflows/ci.yml`: on push/PR to `main` → `npm ci`, `npx tsc --noEmit`, `npm run build` (no DATABASE_URL → exercises static-fallback).
- `.github/workflows/refresh.yml`: daily `17 4 * * *` (+ manual dispatch) → `npm run db:import` then `POST $PROD_URL/api/admin/refresh` with `Authorization: Bearer $ADMIN_KEY`. No-op with a warning when secrets are unset.
- `main` is the only branch; retired lines survive as tags (`archive/vanilla-ui`, `archive/new-ui`, `archive/grails`).

## Conventions

- Plain Next.js / TypeScript / Tailwind; strict mode; small scoped commits (one logical step per commit) — no giant grab-bag commits.
- Commit messages: Conventional Commits with scope (`feat:`/`fix:`/`build:`/`docs:` + `(scope)`).
- Never commit secrets or `.env`. `git status` should be clean before pushing.
