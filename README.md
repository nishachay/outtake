# [ OUTTAKE ]

**A verified archive of unreleased music.** Every track is a public YouTube video
that has been machine-checked as playable. **We host nothing — we link out.**

Trust is the product. A track that has not passed verification is never visible, and
a track that stops working is re-checked daily and comes back automatically when it
does. Nothing here is a mirror, a rip, or a ripper's index.

---

## Why this exists

Fans of a catalogue obsess over what was recorded and never released. Those
recordings surface as ordinary public YouTube uploads, get re-uploaded, get taken
down, and get lost. The existing indexes of this material are unsearchable,
unverifiable, and full of dead links within weeks.

`OUTTAKE` does one thing: **it only shows you links that work right now.**

| Principle | What it means in the code |
| --- | --- |
| Never ship unverified | Only the admin approve flow and the freshness sweep can write `active`. |
| Never serve a dead link | oEmbed-verified before publishing, re-probed on a rolling cycle. |
| Never host the music | Every track links to a public YouTube upload. |
| Never be the reason a takedown fails | An uploader can hide a track immediately. See `/report`. |

---

## How it works

```
Google Form ─▶ Google Sheet ─▶ CI ─▶ YouTube Data API ─▶ Neon Postgres
 (indexable)     (queue)      (harvest)   (playlistItems)   (source of truth)
                                                             │
                                        ┌────────────────────┴─────────────┐
                                        │                                  │
                              one indexed query per cache        ISR + CDN serve
                              window, lazy client manifest         the rendered page
```

**Verification is two-stage, and stage two is free.**

1. **oEmbed** — bulk prefilter before anything ships. One origin hit per candidate.
2. **The listener.** The player's `onError` handler reports back. Google documents
   that `embeddable` is *not* the same as *plays* — region blocks, Content-ID claims
   and age gates all still return success. Only the player knows. So real listeners
   generate the playability signal, at any catalogue size, for no cost.

**Freshness is a rolling sweep, not a nightly panic.** Each track is re-verified on
roughly a seven-day cycle, oldest-verified-first, in bounded slices that the CI job
drains to completion. `GET /api/health` exposes `oldestUnverifiedAt` so you can tell
a draining sweep from a stalled one.

---

## Running it

Requires **Node 18+** (developed on 22) and a Neon Postgres project.

```bash
git clone https://github.com/nishachay/outtake.git
cd outtake
npm install
cp .env.example .env      # fill in the values below
npm run db:push           # create the schema
npm run db:import         # load scripts/catalog.json into Postgres
npm run dev               # http://localhost:3000
```

### Environment

Two database URLs, and they are **not** interchangeable:

| Variable | Hostname | Used by |
| --- | --- | --- |
| `DATABASE_URL` | contains `-pooler` | runtime |
| `DATABASE_URL_UNPOOLED` | no `-pooler` | `drizzle-kit` migrations only |

The pooled endpoint goes through PgBouncer in transaction mode, which has **no session
affinity**: `SET`, temp tables and multi-statement transactions silently do nothing,
and migrations fail in ways that never mention pooling. See `drizzle.config.ts`.

| Other variable | Required | Purpose |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | for harvesting | Playlist enumeration and durations. |
| `AUTH_SECRET` | for admin | `openssl rand -base64 32`. |
| `AUTH_GITHUB_ID` / `_SECRET` | for admin | Admin sign-in via GitHub. |
| `ADMIN_GITHUB_LOGINS` | for admin | Who may sign in. Empty = anyone authenticated. |
| `ADMIN_KEY` | for CI | Bearer token the refresh job uses. |
| `SITE_URL` | recommended | Canonical origin for metadata and the sitemap. |

### Commands

```bash
npm run typecheck   # tsc --noEmit — the real gate; there is no test suite
npm run build       # typecheck + prerender
npm run db:push     # apply schema (uses DATABASE_URL_UNPOOLED)
npm run db:import   # catalog.json -> Postgres, idempotent
npm run db:export   # Postgres -> catalog.json, merge-only. Review the diff.
```

**Verification has no test framework**, so `typecheck && build` is the gate. Behavioural
changes are checked with a throwaway `npx tsx` script — that is how the probe verdict
table below was validated.

---

## The verification contract

`lib/probe.ts` is the gate, and the mapping is subtle. It was **inverted** until
commit `5afda81`; it is correct now, and this table is the reference.

