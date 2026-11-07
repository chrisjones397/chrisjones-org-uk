# Notes for Claude: chrisjones.org.uk

Christopher's site: hand-written HTML, CSS and JavaScript, no framework. Paintings and page text come from a
database (Cloudflare D1), edited at admin.chrisjones.org.uk: see "Content is in D1" below.
The README covers the workflow for people; this file adds what a new Claude session needs.
Always: British English; links are never underlined; give Christopher the commands so he can do things himself.
Consistency matters to him: all text below the header shares one shadow (`--shadow` on body; the header has its
own lighter one), links glow when pointed at, and all titles (h1, section h2) share one size and weight, set
once at the top of index.html's styles. Section headings mirror the opening title's position (22%).

## Branches and hosting

- **dev** is where all work happens; it is published at dev.chrisjones.org.uk (with noindex).
- **main** is live, chrisjones.org.uk. It only ever moves by fast-forwarding to dev, after Christopher approves.
- **painted-forest-tools** holds the scripts that made the opening video. Never merged, never published.
- Cloudflare: two Workers build from this repository. chrisjones397-github-io builds main (`npx wrangler deploy`);
  chrisjones397-github-io-dev builds dev (`npx wrangler deploy --env dev`). Both have the build command
  `sh tools/cloudflare_build.sh` (set in each Worker's build settings). Settings in wrangler.jsonc (no workers.dev or preview
  addresses; Worker logs kept);
  `.assetsignore` lists what isn't published (this file, the README, tools/, masters/, paintings.yaml, db/,
  the server code...). Anchor root files there with / (a bare name matches in every folder).

## Who does what

- Claude works in a cloud clone of the repository: edits, runs `python3 tools/build_site.py` (needs Pillow and
  PyYAML: `pip install --break-system-packages pillow pyyaml`), commits and pushes to dev. Christopher reviews on
  dev.chrisjones.org.uk and says when to put it live.
- Christopher works on his Mac in /Library/WebServer/Documents/prd/sync (a clone on dev, served by local Apache,
  Python in a venv there). He pushes some things himself (e.g. new master images), and prefers not to run
  build_site.py locally until he has checked it; he asks Claude to run it.

## Starting a session (both sides must be in sync with GitHub)

Claude, before any change:

    git clone https://github.com/chrisjones397/chrisjones397.github.io && cd chrisjones397.github.io
    git checkout dev && git pull --rebase       # (in an existing clone: git checkout dev && git pull --rebase)

Christopher, on the Mac before working, and again before pushing anything (Claude may have pushed meanwhile):

    cd /Library/WebServer/Documents/prd/sync
    git checkout dev
    git status                  # anything uncommitted? commit it (or git stash) first
    git pull --rebase           # bring in what Claude pushed; his own unpushed commits go on top

If `git pull --rebase` stops with a conflict, stop and ask rather than guess. Generated files (index.html's
built blocks, paintings/, gallery/, img/, 404.html) can always be remade by running build_site.py.

Claude, before pushing: `git pull --rebase` too, then rebuild if paintings.yaml or masters changed.

## Putting dev live (only when Christopher says so)

    git checkout main && git pull --ff-only && git merge --ff-only dev && git push && git checkout dev

`--ff-only` refuses if main has anything dev doesn't: stop and look if it does.

## How the site is made

