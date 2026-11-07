#!/bin/sh
# Cloudflare's build command for both Workers (live and dev), before `npx wrangler deploy`:
#     sh tools/cloudflare_build.sh
# Makes any image sizes for masters/ that aren't in git yet. Images already in git are kept as they are: a
# fresh checkout gives every file the same date, so --missing-only stops the build remaking them all.
# (Paintings added through the editor don't come through here: their images are in R2.)
set -e
python3 -m pip install --quiet --disable-pip-version-check pillow pyyaml
python3 tools/build_site.py --missing-only
