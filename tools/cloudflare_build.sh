#!/bin/sh
# Cloudflare's build command for both Workers (live and dev), before `npx wrangler deploy`:
#     sh tools/cloudflare_build.sh
# Makes anything the site needs that isn't in git yet, chiefly the image sizes for a painting added from the
# admin page (which commits only the master and paintings.yaml). Images already in git are kept as they are:
# a fresh checkout gives every file the same date, so --missing-only stops the build remaking them all.
set -e
python3 -m pip install --quiet --disable-pip-version-check pillow pyyaml
python3 tools/build_site.py --missing-only
