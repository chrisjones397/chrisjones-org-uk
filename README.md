# chrisjones.org.uk

Plain HTML, CSS and JavaScript, published by Cloudflare straight from this repository (no build step on Cloudflare).

## Branches

- **main** is the live site, chrisjones.org.uk. It only receives finished work from dev.
- **dev** is where changes are made and checked, at dev.chrisjones.org.uk. When a change is approved, dev is merged into main.
- **painted-forest-tools** holds the scripts, photo and brush stamps that make the opening video. Never published or merged.

Every commit is kept, so any file, or the whole site, can be returned to an earlier state.

## Adding or changing a painting

1. Put the master image in `masters/`, named after the painting's title
   (`python3 tools/build_site.py --name "My Title"` prints the name). PNG, WebP, JPEG or TIFF;
   ideally at least 2560 pixels wide.
2. Add the painting to `paintings.yaml` (or change its title, details or position there).
3. Run `python3 tools/build_site.py` (in the venv: it needs `pip install pillow pyyaml`).
4. Check it on localhost, then commit and push to dev.

The script makes every size in `img/`, the gallery on the home page (between the gallery
markers in index.html) and each painting's page in `paintings/`. Don't edit those by hand:
the next run replaces them.

## What isn't published

`.assetsignore` lists what Cloudflare leaves out: the masters, the tools, paintings.yaml and this README.
