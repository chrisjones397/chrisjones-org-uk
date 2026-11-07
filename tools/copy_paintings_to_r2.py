#!/usr/bin/env python3
"""Copy the paintings that were in git into R2, named as the editor names uploads:

    masters/<name>.<ext>             -> originals/<name>.<ext>
    img/<name>-<width>.webp          -> images/<name>-<width>.webp
    img/<name>-preview.jpg           -> images/<name>-preview.jpg

It only adds files: nothing in git or on the site changes. Running it again just copies the same files again.
The paintings keep showing their img/ files until their database entries are pointed at R2 (a separate step).

Run it on the Mac, in the site folder, after `npx wrangler login` (once):

    python3 tools/copy_paintings_to_r2.py site-media-dev          # lists what it would copy
    python3 tools/copy_paintings_to_r2.py site-media-dev --go     # copies to dev's bucket
    python3 tools/copy_paintings_to_r2.py site-media --go         # copies to live's bucket

To undo: the copied files can be deleted from the bucket in the Cloudflare dashboard (R2), or with
`npx wrangler r2 object delete <bucket>/<key> --remote`.
"""
import glob
import json
import os
import re
import subprocess
import sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
         "tif": "image/tiff", "tiff": "image/tiff"}


def files():
    """(local path, key in R2) for every painting in the imported content (db/seed.sql)."""
    with open(os.path.join(SITE, "db", "seed.sql"), encoding="utf-8") as f:
        seed = f.read()
    out = []
    for m in re.finditer(r"VALUES \('p-[^']+', 'painting', '((?:[^']|'')*)'\);", seed):
        p = json.loads(m.group(1).replace("''", "'"))
        name = p["name"]
        masters = [x for x in glob.glob(os.path.join(SITE, "masters", name + ".*"))
                   if x.rsplit(".", 1)[1].lower() in TYPES]
        if len(masters) != 1:
            sys.exit(f"Expected one master for {name} in masters/, found {len(masters)}")
        ext = masters[0].rsplit(".", 1)[1].lower()
        out.append((masters[0], f"originals/{name}.{ext}"))
        for w in sorted(set(p["widths"])):
            out.append((os.path.join(SITE, "img", f"{name}-{w}.webp"), f"images/{name}-{w}.webp"))
        out.append((os.path.join(SITE, "img", f"{name}-preview.jpg"), f"images/{name}-preview.jpg"))
    missing = [path for path, _ in out if not os.path.exists(path)]
    if missing:
        sys.exit("Missing files (pull, or run tools/build_site.py, first):\n  " + "\n  ".join(missing))
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("site-media", "site-media-dev"):
        sys.exit(__doc__)
    bucket, go = sys.argv[1], "--go" in sys.argv
    todo = files()
    size = sum(os.path.getsize(p) for p, _ in todo)
    print(f"{len(todo)} files, {size / 1e6:.0f} megabytes, to {bucket}")
    for i, (path, key) in enumerate(todo, 1):
        rel = os.path.relpath(path, SITE)
        if not go:
            print(f"  {rel}  ->  {key}")
            continue
        print(f"[{i}/{len(todo)}] {rel} -> {bucket}/{key}", flush=True)
        ext = path.rsplit(".", 1)[1].lower()
        subprocess.run(["npx", "wrangler", "r2", "object", "put", f"{bucket}/{key}", "--file", path,
                        "--content-type", TYPES[ext], "--remote"], cwd=SITE, check=True,
                       stdout=subprocess.DEVNULL)
    if not go:
        print("Nothing copied. Add --go to copy.")
    else:
        print("Done.")


if __name__ == "__main__":
    main()
