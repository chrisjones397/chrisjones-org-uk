# chrisjones.org.uk

Plain HTML, CSS and JavaScript, published by Cloudflare from this repository. The paintings, page text and
pictures come from a database and file storage, changed in the editor at **admin.chrisjones.org.uk/edit/**.

## Addresses

- **chrisjones.org.uk/**: the home page: the Hero (the forest), the gallery section, contact, profile.
- **/gallery/**: the gallery page, every painting as a grid.
- **/gallery/<name>/**: a painting: the home page with that painting brought forward in the floating gallery.
- **/media/<code>/...**: pictures and videos from storage (only what's published).
- **admin.chrisjones.org.uk**: the whole site again, showing drafts, with a pill at the bottom; **/edit/** there
  is the editor.

## Branches

- **main** is the live site, chrisjones.org.uk. It only receives finished work from dev.
- **dev** is where changes are made and checked, at dev.chrisjones.org.uk.
- **painted-forest-tools** holds the scripts, photo and brush stamps that make the Hero video. Never published or
  merged.

Every commit is kept, so any file, or the whole site, can be returned to an earlier state.

## The editor

Sign in with the one-time code sent to your email. dev has its own editor, **admin-dev.chrisjones.org.uk/edit/**,
with its own copy of the content, for trying out code changes: content never travels from dev to live.

- **Gallery**: add a painting from a photo (white balance and squaring up happen in the browser), and change the
  genres and their paintings.
- **Content**: each section's heading, paragraphs and background (photo or video), and the contact links.
- **Library**: every file in storage, what uses it, its name, comparing two or three, Delete for good.
- **Review**: every change not yet published, each with a tick. Publish the ticked ones, or all, or discard them.
- **History**: each publication, and every earlier version, which can be brought back as a draft.

Every change is saved as a draft at once (a tick shows it; there are no Save buttons); visitors see nothing until
it's published. The eye hides a painting, genre or background from visitors straight away, without removing it.

On the preview, the pill at the bottom says where you are: the eye means you're looking at the preview with your
drafts, the number is how many changes are waiting to be published (tap it to review them), and the pencil opens
the editor.

## Where things are kept

- **Content** (paintings' details, genres, page text, settings): Cloudflare D1, a database: site-content (live)
  and site-content-dev (dev). `db/schema.sql` describes the tables.
- **Files** (photos, videos and the sizes made from them): Cloudflare R2, file storage: site-media (live) and
  site-media-dev (dev). One folder per Library item, `media/<code>/`: the original as uploaded (never shown to
  visitors), each set of sizes made from it (`r1/`, `r2/`...), a video's versions and its first and last frames.
  The code never changes, so renaming an item in the Library breaks nothing.
- **The site's code**: this repository. Nothing is built: the repository is the site as it's served, plus the
  Worker's code. Each shared piece is kept once: styles in `site.css`; the header in `templates/header.html`,
  which `worker.js` puts into every page as it's served; "page not found" in `templates/404.html`.

`worker.js` answers the pages that show content (filling them in from the database with `site.js`), the files in
storage, and the editor. Scripts keep plain addresses: Cloudflare sends every file with "check before using", so a
browser always gets a changed file at once.

## Looking at changes

Check the site on dev.chrisjones.org.uk. To run your local copy as Cloudflare would, against the dev database and
storage (needs Node, and signing in to Cloudflare once with `npx wrangler login`): `npx wrangler dev --env dev
--remote`, then open http://localhost:8787.

## Putting dev live

Live is whatever is on main, so going live means moving main up to match dev. On the Mac, in the site folder:

    git checkout dev
    git pull --rebase           # make sure dev is the latest from GitHub
    git checkout main
    git pull                    # and main
    git merge --ff-only dev     # main moves forward to match dev exactly
    git push                    # Cloudflare builds and publishes main
    git checkout dev            # back to working on dev

`--ff-only` refuses (and changes nothing) if main has anything dev doesn't, so it can never mix in something
unexpected. If it refuses, stop and look before going further.

The other way, on GitHub (works from a phone): Pull requests, New pull request, base: main, compare: dev,
Create pull request, then Merge.

## How Cloudflare publishes it

`wrangler.jsonc` holds the settings. Two Workers build from this repository: the live one builds main with the
deploy command `npx wrangler deploy`; the dev one builds dev with `npx wrangler deploy --env dev`. The dev Worker
must keep `--env dev`, or it would deploy under the live Worker's name. There is no build command.

`.assetsignore` lists what Cloudflare leaves out: the database files, the server code and its templates,
wrangler.jsonc and this README.
