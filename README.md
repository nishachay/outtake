# outtake

An index of publicly available YouTube uploads of unreleased music. It stores video
ids and links out. It hosts nothing.

Every track is checked against YouTube's oEmbed endpoint before it is published,
and re-checked on a rolling cycle. Tracks that stop working are hidden and return
automatically when they don't.

Built with Next.js 15, Postgres, and the YouTube Data API.

## Running it

Requires Node 18 or newer and a Postgres database. The free tier at
[Neon](https://console.neon.tech) is enough.

Neon issues two connection strings for the same database and you need both. From
your project's **Connect** dialog:

- `DATABASE_URL` — the pooled endpoint, hostname contains `-pooler`
- `DATABASE_URL_UNPOOLED` — the direct endpoint, no `-pooler`

```bash
git clone https://github.com/nishachay/outtake.git
cd outtake
npm install
cp .env.example .env
```

Fill in `.env`, then:

```bash
npm run db:push      # create the tables
npm run db:import    # load scripts/catalog.json
npm run dev          # http://localhost:3000
```

Migrations run against `DATABASE_URL_UNPOOLED`. The pooled endpoint goes through
PgBouncer in transaction mode, which does not keep session state between
statements, and migration tools fail in ways that do not mention pooling.
`drizzle.config.ts` warns if only the pooled URL is set.

### Scripts

| Command | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run typecheck` | `tsc --noEmit`. This is the CI gate. |
| `npm run build` | Typecheck, then prerender |
| `npm run db:push` | Apply the schema |
| `npm run db:import` | `scripts/catalog.json` into Postgres |
| `npm run db:export` | Postgres back into `catalog.json` |
| `npm run db:prefilter` | Triage the submission queue |
| `npm run db:prefilter:apply` | Same, and write the verdicts |

There is no test suite. What this project verifies is a network contract against
YouTube, and a mocked response only proves the mock was called. Check behavioural
changes with a script instead:

```bash
npx tsx --env-file=.env ./check.ts
```

## How tracks are verified

`lib/probe.ts` calls YouTube's oEmbed endpoint and maps the response:

| Response | Means | Status |
| --- | --- | --- |
| 200 | exists and permits embedding | `active` |
| 401 | exists, embedding disabled by the uploader | `blocked` |
| 404 | private, deleted, or never existed | `unknown` |
| 400 | malformed id | `invalid` |
| network error | nothing learned | `unknown` |

Two things about that mapping are easy to get wrong, so they are worth stating
plainly.

A 404 does not distinguish a private video from a deleted one from a video that
never existed. YouTube will not say. So the server cannot conclude a video is gone
from a single 404, and a row only becomes `dead` after two consecutive `unknown`
results. An `active` or `blocked` result resets that counter, because a blocked
video is demonstrably still there.

`active` means the video exists and permits embedding. It does not mean it plays.
Region blocks, Content ID claims and age gates all still return success — Google
documents this in the `videos.list` reference. Actual playability is only visible
in the player, so the player's `onError` handler reports what it sees back to the
database. Listeners supply the signal that no API call can.

`GET /api/health` returns `oldestUnverifiedAt`. The re-verification sweep runs
oldest-first, so if that timestamp stops advancing the sweep has stalled.

## Layout

```
app/                  routes, plus one catch-all API handler
components/shell/     navigation rail, now-playing deck, player
components/vault/     covers, track lists, home/artist/song views
components/admin/     verification queue and approval
lib/probe.ts          the verification gate
lib/queries.ts        the read path
lib/schema.ts         tables and the status vocabulary
lib/feed.ts           seeded discovery rails
lib/vault.ts          cover treatment and deck model
scripts/              import, export, prefilter, catalog data
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Rights

This project hosts no audio or video. All rights remain with the rights holders.

Owners and rights holders can hide any track through the report action in the app.
Three verified complaints hide a track pending review. Takedown notices are
honoured by removing content first and discussing afterwards.

The embedded player follows YouTube's Required Minimum Functionality: it is
visible, at least 200x200, sends an `origin` parameter, and has no overlays drawn
over it. Playlists are enumerated with the Data API rather than scraped, which the
Terms prohibit.

## Licence

MIT for the code. The music is not ours to license.

Artist portraits are from Wikimedia Commons, with provenance recorded in
`scripts/portrait-credits.json` and credited in the app.
