/* The media layer, read (docs/entities.md, section 2): renditions with their files, from the tables rendition,
   recipe, rendition_file and file. Server only. The pages (site.js), the file addresses (worker.js) and the
   editor's API (editor.js, library.js) all read renditions through here, so there is one description of what a
   rendition is:

     { id, n, recipe, item, kind (its recipe's: flat | scene | video), label, settings, w, h, made,
       files: [{ digest, type, role, width, shape, w, h, bytes, seconds }],
       sizes, preview, versions, frames }      (the last four: paths.js arranged())

   An editorial document names a rendition by its id; everything about the picture comes from here. */

import { arranged } from './paths.js';

const SELECT = `SELECT r.id, r.n, r.recipe_id, r.settings, r.w, r.h, r.made, c.item_id, c.kind, c.label,
    rf.digest, rf.role, rf.width, rf.shape, f.type, f.w AS fw, f.h AS fh, f.bytes, f.seconds
  FROM rendition r JOIN recipe c ON c.id = r.recipe_id
  LEFT JOIN rendition_file rf ON rf.rendition_id = r.id LEFT JOIN file f ON f.digest = rf.digest`;

/* The statement reading renditions (for use in a batch with others); which: SQL after the joins, e.g. a WHERE. */
export const renditionsQuery = (env, which = '', ...binds) => env.DB.prepare(`${SELECT} ${which}`).bind(...binds);

/* Its rows (one per file) made into renditions: a Map by id. */
export function renditionsFrom(rows) {
  const out = new Map();
  for (const x of rows) {
    if (!out.has(x.id)) {
      out.set(x.id, { id: x.id, n: x.n, recipe: x.recipe_id, item: x.item_id, kind: x.kind, label: x.label,
        settings: JSON.parse(x.settings || '{}'), w: x.w, h: x.h, made: x.made, files: [] });
    }
    if (x.digest) {
      out.get(x.id).files.push({ digest: x.digest, type: x.type, role: x.role, width: x.width, shape: x.shape,
        w: x.fw, h: x.fh, bytes: x.bytes, seconds: x.seconds });
    }
  }
  for (const r of out.values()) Object.assign(r, arranged(r.files));
  return out;
}

export async function renditions(env, which = '', ...binds) {
  return renditionsFrom((await renditionsQuery(env, which, ...binds).all()).results);
}

/* The renditions that the documents name: mode 'published' (what visitors see), 'draft' (the preview), or
   'both' (the editor). Uses the generated columns of migration 0005. */
export const NAMED = {
  published: 'WHERE r.id IN (SELECT published_rendition FROM entries WHERE published_rendition IS NOT NULL)',
  draft: 'WHERE r.id IN (SELECT draft_rendition FROM entries WHERE draft_rendition IS NOT NULL)',
  both: `WHERE r.id IN (SELECT published_rendition FROM entries WHERE published_rendition IS NOT NULL
    UNION SELECT draft_rendition FROM entries WHERE draft_rendition IS NOT NULL)`,
};
