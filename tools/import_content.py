#!/usr/bin/env python3
"""Write db/seed.sql: the site's current content, as rows for the content database (db/schema.sql).

This is the one-off move of the content out of git. It reads what the site shows today:
  * paintings.yaml: the sections, the paintings' order and ticks, the gallery invitation and settings;
  * the gallery block that build_site.py wrote into index.html: each painting's image sizes;
  * gallery/paintings.json: each painting's link-preview image;
  * index.html: the page text marked with data-text / data-paragraphs.
Everything goes in as already published, in one release, "Imported from the repository".

    python3 tools/import_content.py             # writes db/seed.sql
Then run db/schema.sql and db/seed.sql on an empty database (Claude does this through the Cloudflare API;
with Wrangler: npx wrangler d1 execute site-content --remote --file db/seed.sql).
Existing paintings keep their images in img/ (published with the site's files); new uploads go to R2.
"""
import html
import json
import os
import re
import sys

import yaml

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SITE, "tools"))
from build_site import slug  # noqa: E402  (the same naming rule as the build)

NOW = "2026-11-07T00:00:00Z"
BY = "import"


def js(obj):
    """JSON exactly as the Worker writes it (JSON.stringify): compact, keys in the order given."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def q(text):
    return "NULL" if text is None else "'" + text.replace("'", "''") + "'"


def main():
    with open(os.path.join(SITE, "paintings.yaml"), encoding="utf-8") as f:
        conf = yaml.safe_load(f)
    with open(os.path.join(SITE, "index.html"), encoding="utf-8") as f:
        page = f.read()
    with open(os.path.join(SITE, "gallery", "paintings.json"), encoding="utf-8") as f:
        previews = json.load(f)["paintings"]
    built = json.loads(re.search(r'<script type="application/json" id="gallery-data">(.*?)</script>', page, re.S)
                       .group(1).replace("<\\/", "</"))
    sizes = {p["name"]: p for p in built["paintings"]}

    rows = []   # (id, kind, data)
    for si, s in enumerate(conf["sections"]):
        sid = "s-" + slug(s["title"])
        rows.append((sid, "section", {"title": s["title"], "order": si}))
        for pi, p in enumerate(s["paintings"]):
            name = slug(str(p["title"]))
            b, pv = sizes[name], previews[name]
            rows.append(("p-" + name, "painting", {
                "name": name, "title": str(p["title"]), "details": p.get("details") or "",
                "section": sid, "order": pi, "wide": bool(p.get("wide")), "white_paper": bool(p.get("white_paper")),
                "w": b["w"], "h": b["h"], "widths": b["widths"], "base": "img/", "ext": "webp",
                "preview": {"src": pv["image"], "w": pv["width"], "h": pv["height"]},
            }))

    titles = {str(p["title"]): slug(str(p["title"])) for s in conf["sections"] for p in s["paintings"]}
    rows.append(("settings-invitation", "settings",
                 {"paintings": [titles[str(t)] for t in conf.get("gallery_invitation") or []]}))
    rows.append(("settings-gallery", "settings", built["settings"]))

    def text_of(key):
        m = re.search(r'data-text="%s"[^>]*>(.*?)</' % key, page, re.S)
        return html.unescape(re.sub(r"\s+", " ", m.group(1)).strip())
    for key in ("hero-title", "gallery-title", "gallery-button", "contact-title", "profile-title"):
        rows.append(("t-" + key, "text", {"text": text_of(key)}))
    block = re.search(r'data-paragraphs="profile">(.*?)</div>', page, re.S).group(1)
    paras = [html.unescape(re.sub(r"\s+", " ", p).strip()) for p in re.findall(r"<p>(.*?)</p>", block, re.S)]
    rows.append(("t-profile", "text", {"text": "\n\n".join(paras)}))

    out = ["-- Written by tools/import_content.py: the site's content as of the move out of git.",
           "DELETE FROM revisions; DELETE FROM releases; DELETE FROM entries;",
           f"INSERT INTO releases (id, at, by, note) VALUES (1, {q(NOW)}, {q(BY)}, 'Imported from the repository');"]
    for rid, kind, data in rows:
        d = js(data)
        out.append(f"INSERT INTO entries (id, kind, draft) VALUES ({q(rid)}, {q(kind)}, {q(d)});")
    out.append(f"UPDATE entries SET published = draft, draft_at = {q(NOW)}, draft_by = {q(BY)}, published_at = {q(NOW)};")
    out.append("INSERT INTO revisions (release_id, entry_id, kind, data) SELECT 1, id, kind, draft FROM entries;")
    with open(os.path.join(SITE, "db", "seed.sql"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"db/seed.sql: {len(rows)} entries")


if __name__ == "__main__":
    main()
