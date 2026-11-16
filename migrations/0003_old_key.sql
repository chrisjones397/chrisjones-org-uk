-- Migration 0003: scaffolding for step 4, slice 2, sub-steps (b) to (d). Removed again in sub-step (e).
--
-- Sub-step (b) stores a copy of every file under the SHA-256 digest of its bytes (its new key in R2), leaving the
-- old key (media/<code>/<file>) where it is. This table remembers which digest each old key's bytes have, so
-- that the copying can be stopped and carried on, and so that sub-step (c) can fill the media tables (which
-- file is an item's original, which files make up a rendition) without reading any file again.
-- R2 itself checked each digest against the bytes it stored (the `sha256` option of put), so a row here is a fact.
CREATE TABLE old_key (
  key     TEXT PRIMARY KEY,             -- the old R2 key: media/<code>/<file>
  digest  TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  bytes   INTEGER NOT NULL,
  type    TEXT NOT NULL,                -- content type, as stored
  at      TEXT NOT NULL
);
CREATE INDEX old_key_digest ON old_key(digest);
