#!/bin/sh
# Cloudflare's build command for both Workers (live and dev), before `npx wrangler deploy`:
#     sh tools/cloudflare_build.sh
# Makes the contact picture's sizes if any aren't in git. Those already in git are kept as they are: a fresh
# checkout gives every file the same date, so --missing-only stops the build remaking them.
# (Paintings don't come through here: they're in the database, and their images in R2.)
set -e
python3 -m pip install --quiet --disable-pip-version-check pillow
python3 tools/build_site.py --missing-only
