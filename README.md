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

## Putting dev live

Live is whatever is on main, so going live means moving main up to match dev. On the Mac, in the site folder:

    git checkout dev
    git pull --rebase           # make sure dev is the latest from GitHub
    git checkout main
    git pull                    # and main
    git merge --ff-only dev     # main moves forward to match dev exactly
    git push                    # Cloudflare builds and publishes main
    git checkout dev            # back to working on dev

`--ff-only` refuses (and changes nothing) if main has anything dev doesn't, so it can never mix in
something unexpected. If it refuses, stop and look before going further.

The other way, on GitHub (works from a phone): Pull requests, New pull request, base: main, compare: dev,
Create pull request, then Merge.

## How Cloudflare publishes it

`wrangler.jsonc` holds the settings. Two Workers build from this repository: the live one builds main
with the deploy command `npx wrangler deploy`; the dev one builds dev with `npx wrangler deploy --env dev`.
The dev Worker must keep `--env dev`, or it would deploy under the live Worker's name.
Unknown addresses get `404.html` (made by the build script).

## What isn't published

`.assetsignore` lists what Cloudflare leaves out: the masters, the tools, paintings.yaml, wrangler.jsonc and this README.