| Reality | oEmbed | Verdict |
| --- | --- | --- |
| Active, embeddable | `200` | `active` |
| Exists, embedding disabled by the uploader | `401` | `blocked` |
| **Private, deleted, or nonexistent — indistinguishable** | `404` | `unknown` |
| Malformed id | `400` | `invalid` |
| Network error / timeout | *throws* | `unknown` |

Two rules that are easy to break by accident:

1. **`unknown` is never `dead`.** oEmbed returns `404` for private, deleted and
   nonexistent alike, so the server can never *prove* a video is gone. Escalation to
   `dead` requires `DEAD_THRESHOLD` (2) consecutive misses, and any `active` or
   `blocked` result resets the streak — a blocked video is demonstrably alive.
2. **`active` means "exists and embeddable", not "plays".** Google documents that gap
   explicitly. Playability comes from the player's `onError` codes:
   `100` removed/private · `101`/`150` owner blocks embedding · `5` HTML5/claim block ·
   `153` missing Referer.

`npm run db:export` removes **only confirmed-dead** rows. Anything merely unplayable
stays in the bundle carrying its status: the pages hide it today, and it returns
automatically when it heals.

---

## Legal and ethical stance

This project indexes **publicly available YouTube uploads** and links to them. It does
not host, mirror, download or redistribute any audio or video.

- Every track links out to its original upload.
- All rights remain with the rights holders.
- An uploader or rights holder can have a track hidden immediately via `/report`, and
  3 verified complaints auto-hide a track pending review.
- A valid takedown notice is honoured by hiding content **immediately**, not after
  deliberation.
- This site carries no advertising on song pages. YouTube's consumer Terms prohibit
  "selling ads on a page where Content from the Service is the primary basis for such
  sales", and a song page here *is* a YouTube video.

See `/about` and `/dmca`. If you are a rights holder and something here should not be
linked, that is a bug, not a dispute.

---

## YouTube API compliance

This is an authorised **API Client**. That is a legal status, not a courtesy, and it
brings obligations that are implemented here rather than assumed:

- Playlist enumeration uses `playlistItems.list`. Scraping is prohibited by the
  consumer Terms §3 and Developer Policies III.E.6/III.D.7/III.I.14, and the
  continuation endpoint is `Disallow`ed in `robots.txt`.
- API data is refreshed or deleted within 30 days (III.E.4.d). `scripts/catalog.json`
  is a committed snapshot for reproducibility, not a long-lived store.
- Pages displaying YouTube content make the source clear, link the YouTube Terms, and
  the privacy policy states that the YouTube Data API is used.
- The embedded player is visible, at least 200×200, sends `origin=`, and never has
  overlays drawn on its pixels (Developer Policies III.I.9, RMF).
- Made-For-Kids status is looked up per embedded video.

---

## Project layout

```
app/                    pages, one catch-all API route, auth
  api/[...path]/        every endpoint; delegates to lib/api-core.ts
components/shell/       rail, turntable deck, player engine
components/vault/       covers, rows, home/artist/song views, search
components/admin/       probe -> approve, review queues
lib/
  probe.ts              the verification gate
  queries.ts            the read path — Postgres is the only source of truth
  schema.ts             Drizzle schema and status vocabulary
  feed.ts               deterministic, seeded discovery rails
  vault.ts              covers, deck-song model, formatting
scripts/                import/export, prefilter, harvest tooling
```

## Performance notes

Determinism is a **billing** constraint, not just a hydration one. Vercel charges no
ISR write unit when regenerated output is unchanged, and the Hobby plan pauses a
project for 30 days if you exceed a limit with no overage. That is why `lib/feed.ts`
hashes day and week keys and `lib/vault.ts` seeds every derived value with FNV-1a:
**`Date.now()` and `Math.random()` must never reach rendered output.**

The client does not hold the catalogue. Home renders a screenful and lazy-loads a
columnar queue manifest on first play — measured on 3,168 rows, 269.8 KB of raw JSON
compresses to **7.2 KB brotli / 10.3 KB gzip**.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: to add a track, submit
a link at `/submit` or run the harvester; a human reviews candidates flagged "confirm
by ear" before anything ships.

## Credits

- Artist portraits: Wikimedia Commons contributors — see
  [`scripts/portrait-credits.json`](./scripts/portrait-credits.json), credited in-app.
- Every recording belongs to its rights holder. This archive only links to public
  YouTube uploads.

## Licence

MIT for the code. The music is not ours to license.
