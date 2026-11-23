-- Rendition numbers without gaps (23 Nov 2026). The darkroom deletes the trial pictures it replaces while you
-- work, which left a recipe's first kept picture numbered r3 or r7. A rendition's number (n) is only its place
-- in its recipe's list, shown as r1, r2... in the editor; nothing stores or links by it (documents and History
-- name renditions by id), so numbering them 1, 2, 3... in the order they were made changes nothing else.
-- From now on deleting a rendition closes the gap it leaves (library.js closeGap).
-- Two steps, so no two renditions of a recipe ever share a number midway (UNIQUE (recipe_id, n)).
UPDATE rendition SET n = n + 100000;
UPDATE rendition SET n = (SELECT COUNT(*) FROM rendition x WHERE x.recipe_id = rendition.recipe_id AND x.id <= rendition.id);
