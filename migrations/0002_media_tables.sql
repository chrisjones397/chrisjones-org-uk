-- Migration 0002: the media layer's five tables (docs/entities.md, section 2), empty. Step 4, slice 2, sub-step (a).
-- Nothing reads or writes them yet: the site and the editor run exactly as before. Later sub-steps fill them from
-- the Library's records and the paintings' `process` records, then switch the code over.
--
-- The media layer is a record of facts, never drafted: this was uploaded, these settings produced those pictures.
-- The editorial layer (the `entries` table) meets it at one point: a document names a rendition by its id.
-- Foreign keys are enforced by D1. The Library item itself stays the existing `library` table (one row per item).
-- Times are ISO text and `..._by` is who (an email), as in the other tables.

-- One row for each distinct piece of stored content, known only by the SHA-256 digest of its bytes (64 hex
-- digits), which is also its key in R2 and its address, /media/<digest>.<ext>. No name, no folder, no meaning.
-- A file's row is deleted (and then the file) only when no original and no rendition refers to it.
CREATE TABLE file (
  digest    TEXT PRIMARY KEY CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  bytes     INTEGER NOT NULL CHECK (bytes > 0),
  type      TEXT NOT NULL,              -- content type: image/jpeg, video/mp4
  w         INTEGER,                    -- pixels (NULL if they couldn't be read)
  h         INTEGER,
  seconds   REAL,                       -- videos only
  added     TEXT NOT NULL,
  added_by  TEXT
);

-- The untouched uploaded file or files of a Library item: a photo has exactly one, a video one for each of its
-- versions. A file is the original of at most one item (so the digest alone is the key): uploading the same
-- photo again finds the item it already belongs to.
CREATE TABLE original (
  digest   TEXT PRIMARY KEY REFERENCES file(digest),
  item_id  TEXT NOT NULL REFERENCES library(id) ON DELETE CASCADE
);
CREATE INDEX original_item ON original(item_id);

-- The darkroom settings applied to an item: the thing that gets edited. Several per item (a pentaptych
-- photographed once is one item with five recipes).
--   kind:     flat (four corners, squared up) | scene (straighten and crop) | video (stills only)
--   label:    optional, to tell several apart ("left panel")
--   settings: JSON, the current choices (white balance, corners, shape; or angle and crop)
CREATE TABLE recipe (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('flat', 'scene', 'video')),
  label       TEXT NOT NULL DEFAULT '',
  settings    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  changed     TEXT NOT NULL,
  changed_by  TEXT
);
CREATE INDEX recipe_item ON recipe(item_id);

-- One frozen set of resized pictures that a recipe produced (r1, r2...: n, counted within its recipe). Never
-- changed, never overwritten. Its id is what editorial documents name, and AUTOINCREMENT means an id is never
-- used twice, so History and visitors' cached copies stay right.
--   settings: JSON, a frozen copy of the recipe's settings at the time, so the result can be made again
--   region:   JSON, optional: a rectangle within the squared-up picture (NULL = the whole); for details, step 7
--   w, h:     pixels of its largest size
CREATE TABLE rendition (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL CHECK (n > 0),
  settings   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  region     TEXT CHECK (region IS NULL OR json_valid(region)),
  w          INTEGER NOT NULL,
  h          INTEGER NOT NULL,
  made       TEXT NOT NULL,
  made_by    TEXT,
  UNIQUE (recipe_id, n)
);

-- The files a rendition consists of.
--   role:  size (a picture at one width) | preview (for link previews) | first, last (a video's frames)
--          | version (a video version, passed through: the same file as one of the item's originals)
--   width: pixels across
--   shape: wide | tall (videos; NULL for photos)
-- The digest index answers "which renditions is this file part of?", which is how the Worker decides whether a
-- visitor may fetch it, and how the Library knows a file is still used.
CREATE TABLE rendition_file (
  rendition_id  INTEGER NOT NULL REFERENCES rendition(id) ON DELETE CASCADE,
  digest        TEXT NOT NULL REFERENCES file(digest),
  role          TEXT NOT NULL CHECK (role IN ('size', 'preview', 'first', 'last', 'version')),
  width         INTEGER NOT NULL CHECK (width > 0),
  shape         TEXT CHECK (shape IS NULL OR shape IN ('wide', 'tall')),
  PRIMARY KEY (rendition_id, digest, role)
);
CREATE INDEX rendition_file_digest ON rendition_file(digest);
