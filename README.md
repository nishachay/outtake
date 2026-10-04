# outtake

A verified archive of unreleased music. It indexes publicly available YouTube
uploads and links to them. It hosts nothing.

Every track is machine-checked as playable before it appears, and re-checked on a
rolling cycle. Tracks that stop working are hidden and return automatically when
they don't.

```
288 tracks / 12 artists / 16 alternate takes
Next.js 15 · Postgres (Neon) · Drizzle · YouTube Data API
```

## Why

Unreleased recordings surface as ordinary public YouTube uploads. They get
re-shared, taken down, and lost. Every existing index of this material is
unsearchable, unverifiable, and full of dead links within weeks.

This one only shows you links that work.

## Running it

Node 18+. You need a free Postgres database from
[Neon](https://console.neon.tech) — the project takes two connection strings, and
they are not interchangeable (see below).

```bash
npm install
cp .env.example .env
npm run db:push      # create the schema
npm run db:import    # load scripts/catalog.json
npm run dev          # http://localhost:3000
```

In `.env`, set:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Pooled endpoint — hostname contains `-pooler`. Used at runtime. |
| `DATABASE_URL_UNPOOLED` | Direct endpoint — no `-pooler`. Used by migrations only. |
| `AUTH_SECRET` | `openssl rand -base64 32`. |
| `YOUTUBE_API_KEY` | Only needed for harvesting and durations. |

The pooled endpoint goes through PgBouncer in transaction mode, which has no session
affinity. `SET`, temp tables and multi-statement transactions silently do nothing
across statements, so migrations run on the direct connection instead.
`drizzle.config.ts` warns if you only set the pooled one.

### Commands

```bash
npm run typecheck    # tsc --noEmit. This is the gate.
npm run build        # typecheck, then prerender
npm run dev          # dev server
npm run db:push      # apply schema
npm run db:import    # catalog.json -> Postgres (idempotent)
npm run db:export    # Postgres -> catalog.json (merge-only; review the diff)
npm run db:prefilter      # triage the submission queue, write nothing
npm run db:prefilter:apply # same, but writes
```

There is no test suite. Verification here is a network contract against YouTube,
which unit tests mock into meaninglessness, so behavioural changes are checked with
a throwaway script:

```bash
npx tsx --env-file=.env ./check.ts
```

## Layout

```
app/                  routes; one catch-all API handler
  api/[...path]/      every endpoint, delegating to lib/api-core.ts
components/shell/     rail, turntable deck, player engine
components/vault/     covers, track lists, home/artist/song views, search
components/admin/     verification queue and track approval
lib/
  probe.ts            the verification gate
  queries.ts          the read path
  schema.ts           tables and the status vocabulary
  feed.ts             seeded discovery rails
  vault.ts            cover treatment, deck model, formatting
scripts/              import, export, prefilter, catalog data
```

## How verification works

`lib/probe.ts` gates everything. It queries YouTube's oEmbed endpoint and maps the
response to a status:

| Reality | oEmbed | Status |
| --- | --- | --- |
| Exists, embeddable | 200 | `active` |
| Exists, embedding disabled by uploader | 401 | `blocked` |
| Private, deleted, or nonexistent — indistinguishable | 404 | `unknown` |
| Malformed id | 400 | `invalid` |
| Network failure | throws | `unknown` |

Two properties of that table matter more than the table itself.

`404` is returned for private, deleted and never-existed videos alike, so the
server cannot prove a video is gone. A row only becomes `dead` after two
consecutive `unknown` results; any `active` or `blocked` result resets that counter.
This was not the original behaviour — the old code treated a network timeout as
proof of death, and `db:export` then deleted the track from the archive.

`active` means the video exists and permits embedding. It does not mean it plays.
Region blocks, Content-ID claims and age gates all still return success. Google
documents this gap explicitly. Actual playability is detected by the player's
`onError` handler, which reports back to the database — so listeners generate the
verification signal that no API can provide.

`GET /api/health` reports `oldestUnverifiedAt`. The sweep runs oldest-first, so a
timestamp that stops advancing means the sweep has stalled.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Rights

This project hosts no audio or video. It stores YouTube video ids and links to
public uploads. All rights remain with the rights holders.

Track owners and rights holders can hide any track immediately via `/report`.
Three verified complaints auto-hide a track pending review. Valid takedown notices
are honoured by removing content first and discussing afterwards.

The embedded player follows YouTube's Required Minimum Functionality: it is visible,
at least 200x200, sends `origin=`, and has no overlays drawn over it. Playlist
enumeration uses the Data API rather than scraping, which the Terms prohibit.

## Licence

MIT for the code. The music is not ours to license.

Portraits are from Wikimedia Commons; provenance is in
`scripts/portrait-credits.json` and credited in the app.
