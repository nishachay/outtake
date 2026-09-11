# [ OUTTAKE ] — verified archive of unreleased music

Only YouTube videos that are currently playable. Trust is the product — every track passes machine verification before it ships, gets re-checked daily, and listeners can flag dead links. We never host audio or video; we link to YouTube.

**Live slate:** 288 tracks across 12 verified artists (97 Charlie Puth, 50 The Weeknd, 141 more).

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # typecheck + prerender (288 songs / 12 artists)
npm start        # serve the production build
```

No database needed — the public site runs entirely off the bundled verified catalog (`scripts/catalog.json`).

## How it works

- **Static-first site** (Next.js 15 App Router + TypeScript + Tailwind): home, artist, and song pages are pre-rendered + ISR, SEO-friendly, work without JS.
- **Verify-first pipeline**: keyless YouTube oEmbed probing (`lib/probe.ts`) gates everything. Only the admin approve/add flows and the daily refresh job can mark a track playable.
- **Community loop**: anyone can submit a link (`/submit`) or report a dead one (deck button). Three reports auto-flag a track; the daily refresh resurrects it if it plays again.
- **One serverless API** (`app/api/[...path]/route.ts`) + **Neon Postgres + Drizzle** for admin/queue/report data. Without `DATABASE_URL` everything degrades to the static bundle.

## Project layout

```
app/                   pages + API catch-all + auth
components/shell/      vault canvas: rail, turntable deck, player engine
components/vault/      covers, rows, home/artist/song views, submit
components/admin/      probe → approve admin suite
lib/                   catalog loader, probe, API core, schema, utils
scripts/catalog.json   the verified catalog (source of truth)
scripts/portrait-credits.json   artist portrait provenance
public/assets/artists/ self-hosted artist portraits (Wikimedia Commons)
```

## Environment

See `.env.example`. The public site needs nothing. Admin/DB features need `DATABASE_URL`, `ADMIN_KEY`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `ADMIN_GITHUB_LOGINS` (+ optional `YOUTUBE_API_KEY`).

## Credits

- Artist portraits: Wikimedia Commons contributors (see `scripts/portrait-credits.json`, credited in-app).
- Music belongs to its rights holders; this archive only links to public YouTube uploads.

MIT — code only.