- **tools/build_site.py** reads paintings.yaml and masters/ and writes: every image size in img/ (WebP),
  gallery/paintings.json (for worker.js), gallery/ (now only forwards to the home page's gallery section), gallery/list/, 404.html, and the
  built blocks inside index.html (between `<!-- ... start/end -->` markers: contact picture, gallery
  section). It copies index.html's `<style>` and header into every other page, so shared styles live in
  index.html. It fingerprints local script addresses (`?v=<hash>`) so browsers never run stale scripts.
  Never edit generated files by hand; change index.html, the script or paintings.yaml and rebuild.
- **paintings.yaml**: sections and paintings (title, details "Medium, H x W cm, year", wide, white_paper: drawings
  white balanced by the build from the paper all round their edges, following the light's fall-off across
  the sheet; masters untouched; phone photos are stood upright from their EXIF tag), plus
  `contact_picture:`, `gallery_invitation:` (paintings shown before the 3D gallery loads) and `gallery:` settings.
  Master file names come from titles: `python3 tools/build_site.py --name "Title"`.
- **Home page order**: opening forest video (.hero) / gallery section (#paintings, .invite) / contact
  (#contact) / profile with the head animation (.face-section, three windows tall) / footer (copyright only).
- **motion.js**: title drift and profile text spring; parallax; and directional snapping (after a scroll rests,
  glide on to the next resting place in the direction of travel, never back; free inside the profile; any
  wheel/touch/key cancels). Christopher's principle: work with the visitor, never against them.
- **gallery/gallery.js** (Three.js, vendored in face/vendor/): the floating wall, the home page's gallery section.
  No modes: the section is as tall as the wall (the script sets its height), the view is pinned (sticky) while
  the page scrolls through it, and ordinary scrolling moves the camera down, so paintings rise past, at
  different depths (middle depth moves exactly with the page). Placement across balances how big paintings look
  left and right. Click or tap brings a painting forward (others dim, and the heading fades: class `painting-forward` on the section) and puts /paintings/<name>/ in the address
  bar (history.pushState, no reload); clicking again, Escape, scrolling or Back sends it back. Snapping
  treats the tall section as free, like the profile. Its arrangement comes from paintings.yaml's `gallery:` settings (size,
  spacing, spread, depth, nearness, drift, seed); adding `?tune` to the address shows live sliders and a Copy button. (Until Nov 2026 it was a fly-through with Enter/Exit
  Gallery buttons; that version is in the history before the commit "Gallery: a floating wall...".)
- **face/face.js**: the head animation, driven by scrolling through .face-section; pauses while off screen.
- **glass.js**: the header's thick glass (frost plus a bent bottom edge) over every picture that passes under it:
  the opening video and the contact photo; over the floating gallery only with `?glass=N` in the address (N frames
  skipped between copies; off by default as it made phones stutter; gallery.js sends `glass-frame` events); not the head animation (by choice); plain CSS frost elsewhere. The header's
  Gallery link goes to #paintings.
- **Content is in D1, not git (stage 1, Nov 2026).** Tables in db/schema.sql: `entries` (one row per section,
  painting, page text or setting; `draft` and `published` JSON side by side; a change = draft differs from
  published; draft NULL = deleted in the draft, published NULL = never published), `releases` (each publish)
  and `revisions` (what each entry became in each release, and what it was). JSON is written with fixed key
  order (editor.js `normalise`), so equal text means no change. Databases: live site-content
  (92160592-99ad-48c8-84db-e418928d0f46), dev site-content-dev (746fef4b-4f14-402a-b658-3ef2a1576dbb), both
  seeded from db/seed.sql (tools/import_content.py, a one-off from paintings.yaml). Query them through the
  Cloudflare API connector. dev's database is a sandbox for code changes: content never goes from dev to live.
  paintings.yaml, masters/ and the painting files in img/ are now only the record of what was imported (no
  page uses them); removing them from git is a later step, when Christopher says. build_site.py still makes the
  contact picture.
- **worker.js** runs first (wrangler.jsonc run_worker_first) for /, /paintings/*, /gallery/list/, /media/* and
  /admin*. It fills the pages from the database with HTMLRewriter (site.js): the gallery-data JSON, the
  invitation wall, the list page's grid, `data-text="key"` elements and `data-paragraphs="key"` blocks in
  index.html (entries t-<key>). A painting's address is the home page with that painting brought forward (its
  title, og:image from `preview`, canonical link, `<base href="/">`). Painting images are
  `<base><file>-<width>.<ext>` (file = name, or name-v2... if R2 already had that name; stored only when it
  differs): base img/ + webp (from the build) or media/images/ + jpg (uploaded) or webp (moved from img/). R2
  layout, two folders only: images/ (served by worker.js at /media/images/..., to visitors only if a published
  painting uses that file, checked in D1 then cached for a year; to the signed-in editor always) and
  originals/<file>.<ext> (as uploaded, never served). Uploads never overwrite (409); GET /admin/api/free
  picks the file name. Everything but chrisjones.org.uk and www gets noindex.
- **The editor**: any host starting "admin" is the editor: admin.chrisjones.org.uk (live Worker, Access app
  "Site editor") and admin-dev.chrisjones.org.uk (dev Worker, "Site editor (dev)"), each guarded as a whole by
  Cloudflare Access (Christopher's email); editor.js also checks the Access token (vars ACCESS_TEAM and
  ACCESS_AUD per Worker). There the site shows drafts, with a bar; /admin/ is the editor (admin/index.html,
  admin/editor.js: Content, Review with ticks, History with "Bring back"); its API is /admin/api/* in
  editor.js (state, history, save, discard, publish, which pulls in what a change needs, restore, upload).
  Changes must carry the editor's Origin. Uploads: the browser makes JPEG sizes (Safari can't encode WebP)
  and the original goes to originals/ in R2, untouched. With "Drawing on white paper" ticked, the browser white
  balances the photo first (admin/editor.js whitePaper(), a port of build_site.py's white_paper(), matching it to
  within 3 levels in 255) and shows before and after side by side (tap to enlarge); the sizes are made from the
  corrected copy. Done in the browser, not a Worker: the free plan allows Workers 10 ms of CPU per request. Every painting on both sites is now in
  R2 (moved Nov 2026 by a one-off editor button, since removed: see the history). R2 binding MEDIA: bucket site-media (live),
  site-media-dev (dev); without a binding the editor says adding paintings isn't available. On other hosts /admin is not found.
  Local test: .dev.vars with DEV_USER="local test" (never committed); `npx wrangler dev --env dev --local
  --persist-to /tmp/wr --port 8787` is the site, and a second one on --port 8788 is the editor, signed in as
  DEV_USER; load the tables with `npx wrangler d1 execute site-content-dev --env dev --local --persist-to
  /tmp/wr --file db/schema.sql` (then db/seed.sql). Headless Chrome with Playwright works here for the editor.

## Next steps (agreed with Christopher, Nov 2026; start each in a new chat)

1. Tidy git: remove masters/, the painting files in img/ and paintings.yaml (nothing uses them now; one commit,
   undone by git revert). Keep the contact picture's files and what build_site.py needs for it.
2. Image processing at upload: white balancing for drawings on white paper with before and after side by side
   is done (in the browser, Nov 2026). Still open: redoing it for a painting already added when its tick
   changes (from its original in R2).
3. Users and roles.
4. Editing in place on the editor's preview.
5. Optional: a "change address" option, so a retitle can rename a painting's files and address (with the
   old address sent on to the new one).

## Cloudflare account settings (set in the dashboard, not the repository)

Always Use HTTPS on; minimum TLS 1.2; DNSSEC on; Email Routing (catch-all to Gmail). The domain's address records
are made and locked by the Workers' custom domains (including a wildcard), so they can't be edited by hand.

## Testing

Christopher's usage matters, and the cloud browser has no graphics card (3D and video are very slow there).
For small changes (wording, colours, positions): build, push, and let him check on dev.
After any push (dev or main), wait for Cloudflare's build of that commit to finish successfully before telling
him to look: the Cloudflare API connector shows it (GET /accounts/{id}/builds/workers/{worker id}/builds; live
c288de355d24430da80566f5ec46ceec, dev 22d6bcc2561f461f876a4d479319c793). If it fails, read its logs and fix it first. Run browser tests only
when behaviour changes (snapping, gallery switching), keep screenshots to layout questions, and say what was
and wasn't tested.
