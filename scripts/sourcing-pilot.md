# Sourcing pilot — tracker leads → verified outtakes

Rule: nothing enters `scripts/catalog.json` without a playable `probeYouTube`
result + human correctness review (title / artist / actually unreleased).
Scraped candidates land in `pending_submissions`, never straight to catalog.

Per-artist funnel:
1. Source — public sheet export where allowed, else fan playlists (yt-dlp, throttled).
2. Extract — YouTube IDs only (skip Drive / Discord / Streamable rot).
3. Dedupe — against catalog + within batch (collabs keep `-b` copies per artist).
4. Probe — `probeYouTube`, throttled, results cached.
5. Review — human correctness pass in admin.
6. Ship — portrait + `portrait-credits.json` + catalog entries, then check the box.

## Phase 1 (measure before scaling)

- [ ] 1. Drake (overlap — calibrates dedupe; we hold 21 tracks)
- [ ] 2. Playboi Carti (new — highest demand gap)
- [ ] 3. Kendrick Lamar (new — prestige gap)
- [ ] 4. Frank Ocean (new — standalone tracker at franktracker.net)

Ship one artist fully (through step 6) before starting the next.
After Phase 1, record yield stats below and decide Phase 2 pace.
Revisit SSG strategy before going past ~50 artists (build is ~10 min at 309 pages).

## Yield log

| artist | rows scraped | yt ids | already held | playable new | shipped | review min |
| ------ | ------------ | ------ | ------------ | ------------ | ------- | ---------- |
| Drake  | 1127         | 23     | 0            | 21 probe-playable, ~1 real song | 0 | — |
| Carti  | 14 searches + 866 playlists + 15 channels | 21,235 | 12 | 931 HIGH probed all-playable → 630 Carti-primary / 289 other-artist (27 Uzi, 23 Juice banked) | 0 (630 await ear-check) | — |

Learning 2026-09-12: sheet `Link(s)` are mostly *reference* links
(interviews, live footage confirming a song exists), not song audio —
probe says PLAY but content is interviews. Funnel works mechanically;
correctness review is doing the real work. Implication: use sheets for
*title discovery*, then search YouTube for those titles (fan playlists)
for actual audio.
