-- Migration 0004: scaffolding for step 4, slice 2, sub-steps (c) and (d). Removed again in sub-step (e).
--
-- Sub-step (c) fills the media tables (fill.js). This table remembers which rendition each old part became, so
-- that sub-step (d) can rewrite the entries and History by looking it up, and so the filling can be checked.
--   code: the old Library item's code (the folder media/<code>/). Items that shared one original photo become
--         one item with several recipes, so this may differ from the item the rendition now belongs to.
--   part: a photo's set of sizes as it was named (r1, r2...); for a video, what a background names of it:
--         "v:" + its version files joined by "+" + "|" + its frame folders joined by "+" (each list sorted)
CREATE TABLE old_part (
  code          TEXT NOT NULL,
  part          TEXT NOT NULL,
  rendition_id  INTEGER NOT NULL REFERENCES rendition(id) ON DELETE CASCADE,
  PRIMARY KEY (code, part)
);
