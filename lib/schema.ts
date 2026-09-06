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
    youtubeId: varchar("youtube_id", { length: 40 }).notNull(),
    durationSec: integer("duration_sec"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    reportCount: integer("report_count").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("songs_artist_idx").on(t.artistId),
    index("songs_status_idx").on(t.status),
    index("songs_youtube_idx").on(t.youtubeId),
    uniqueIndex("songs_artist_slug_idx").on(t.artistId, t.slug),
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
    youtubeId: varchar("youtube_id", { length: 40 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    reportCount: integer("report_count").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("song_versions_song_idx").on(t.songId),
    index("song_versions_yt_idx").on(t.youtubeId),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    versionId: text("version_id").references(() => songVersions.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_song_idx").on(t.songId)],
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
export type Report = typeof reports.$inferSelect;
export type PendingSubmission = typeof pendingSubmissions.$inferSelect;
export type NewPendingSubmission = typeof pendingSubmissions.$inferInsert;

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

export const songVersionsRelations = relations(songVersions, ({ one, many }) => ({
  song: one(songs, {
    fields: [songVersions.songId],
    references: [songs.id],
  }),
  reports: many(reports),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  song: one(songs, {
    fields: [reports.songId],
    references: [songs.id],
  }),
  version: one(songVersions, {
    fields: [reports.versionId],
    references: [songVersions.id],
  }),
}));

export const pendingSubmissionsRelations = relations(pendingSubmissions, () => ({}));

export const SONG_STATUSES = ["active", "dead", "private"] as const;
export type SongStatus = (typeof SONG_STATUSES)[number];

export const PENDING_STATUSES = ["pending", "verifying", "ready", "rejected", "shipped"] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

/** Listener reports after which a canonical song (or version) is flagged dead. */
export const REPORT_THRESHOLD = 3;

/** Version id derivation, matches the legacy `songId__v{n}` (1-based) convention. */
export function versionIdOf(songId: string, n: number): string {
  return `${songId}__v${n}`;
}