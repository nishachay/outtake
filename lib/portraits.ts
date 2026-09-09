/** Canonical artist portrait paths (self-hosted, freely licensed —
 *  see scripts/portrait-credits.json for provenance). */
export const ARTIST_PORTRAIT: Record<string, string> = {
  "charlie-puth": "/assets/artists/charlie-puth.jpg",
  "the-weeknd": "/assets/artists/the-weeknd.jpg",
  "kanye-west": "/assets/artists/kanye-west.jpg",
  "travis-scott": "/assets/artists/travis-scott.jpg",
  "drake": "/assets/artists/drake.jpg",
  "justin-bieber": "/assets/artists/justin-bieber.jpg",
  "post-malone": "/assets/artists/post-malone.jpg",
  "xxxtentacion": "/assets/artists/xxxtentacion.jpg",
  "lil-uzi-vert": "/assets/artists/lil-uzi-vert.jpg",
  "ariana-grande": "/assets/artists/ariana-grande.jpg",
  "juice-wrld": "/assets/artists/juice-wrld.jpg",
  "billie-eilish": "/assets/artists/billie-eilish.jpg",
};

export function portraitFor(artistSlug: string): string | null {
  return ARTIST_PORTRAIT[artistSlug] ?? null;
}
