-- Migration 0005: the editorial documents are rewritten to the agreed model (docs/entities.md, sections 3 and 7).
-- Step 4, slice 2, sub-step (d). The code that reads the new documents is deployed straight after this is applied
-- (each Worker's deploy command applies migrations first), so the data and the code change together.
--
--   painting -> artwork   names one rendition by its id; its genre is `genre` (was `section`). Gone from the
--                         document: media, rendition (r1...), ext, widths, w, h, preview (all read from the
--                         rendition now), process and white_paper (the recipe's settings, filled in sub-step
--                         (c)), details (worked out from medium, size and year whenever shown).
--   section  -> genre     the document is unchanged; only its kind's name changes.
--   background            names one rendition by its id; keeps focus and shade, and play and calm for a video.
--                         Gone: type, media, rendition (r1...), w, h, widths, versions, frames.
--
-- Which rendition an old document's picture became is looked up in old_part (sub-step (c), fill.js).
-- Keys are written in the order editor.js normalise() writes them, and every value is carried over as the very
-- text it was stored as, so a draft equal to its published version stays equal, and the editor's next save of an
-- untouched document changes nothing.
--
-- Safe to run on a database with no content. It fails, changing nothing (a failed migration is rolled back and
-- the build stops, leaving the site as it was), if any current draft or published document's picture can't be
-- found. Versions in History whose picture no longer exists (its Library item was deleted long ago) can't be
-- rewritten and are dropped from History, as agreed 16 Nov 2026 (dev had some; live had none).

-- Every distinct document that needs rewriting, once, with the rendition it names and what it becomes.
CREATE TABLE rewrite (
  src   TEXT PRIMARY KEY,
  kind  TEXT NOT NULL,
  rid   INTEGER,
  out   TEXT
);
INSERT OR IGNORE INTO rewrite (src, kind)
  SELECT draft, kind FROM entries WHERE kind IN ('painting', 'background') AND draft IS NOT NULL
  UNION SELECT published, kind FROM entries WHERE kind IN ('painting', 'background') AND published IS NOT NULL
  UNION SELECT data, kind FROM revisions WHERE kind IN ('painting', 'background') AND data IS NOT NULL
  UNION SELECT previous, kind FROM revisions WHERE kind IN ('painting', 'background') AND previous IS NOT NULL;

-- A photo's part is its set of sizes as it was named (r1...); a video's is what fill.js videoPart() made of the
-- version files and frame folders the background named: "v:" + files joined by "+" + "|" + folders joined by "+",
-- each list sorted.
UPDATE rewrite SET rid = (
  SELECT rendition_id FROM old_part
  WHERE code = rewrite.src ->> '$.media'
    AND part = CASE WHEN rewrite.src ->> '$.type' = 'video'
      THEN 'v:' || coalesce((SELECT group_concat(f, '+') FROM (SELECT value ->> '$.file' AS f FROM json_each(rewrite.src, '$.versions') ORDER BY 1)), '')
        || '|' || coalesce((SELECT group_concat(d, '+') FROM (SELECT value ->> '$.dir' AS d FROM json_each(rewrite.src, '$.frames') ORDER BY 1)), '')
      ELSE rewrite.src ->> '$.rendition' END);

-- The new documents. Keys a document doesn't have come out of json_object as null and are then removed.
UPDATE rewrite SET out = json_remove(
  json_object(
    'name', json(src -> '$.name'), 'title', json(src -> '$.title'), 'medium', json(src -> '$.medium'),
    'cm', json(src -> '$.cm'), 'year', json(src -> '$.year'),
    'estimated', json(src -> '$.estimated'), 'size_shown', json(src -> '$.size_shown'),
    'genre', json(src -> '$.section'), 'order', json(src -> '$.order'), 'wide', json(src -> '$.wide'),
    'rendition', rid,
    'featured', json(src -> '$.featured'), 'hidden', json(src -> '$.hidden')),
  CASE WHEN src -> '$.estimated' IS NULL THEN '$.estimated' ELSE '$.none' END,
  CASE WHEN src -> '$.size_shown' IS NULL THEN '$.size_shown' ELSE '$.none' END,
  CASE WHEN src -> '$.featured' IS NULL THEN '$.featured' ELSE '$.none' END,
  CASE WHEN src -> '$.hidden' IS NULL THEN '$.hidden' ELSE '$.none' END)
WHERE kind = 'painting' AND rid IS NOT NULL;

UPDATE rewrite SET out = json_remove(
  json_object(
    'rendition', rid, 'focus', json(src -> '$.focus'), 'shade', json(src -> '$.shade'),
    'play', json(src -> '$.play'), 'calm', json(src -> '$.calm'), 'hidden', json(src -> '$.hidden')),
  CASE WHEN src ->> '$.type' = 'video' THEN '$.none' ELSE '$.play' END,
  CASE WHEN src ->> '$.type' = 'video' THEN '$.none' ELSE '$.calm' END,
  CASE WHEN src -> '$.hidden' IS NULL THEN '$.hidden' ELSE '$.none' END)
WHERE kind = 'background' AND rid IS NOT NULL;

-- The guard: every current draft and published document must have been rewritten, or nothing happens at all.
CREATE TABLE rewrite_guard (problem TEXT CHECK (problem IS NULL));
INSERT INTO rewrite_guard
  SELECT 'no rendition found for ' || id FROM entries
  WHERE kind IN ('painting', 'background')
    AND ((draft IS NOT NULL AND (SELECT out FROM rewrite WHERE src = entries.draft) IS NULL)
      OR (published IS NOT NULL AND (SELECT out FROM rewrite WHERE src = entries.published) IS NULL));
DROP TABLE rewrite_guard;

-- History: versions that can't be rewritten go, and any publication left with nothing in it.
DELETE FROM revisions
  WHERE kind IN ('painting', 'background')
    AND ((data IS NOT NULL AND (SELECT out FROM rewrite WHERE src = revisions.data) IS NULL)
      OR (previous IS NOT NULL AND (SELECT out FROM rewrite WHERE src = revisions.previous) IS NULL));
DELETE FROM releases WHERE id NOT IN (SELECT release_id FROM revisions);

UPDATE revisions SET
    data = (SELECT out FROM rewrite WHERE src = revisions.data),
    previous = (SELECT out FROM rewrite WHERE src = revisions.previous)
  WHERE kind IN ('painting', 'background');
UPDATE entries SET
    draft = (SELECT out FROM rewrite WHERE src = entries.draft),
    published = (SELECT out FROM rewrite WHERE src = entries.published)
  WHERE kind IN ('painting', 'background');

UPDATE revisions SET kind = 'artwork' WHERE kind = 'painting';
UPDATE revisions SET kind = 'genre' WHERE kind = 'section';
UPDATE entries SET kind = 'artwork' WHERE kind = 'painting';
UPDATE entries SET kind = 'genre' WHERE kind = 'section';

DROP TABLE rewrite;

-- Library items that were the very same photo as another became one item in sub-step (c) (their sets of sizes
-- are now that item's recipes). The rows left behind have no original and no recipe, and nothing names an item's
-- code any more: they go.
DELETE FROM library
  WHERE id NOT IN (SELECT item_id FROM original) AND id NOT IN (SELECT item_id FROM recipe);

-- Which rendition a document names, as columns (D1's documented way to index a value inside JSON: generated
-- columns, VIRTUAL as an added column must be). They answer "what uses this rendition?" and "may a visitor
-- fetch this file?" with an indexed lookup instead of a read of every document.
ALTER TABLE entries ADD COLUMN draft_rendition INTEGER AS (json_extract(draft, '$.rendition'));
ALTER TABLE entries ADD COLUMN published_rendition INTEGER AS (json_extract(published, '$.rendition'));
CREATE INDEX entries_draft_rendition ON entries(draft_rendition);
CREATE INDEX entries_published_rendition ON entries(published_rendition);
