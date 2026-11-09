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

Every painting's images are kept in R2, Cloudflare's file storage (buckets site-media and site-media-dev), in two
folders: `originals/` (each photo as uploaded, never shown) and `images/` (the sizes the site shows, named after
the painting: `red-on-blue-768.jpg`; a later painting reusing a name gets `red-on-blue-v2-...`). Visitors can
only open the images of published paintings. The paintings that were on the site before the move were
moved into R2 too.

`db/schema.sql` describes the tables; `db/seed.sql` is the content as first imported, for local tests. The old
`masters/`, `img/` and `paintings.yaml` were removed from git in November 2026 (they're in the history, in the
commit before "Remove the old painting files").

Nothing is built: the repository is the site, as it's served, plus the Worker's code. Shared pieces are kept
once each:

- **Styles**: `site.css`, linked from every page.
- **The header**: `templates/header.html`. `worker.js` puts it into each page as it's served, in place of
  `<header data-partial="header">`. Change it there and every page changes.
- **"Page not found"**: `templates/404.html`, sent by `worker.js` (status 404) for any address with no file.
  `templates/` isn't published itself.
- **Scripts** keep plain addresses (`motion.js`, no `?v=...`): Cloudflare sends every file with an ETag and
  "check before using" (`Cache-Control: public, max-age=0, must-revalidate`), so a browser always asks whether a
  file has changed, and gets the new one if it has (or a quick "not modified" if not).
- The contact picture's sizes are plain files in `med/` (made once from `med/jpg/paint-palette.jpg`).

A painting's address, chrisjones.org.uk/paintings/<name>/, is the home page with that painting brought
forward in the gallery. On Cloudflare, `worker.js` answers the home page, those addresses and the list page,
filling in the content from the database (`site.js`), and adds the header. The old /gallery/ address is sent
on to the home page's gallery section. Your local Apache copy can't run the Worker, so it shows pages with no
header and no paintings: check the site on dev.chrisjones.org.uk instead.
To run your local code as Cloudflare would, against the dev database and dev image storage (needs Node, and
signing in to Cloudflare once with `npx wrangler login`): `npx wrangler dev --env dev --remote`, then open
http://localhost:8787. Without `--remote` it uses an empty local database.

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
The dev Worker must keep `--env dev`, or it would deploy under the live Worker's name. There is no build
command: Cloudflare publishes the files as they are.

## What isn't published

`.assetsignore` lists what Cloudflare leaves out: the database files, the server code and its templates, wrangler.jsonc and this README.
