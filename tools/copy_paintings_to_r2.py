#!/usr/bin/env python3
"""List what to copy into R2 for the paintings that were in git, named as the editor names uploads:

    masters/<name>.<ext>             -> originals/<name>.<ext>
    img/<name>-<width>.webp          -> images/<name>-<width>.webp
    img/<name>-preview.jpg           -> images/<name>-preview.jpg

This only reads files and prints one line per file: path, key in R2 and content type, separated by tabs. It
changes nothing. The copying itself is done by the GitHub Actions workflow .github/workflows/copy-paintings-to-r2.yml,
which reads these lines.

    python3 tools/copy_paintings_to_r2.py
"""
import glob
import json
import os
import re
import sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
         "tif": "image/tiff", "tiff": "image/tiff"}


def main():
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
        out.append((masters[0], f"originals/{name}.{masters[0].rsplit('.', 1)[1].lower()}"))
        for w in sorted(set(p["widths"])):
            out.append((os.path.join(SITE, "img", f"{name}-{w}.webp"), f"images/{name}-{w}.webp"))
        out.append((os.path.join(SITE, "img", f"{name}-preview.jpg"), f"images/{name}-preview.jpg"))
    missing = [path for path, _ in out if not os.path.exists(path)]
    if missing:
        sys.exit("Missing files:\n  " + "\n  ".join(missing))
    for path, key in out:
        print(f"{os.path.relpath(path, SITE)}\t{key}\t{TYPES[path.rsplit('.', 1)[1].lower()]}")


if __name__ == "__main__":
    main()
