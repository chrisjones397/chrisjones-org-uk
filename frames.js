/* A background video's first and last frames, kept once per shape rather than once per version (step 1d,
   Nov 2026). The versions of one video held level (landscape) are the same picture at different sizes, and so
   are those held upright, so one set of frames serves each shape: it's taken from that shape's largest version
   (the sharpest), stored as images/<version>-first-<width>.jpg and -last-, and that version alone lists the
   widths (stills). Older videos have frames for every version; those still work (a version's own come first).
   One copy, used by the page (site.js), the server (editor.js checks every shape has its frames) and the
   editor page (admin/editor.js imports this file from the site's top folder). */

export const upright = (v) => v.h > v.w;
const sameShape = (a, b) => upright(a) === upright(b);

/* The version whose frames v uses: its own, or else the largest of its shape that has some, or any that has. */
export function holder(versions, v) {
  if (v.stills) return v;
  const withStills = versions.filter((x) => x.stills).sort((a, b) => b.w - a.w);
  return withStills.find((x) => sameShape(x, v)) || withStills[0] || null;
}

/* Which version of each shape should hold its frames: the largest. [{ shape version, others of its shape }] */
export function holders(versions) {
  const out = [];
  for (const up of [false, true]) {
    const group = versions.filter((v) => upright(v) === up).sort((a, b) => b.w - a.w);
    if (group.length) out.push({ top: group[0], rest: group.slice(1) });
  }
  return out;
}
