import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const artists = pgTable(
  "artists",
  {
    id: text("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    // Present in catalog.json but missing from the schema — the DB import silently
    // dropped these, so every DB-backed artist hero lost its tagline and its
    // avatar fallback.
    tag: varchar("tag", { length: 200 }),
    initials: varchar("initials", { length: 8 }),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("artists_slug_unique").on(t.slug)],
);

export const songs = pgTable(
  "songs",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull(),
    slug: varchar("slug", { length: 300 }).notNull(),
    // Pluggable source layer. YouTube is the only registered provider today;
    // adding another later is a new probe module plus a registry entry, not a
    // refactor of every read path.
    sourceProvider: varchar("source_provider", { length: 20 }).notNull().default("youtube"),
    youtubeId: varchar("youtube_id", { length: 40 }).notNull(),
    durationSec: integer("duration_sec"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    // Consecutive probes that could not confirm existence. oEmbed returns 404 for
    // private AND deleted AND nonexistent alike, so the server can never *prove*
    // a video is gone. A row only becomes `dead` after DEAD_THRESHOLD repeats,
    // which is what stops one 300ms timeout from deleting a track from the
    // archive. Reset to 0 by any `active` or `blocked` result.
    deadStreak: integer("dead_streak").notNull().default(0),
    // Denormalized count of verified alternate takes, so the artist page can sort
    // by version density and the discovery rail can find multi-take tracks
    // without a join.
    sourceCount: integer("source_count").notNull().default(1),
    playCount: integer("play_count").notNull().default(0),
    // Player onError 153 = the request lacked Referer identification. We surface
    // this to the listener rather than treating it as a content failure.
    lastErrorCode: integer("last_error_code"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    // When the track first entered the archive — drives "recently surfaced",
    // sitemap lastmod, and /today.
    surfacedAt: timestamp("surfaced_at", { withTimezone: true }).notNull().defaultNow(),
    era: varchar("era", { length: 120 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Artist page: WHERE artist_id = ? AND status = 'active' ORDER BY title.
    // The single most-hit index on the site at 88 artists.
    index("songs_artist_status_title_idx").on(t.artistId, t.status, t.title),
    // Discovery feeds: WHERE status = 'active' ORDER BY surfaced_at DESC.
    index("songs_status_surfaced_idx").on(t.status, t.surfacedAt),
    // Refresh job: oldest-verified-first. Without this ordering the same rows get
    // picked every run and the rest starve forever.
    index("songs_status_checked_idx").on(t.status, t.lastCheckedAt),
    index("songs_youtube_idx").on(t.youtubeId),
    // Version-density discovery rail + "most alternate takes" sort.
    index("songs_source_count_idx").on(t.sourceCount),
    // NOT unique: song routes are keyed on songs.id (the source id), never on
    // slug, and 3,000 tracks will collide on titles like "Intro" within one artist.
    index("songs_artist_slug_idx").on(t.artistId, t.slug),
  ],
);

export const songVersions = pgTable(
  "song_versions",
  {
    id: text("id").primaryKey(),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 200 }),
    sourceProvider: varchar("source_provider", { length: 20 }).notNull().default("youtube"),
    youtubeId: varchar("youtube_id", { length: 40 }).notNull(),
    durationSec: integer("duration_sec"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    deadStreak: integer("dead_streak").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("song_versions_song_idx").on(t.songId),
    index("song_versions_yt_idx").on(t.youtubeId),
    // Versions are probed on the same rolling schedule as canonicals.
    index("song_versions_status_checked_idx").on(t.status, t.lastCheckedAt),
  ],
);

/**
 * Harvest staging. Every candidate the harvester discovers lands here before
 * anything touches `songs`, so a bad scrape or a wrong artist mapping is a DELETE
 * instead of a git revert across 3,000 rows.
 *
 * This is the table that makes 3,000 tracks a one-day job rather than a month.
 */
export const candidates = pgTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id").references(() => artists.id, { onDelete: "set null" }),
    youtubeId: varchar("youtube_id", { length: 40 }).notNull(),
    title: varchar("title", { length: 300 }),
    author: varchar("author", { length: 200 }),
    durationSec: integer("duration_sec"),
    // Provenance: which playlist id / tracker url / form row produced this.
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    status: varchar("status", { length: 20 }).notNull().default("new"),
    rejectReason: text("reject_reason"),
    probeResult: jsonb("probe_result"),
    probedAt: timestamp("probed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candidates_source_yt_unique").on(t.source, t.youtubeId),
    index("candidates_artist_idx").on(t.artistId),
    index("candidates_status_idx").on(t.status),
  ],
);

export const pendingSubmissions = pgTable(
  "pending_submissions",
  {
    id: text("id").primaryKey(),
    youtubeUrl: text("youtube_url").notNull(),
    suggestedArtist: text("suggested_artist"),
    suggestedTitle: text("suggested_title"),
    note: text("note"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    probeResult: jsonb("probe_result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("pending_submissions_status_idx").on(t.status)],
);

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Song = typeof songs.$inferSelect;
export type NewSong = typeof songs.$inferInsert;
export type SongVersion = typeof songVersions.$inferSelect;
export type NewSongVersion = typeof songVersions.$inferInsert;
export type PendingSubmission = typeof pendingSubmissions.$inferSelect;
export type NewPendingSubmission = typeof pendingSubmissions.$inferInsert;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;

export const artistsRelations = relations(artists, ({ many }) => ({
  songs: many(songs),
}));

export const songsRelations = relations(songs, ({ one, many }) => ({
  artist: one(artists, {
    fields: [songs.artistId],
    references: [artists.id],
  }),
  versions: many(songVersions),
}));

export const songVersionsRelations = relations(songVersions, ({ one }) => ({
  song: one(songs, {
    fields: [songVersions.songId],
    references: [songs.id],
  }),
}));

export const pendingSubmissionsRelations = relations(pendingSubmissions, () => ({}));

export const candidatesRelations = relations(candidates, ({ one }) => ({
  artist: one(artists, {
    fields: [candidates.artistId],
    references: [artists.id],
  }),
}));

/**
 * `unknown` exists so a transport failure is never recorded as a content verdict.
 * `blocked` means the uploader disabled embedding (oEmbed 401) — the video is
 * alive but unusable in our player, which is a different problem from "gone".
 *
 * `private` is retained because players report it (onError 100 conflates
 * removed/private), but the probe can never produce it: oEmbed cannot
 * distinguish private from deleted.
 */
export const SONG_STATUSES = ["active", "dead", "private", "blocked", "unknown"] as const;
export type SongStatus = (typeof SONG_STATUSES)[number];

/** The only status that may appear in the public archive. */
export const PUBLIC_STATUSES: readonly SongStatus[] = ["active"];

/** Worth spending a probe on. `dead` recovers when links are re-uploaded. */
export const PROBEABLE_STATUSES: readonly SongStatus[] = [
  "active",
  "unknown",
  "blocked",
  "private",
];

/**
 * Consecutive "could not confirm existence" results required before a row may be
 * treated as dead. At 3,000 tracks a daily full sweep is quota- and time-bound,
 * so freshness is maintained on a rolling ~7-day cohort instead.
 */
export const DEAD_THRESHOLD = 2;

export const PENDING_STATUSES = ["pending", "verifying", "ready", "rejected", "shipped"] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

export const CANDIDATE_STATUSES = ["new", "keep", "flag", "shipped", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const SOURCE_PROVIDERS = ["youtube"] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

/**
 * Next status for a row given a probe verdict.
 *
 * The whole point: only `active` and `blocked` carry information that the video
 * still exists. `unknown` increments the streak; nothing else ever becomes `dead`
 * without DEAD_THRESHOLD independent misses.
 */
export function nextStatusFor(
  current: SongStatus,
  probe: { status: "active" | "blocked" | "unknown" | "invalid" },
  deadStreak: number,
): { status: SongStatus; deadStreak: number } {
  if (probe.status === "active") return { status: "active", deadStreak: 0 };
  if (probe.status === "blocked") return { status: "blocked", deadStreak: 0 };
  if (probe.status === "invalid") {
    return { status: "dead", deadStreak: deadStreak + 1 };
  }
  const streak = deadStreak + 1;
  return { status: streak >= DEAD_THRESHOLD ? "dead" : "unknown", deadStreak: streak };
}

/** Version id derivation, matches the legacy `songId__v{n}` (1-based) convention. */
export function versionIdOf(songId: string, n: number): string {
  return `${songId}__v${n}`;
}