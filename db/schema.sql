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

-- The library (library.js): one row for each thing uploaded to R2 (a photo with every set of sizes made from it,
-- or a video version with its frames). id is the storage key of its main file, fixed for good; name is what the
-- editor shows, changed freely. Kept up to date with R2 by library.js whenever the Library is looked at.
--   kind: photo | video     grp: site (backgrounds and other site pictures) | painting
--   files: JSON list of its storage keys     bytes: their total size     added: when first uploaded
CREATE TABLE IF NOT EXISTS media (
  id     TEXT PRIMARY KEY,
  kind   TEXT NOT NULL,
  grp    TEXT NOT NULL,
  name   TEXT NOT NULL,
  files  TEXT NOT NULL,
  bytes  INTEGER NOT NULL,
  added  TEXT NOT NULL
);
