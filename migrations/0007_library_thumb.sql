-- Migration 0007: step 4, slice 3, sub-step (a): the Library is the only upload, and an upload keeps only the
-- original (sizes are made later, by a recipe). An item with no rendition yet still needs a small picture for
-- its row in the Library and its tile in the pickers, so the item gains one:
--   thumb  the digest of a small JPEG of the original (480 pixels across), made in the browser at upload.
--          For the editor only: it belongs to no rendition, so visitors can never fetch it (worker.js).
--          NULL for items uploaded before this (their newest rendition's smallest size stands in) and videos.
ALTER TABLE library ADD COLUMN thumb TEXT REFERENCES file(digest);
