# chrisjones.org.uk

Plain HTML, CSS and JavaScript, published by Cloudflare from this repository. The paintings and page text come
from a database, edited at admin.chrisjones.org.uk (see Content, below).

## Branches

- **main** is the live site, chrisjones.org.uk. It only receives finished work from dev.
- **dev** is where changes are made and checked, at dev.chrisjones.org.uk. When a change is approved, dev is merged into main.
- **painted-forest-tools** holds the scripts, photo and brush stamps that make the opening video. Never published or merged.

Every commit is kept, so any file, or the whole site, can be returned to an earlier state.

## Content: paintings and page text (the editor)

Paintings, sections and the marked page text live in a database (Cloudflare D1), not in git. They're edited at
**admin.chrisjones.org.uk** (sign in with the one-time code sent to your email):

- the whole site, showing the drafts in place, with a bar at the bottom ("Draft · 2 changes to publish · Edit · Review");
- **/admin/** is the editor: change text, sections and paintings, add a painting from a photo. Every change is
  saved as a draft at once; visitors see nothing until it's published;
- **Review**: every unpublished change with a tick. Publish the ticked ones, or all, or discard them;
- **History**: each publication, and every earlier version of anything, which can be brought back as a draft.

dev has its own copy of the database and its own editor, **admin-dev.chrisjones.org.uk**, for trying out code
changes without touching the live content. dev is for code only: content never travels from dev to live.

Adding paintings needs R2, Cloudflare's file storage, switched on (Storage & databases, R2, in the dashboard).
For now the photo's sizes are made as JPEG in the browser; the white-paper correction comes in a later stage.

The paintings already on the site keep their images in `img/`, made by `tools/build_site.py` from
`masters/`, and `paintings.yaml` is how they were listed before the move: it no longer changes the site.
`tools/import_content.py` wrote `db/seed.sql` from it, once; `db/schema.sql` describes the tables.

A painting's address, chrisjones.org.uk/paintings/<name>/, is the home page with that painting brought
forward in the gallery. On Cloudflare, `worker.js` answers the home page, those addresses and the list page,
filling in the content from the database (`site.js`). Your local Apache copy has no Worker or database, so it
shows the content as it was in the files. To run it as Cloudflare would:
`npx wrangler dev --env dev`, then open http://localhost:8787.

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
