-- Migration 0006: step 4, slice 2, sub-step (e): the move to the media layer is finished, so what it left behind goes.
--
-- The two tables that carried the move (which digest each old storage key had; which rendition each old part
-- became) have done their work: migration 0005 was the last thing to read them.
DROP TABLE old_part;
DROP TABLE old_key;

-- The Library item (docs/entities.md, section 2) keeps only what is true of the item itself. Its old columns go:
--   grp   site or painting: now a filter on what uses the item, not a property of it
--   hash  the original's digest: now the `original` table
--   data  the record of its parts: now the file, original, recipe and rendition tables
-- (SQLite drops a column only once no index uses it, so the index on hash goes first.)
DROP INDEX library_hash;
ALTER TABLE library DROP COLUMN grp;
ALTER TABLE library DROP COLUMN hash;
ALTER TABLE library DROP COLUMN data;

-- And it gains the two attributes the model gives it. Empty text means "not said".
--   alt     alternative text: what the picture shows, for visitors who can't see it
--   credit  who made it, when it wasn't Christopher
ALTER TABLE library ADD COLUMN alt TEXT NOT NULL DEFAULT '';
ALTER TABLE library ADD COLUMN credit TEXT NOT NULL DEFAULT '';
