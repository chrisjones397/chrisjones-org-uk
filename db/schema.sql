-- The site's content database (Cloudflare D1: site-content for live, site-content-dev for dev).
-- Every piece of content is one row in entries, holding its draft and its published version side by side
-- as JSON. A change waiting to be published is any row whose draft differs from its published version.
--   kind:      painting | section | text | settings | background | links
--   draft:     what the editor shows; NULL means deleted in the draft (still live until published)
--   published: what visitors see; NULL means not published yet
-- Publishing copies draft to published for the chosen rows, as one release, and keeps a revision of each.

CREATE TABLE IF NOT EXISTS entries (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  draft        TEXT,
  published    TEXT,
  draft_at     TEXT,
  draft_by     TEXT,
  published_at TEXT
);

-- One row each time something is published (the "Publish" button), with who and when.
CREATE TABLE IF NOT EXISTS releases (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  at    TEXT NOT NULL,
  by    TEXT,
  note  TEXT
);

-- What each published row became in each release (data NULL: it was deleted), and what it was before.
CREATE TABLE IF NOT EXISTS revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES releases(id),
  entry_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  data       TEXT,
  previous   TEXT
);
CREATE INDEX IF NOT EXISTS revisions_entry ON revisions(entry_id, id);

-- The Library (library.js): one row for each item, a photo or a video (a set of versions), whose files are all in
-- one folder in R2, media/<id>/ (paths.js has the layout). id: its code, 8 hex digits, made when it's created and
-- never changed; name: what the editor shows, changed freely.
--   kind: photo | video     grp: site (backgrounds and other site pictures) | painting
--   hash: a photo's content (the first 12 hex digits of its SHA-256), so the same photo isn't stored twice
--   data: JSON, what it records about its parts: original { w, h }, renditions { r1: { widths, w, h, ext } },
--         versions [{ file, w, h, bytes, seconds }], frames { wide: { dir, widths, from }, tall: {...} }
CREATE TABLE IF NOT EXISTS library (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  grp       TEXT NOT NULL,
  name      TEXT NOT NULL,
  hash      TEXT,
  data      TEXT NOT NULL DEFAULT '{}',
  added     TEXT NOT NULL,
  added_by  TEXT
);
CREATE INDEX IF NOT EXISTS library_hash ON library(hash);
