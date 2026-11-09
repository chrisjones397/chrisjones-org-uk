# Notes for Claude: chrisjones.org.uk

Christopher's site: hand-written HTML, CSS and JavaScript, no framework. Paintings and page text come from a
database (Cloudflare D1), edited at admin.chrisjones.org.uk: see "Content is in D1" below.
The README covers the workflow for people; this file adds what a new Claude session needs.
Always: British English; links are never underlined; give Christopher the commands so he can do things himself.
Christopher's standing principle (Nov 2026): build everything the way it's properly done in this setup,
Cloudflare (Workers, D1, R2, Access) with GitHub, following current best practice, because he's learning web
development through this site (and may build for clients) and wants to learn the right way, not LAMP or Drupal
habits, nor workarounds. Anything that exists only because of an earlier setup (static pages on GitHub Pages,
Namecheap, a local Apache copy) is vestigial: don't build on it or patch around it; point it out, propose the
proper replacement, and redesign it. When choosing an approach, say what the standard way is and why.
Consistency matters to him: all text below the header shares one shadow (`--shadow` on body; the header has its
own lighter one), links glow when pointed at, and all titles (h1, section h2) share one size and weight, set
once at the top of site.css. Section headings mirror the opening title's position (22%).

## Branches and hosting

- **dev** is where all work happens; it is published at dev.chrisjones.org.uk (with noindex).
- **main** is live, chrisjones.org.uk. It only ever moves by fast-forwarding to dev, after Christopher approves.
- **painted-forest-tools** holds the scripts that made the opening video. Never merged, never published.
- Cloudflare: two Workers build from this repository. chrisjones-org-uk builds main (`npx wrangler deploy`);
  chrisjones-org-uk-dev builds dev (`npx wrangler deploy --env dev`). No build command (removed in step
  1b): nothing is built. Settings in wrangler.jsonc (no workers.dev or preview addresses; Worker logs kept);
  `.assetsignore` lists what isn't published (this file, the README, db/, templates/,
  the server code...). Anchor root files there with / (a bare name matches in every folder).

## Who does what

- Claude works in a cloud clone of the repository: edits, commits and pushes to dev (nothing to build).
  Christopher reviews on dev.chrisjones.org.uk and says when to put it live.
- Christopher works on his Mac in /Library/WebServer/Documents/prd/sync (a clone on dev, once served by local
  Apache, which can't run the Worker: see the vestigial list below). He pushes some things himself, and prefers
  not to run code locally until he has checked it.

## Starting a session (both sides must be in sync with GitHub)

Claude, before any change:

    git clone https://github.com/chrisjones397/chrisjones-org-uk && cd chrisjones-org-uk
    git checkout dev && git pull --rebase       # (in an existing clone: git checkout dev && git pull --rebase)

Christopher, on the Mac before working, and again before pushing anything (Claude may have pushed meanwhile):

    cd /Library/WebServer/Documents/prd/sync
    git checkout dev
    git status                  # anything uncommitted? commit it (or git stash) first
    git pull --rebase           # bring in what Claude pushed; his own unpushed commits go on top

If `git pull --rebase` stops with a conflict, stop and ask rather than guess.

Claude, before pushing: `git pull --rebase` too.

## Putting dev live (only when Christopher says so)

    git checkout main && git pull --ff-only && git merge --ff-only dev && git push && git checkout dev

`--ff-only` refuses if main has anything dev doesn't: stop and look if it does.

## How the site is made

- **Nothing is built (step 1b, Nov 2026).** The repository is the site as served, plus the Worker's code;
  tools/build_site.py and tools/cloudflare_build.sh are gone (in the history before "Retire build_site.py").
  Each shared piece exists once: styles in **site.css** (linked by every page; all of index.html's old <style>,
  the gallery caption's styles, and the list and 404 pages' bits, scoped by `body.page`, `.list-page`,
  `.notfound`); the header in **templates/header.html**, which site.js's rewriter() puts in place of
  `<header data-partial="header">` on every page as it's served (imported as text: Wrangler's default module
  rules treat .html as Text, so it's bundled into the Worker, no extra fetch; its links start with / so they work
  at any address, and on the home page they're same-page fragment links, so they scroll without reloading;
  gallery.js handles them while a painting's address shows); "page not found" in **templates/404.html**, sent
  by worker.js notFound() with status 404 and the header and footer text filled in. templates/ isn't published.
  wrangler.jsonc has not_found_handling "none", so an address with no file reaches worker.js (run_worker_first
  is a list, which also stops the navigation-request shortcut to asset handling); worker.js sends /gallery and
  /gallery/ to /#paintings (301) and anything else missing to notFound(). Scripts have plain addresses, no
  `?v=` stamps: Workers static assets are sent with `Cache-Control: public, max-age=0, must-revalidate` and an
  ETag (a hash of the file), so browsers always revalidate and get a changed file at once (304 if unchanged;
  checked with wrangler dev). Fingerprinted names with year-long caching would save those revalidations but
  need a build step, which isn't worth it here. Pages from worker.js are no-cache (no-store for the editor).
  The gallery section's markup and the stand-in backgrounds (the opening video, the contact photo: until their
  entries are published on both sites, see 1c) are hand-written in index.html. Never reintroduce copies of shared markup or styles.
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
  treats the tall section as free, like the profile. Its arrangement comes from the database's gallery settings (entry settings-gallery: size,
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
  seeded from db/seed.sql (written once by tools/import_content.py from paintings.yaml, both since removed;
  its images now pointed at R2, so it's for local tests only). Query them through the
  Cloudflare API connector. dev's database is a sandbox for code changes: content never goes from dev to live.
  History records from before the move to R2 (releases 1 and 2) were pointed at media/images/ in step 1, so
  "Bring back" never asks for img/.
- **worker.js** runs first (wrangler.jsonc run_worker_first) for /, /paintings/*, /gallery/list/, /media/* and
  /admin*, and for any address with no file. It fills the pages from the database with HTMLRewriter (site.js): the gallery-data JSON, the
  invitation wall, the list page's grid, `data-text="key"` elements and `data-paragraphs="key"` blocks in
  index.html (entries t-<key>), and the header partial (data-partial). Each page section has a data-paragraphs block (hero, gallery, contact,
  profile, footer; entries t-hero etc., a blank line between paragraphs; the server lets those five be created
  by the first paragraph typed, PARAGRAPHS in editor.js); a block's own <p>s are replaced only when the database
  has text for it. The opening title and its paragraphs drift together (.hero-words). A painting's address is the home page with that painting brought forward (its
  title, og:image from `preview`, canonical link, `<base href="/">`). Painting images are
  `<base><file>-<width>.<ext>` (file = name, or name-v2... if R2 already had that name; stored only when it
  differs): base always media/images/ (editor.js refuses any other), ext jpg (uploaded) or webp (moved out of git). R2
  layout, two folders only: images/ (served by worker.js at /media/images/..., to visitors only if a published
  painting uses that file, checked in D1 then cached for a year; to the signed-in editor always) and
  originals/ (as uploaded, never served). Originals are named by content: originals/<hash>-<name>.<ext>, hash
  the first 12 hex digits of the file's SHA-256, worked out in the browser (keepOriginal in admin/editor.js;
  hashing in the Worker would overrun the free plan's CPU), name the painting it was first uploaded for. GET
  /admin/api/stored?hash= finds one already stored (the add form says so, and which paintings use it, as soon as
  the photo is chosen), so choosing the same photo again skips the upload and the
  new painting points at it (one photo, several paintings, each with its own corners); the upload itself also
  answers with the existing key rather than storing a second copy. Older originals (originals/<file>.<ext>,
  before Nov 2026, and those moved from git) keep their names and still work. Image uploads never overwrite
  (409); GET /admin/api/free picks the images' file name. Everything but chrisjones.org.uk and www gets noindex.
- **The editor**: any host starting "admin" is the editor: admin.chrisjones.org.uk (live Worker, Access app
  "Site editor") and admin-dev.chrisjones.org.uk (dev Worker, "Site editor (dev)"), each guarded as a whole by
  Cloudflare Access (Christopher's email); editor.js also checks the Access token (vars ACCESS_TEAM and
  ACCESS_AUD per Worker; a rejected token is handled by signInAgain(), see 1c). There the site shows drafts, with a bar; /admin/ is the editor (admin/index.html,
  admin/editor.js: Gallery (add a painting at the top, then the genres and their paintings, with "Add a genre" under the Genres heading (a genre just added is picked in the add form; forms are rebuilt on every re-render, so carry() brings over what was typed in the add form and open Edit forms); the gallery's
  groupings are "genres" in the editor, kind 'section' in the data), Content (a box per page section, Hero,
  Gallery, Contact, Profile, Footer: its heading, then a box per paragraph, added, moved and deleted there;
  PAGE in admin/editor.js), Review with ticks, History with "Bring back"); its API is /admin/api/* in
  editor.js (state, history, save, discard, publish, which pulls in what a change needs, restore, upload).
  A painting has medium, cm [height, width] (numbers, centimetres only, by Christopher's choice) and year as
  fields; the server makes `details` ("Oil on canvas, 60 x 90 cm, 2020") from them, and site.js gives the
  gallery `cm` (older entries with only a details line still work; all were converted Nov 2026). The add form
  starts Not measured, with the last medium and height used (60 at first) and this year; the width is suggested, in grey, from
  the photo's proportions (see below); height and width are required.
  What drives what (Christopher's decision, Nov 2026): a measured size is the dog. "Measured" or "Not measured"
  (estimated: true): measured, the height and width as typed fix the shape the picture is squared up to (process
  shape), unless "Square up to its measured proportions" (shown only when measured) is unticked; kept to a tenth of
  a centimetre, never rounded to whole ones, so the shape isn't squashed; not measured, the photo's perspective gives the shape and the size only sets the scale (the side last
  typed is kept, the other follows the picture's proportions, greyed; detailsFields f.follow, f.ratio from the
  darkroom). The darkroom says when the photo decides ("Shape: from the photo's perspective"). Showing
  the size to visitors is a separate tick (size_shown, stored only when it differs from the default: shown when
  measured, hidden when not); a shown estimate reads "60 x 75 cm (est.)". The editor's rows note a hidden size. A photo's proportions come from its perspective
  (darkroom.js trueRatio, Zhang and He's whiteboard method: the vanishing points of the edges give the focal
  length, so the true width/height; a typical phone lens, 26/36 of the longer side, when only one pair of edges
  converges; tested within 1% on simulated photos, where averaging the side lengths was up to 17% out).
  Changes must carry the editor's Origin. Uploads: the browser makes JPEG sizes (Safari can't encode WebP)
  and the original goes to originals/ in R2, untouched. Before that, admin/darkroom.js prepares the picture
  from a working copy (at most 4096 pixels along its longer side): white balance from spots (no drop-down since
  step 2c: no spots = none; process white 'picks'): one evens the colour, two follow the light along their line,
  three to five fit a flat slope, six or more (CURVE) a gentle curve (quadratic, ridge 0.005 x spots on the
  curved terms), kept within the spots' range. "Find the paper" (findPaper; a button in the section and a sheet
  icon in the spots view) places 20 spots 3.5% in from the margins inside the corners (the photo's edges if not
  cropped), leaving out any much darker than their neighbours (marks). Tested on the three life drawings against
  "paper all round": on average 1.4 to 1.6 levels in 255 apart, at most 8. Older records with white 'paper'
  ("paper all round", a port of the old build_site.py's white_paper() matching it to within 3 levels) still reproduce;
  reopened, they say so, and spots replace it (the picture may change slightly). The spot fit uses the current
  corners, so a wrong corner guess puts spots on the drawing: set the corners first; a pixel brighter than the white is turned down as a whole, keeping its hue, not cut off one
  colour at a time, which turned a warm yellow lemon; sliders for the brightness of the white, 50 to 100%,
  and how much of the light's warmth to keep: the gain 255/paper splits into a shared brightness factor and a
  colour factor, the colour factor taken to the power 1 - warmth), then the corners: four, starting on a best guess at the painting's (guessCorners: background evened out,
  Otsu split, largest patch, four lines fitted to its outline; a tenth of a second; the photo's own corners
  if nothing convincing), dragged onto
  the painting's; each keeps its label wherever it's dragged (bottom left and bottom right go on the painting's
  bottom corners; tapping an edge relabels so it's the bottom; ↺ ↻ move every label one corner round; ⇋ swaps
  left and right; crossed edges hold
  back Done, dimmed, with no message), so
  squaring up by a perspective map also turns or mirrors it (no separate rotate step, by Christopher's design), to the shape of its
  height and width if measured. Spots and corners are placed in a full-screen view (pinch or trackpad
  zoom, double-tap to zoom in or back out (single taps wait 280 ms for a second), drag to move, each corner a crosshair with a knob on a stick, so a finger doesn't hide it; magnifier while dragging a
  corner, as big as half the screen's shorter side (220 at most), showing the corner's two edges, and never
  covering them (placeLoupe: 24 directions round the corner, each as near as it can be 16 pixels clear of the
  corner's edges and on screen; with a finger also clear of it and not below it, where the hand is; the nearest
  wins, leaning inside the corner with a mouse or trackpad (Christopher's choice) or away from the other edges
  with a finger; kept during a drag while it works; smaller if nothing fits); besides
  the knob, each corner has a small circle on each of its edges, carried 34 pixels past the corner (inside,
  along the edge, if off screen): dragging one moves only that edge, pivoting on its far corner, so the other
  edge stays put and the corner slides along it (step 2e); the crop line drawn one screen dot wide and half see-through, crosshairs gapped at the centre; the
  bottom edge marked by an amber line just outside it; no selection or long-press menu in there; no instructions or counts on screen (Christopher's choice:
  symbol buttons with tooltips, the icons drawn as SVG in darkroom.js ICONS: fit, sparkles to clear the white
  spots, a cross to cancel, a tick for done; the corners view has no fit button, its ⎌ goes back to the guess
  and zooms out, so its buttons fit one row on a phone);
  a tap within about 28 screen pixels removes a white spot; zoomed in, two arrows at each corner glide the
  view along its edges to the next corner). Thumbnails in the editor's lists show each painting's true shape. On choosing a photo the guessed corners are
  applied at once. Before (with the corners outlined, the bottom in amber) and after are always shown side by
  side, at most 38% of the window's height (tap to enlarge); the sizes are made from the result. The choices are saved with the painting as `process` (original, white, spots,
  brightness, warmth, corners, shape; fractions of the original's width and height as photographed; corners in the order the
  painting's top left, top right, bottom right, bottom left; checked by editor.js processOf()), so the
  images can be made again from the original. These steps are one piece in admin/editor.js, darkroom(), used by
  the add form and by a painting's Edit form: opening one of its sections reads the original back from R2 (GET
  /admin/api/original?key=, editor only; originals/<file> with no extension finds it, for paintings moved from
  git, which have no process record and reopen as the whole photo, with "paper all round" if white_paper) and
  starts from the saved choices. Saving makes new sizes only if the choices changed, under a fresh file name
  from GET free (name-v2...), so the old images stay for History; the process keeps pointing at the original.
  Editor requests give up after 30 seconds (uploads 2 minutes) with
  a message, so a dropped signal can't leave a button disabled. In the browser, not a Worker: the free plan allows Workers 10 ms
  of CPU per request. Every painting on both sites is now in
  R2 (moved Nov 2026 by a one-off editor button, since removed: see the history). R2 binding MEDIA: bucket site-media (live),
  site-media-dev (dev); without a binding the editor says adding paintings isn't available. On other hosts /admin is not found.
  Local test: .dev.vars with DEV_USER="local test" (never committed); `npx wrangler dev --env dev --local
  --persist-to /tmp/wr --port 8787` is the site, and a second one on --port 8788 is the editor, signed in as
  DEV_USER; load the tables with `npx wrangler d1 execute site-content-dev --env dev --local --persist-to
  /tmp/wr --file db/schema.sql` (then db/seed.sql). Headless Chrome with Playwright works here for the editor.

## Next steps (agreed with Christopher, Nov 2026; start each in a new chat)

1. Tidy git: done (Nov 2026).
   See Christopher's standing principle at the top. build_site.py (1b) is one example of something vestigial,
   not the only one. Candidates found so far, to go through with him (each: what it was for, the proper
   Cloudflare way, then replace or remove), as part of 1b or straight after:
   - CNAME: GitHub Pages' custom-domain file; removed (Nov 2026). Cloudflare's Workers custom domains do this.
   - The names (Nov 2026): repository renamed chrisjones-org-uk (was chrisjones397.github.io; GitHub
     redirects the old address; his Mac's remote is git@github.com:chrisjones397/chrisjones-org-uk.git). Workers
     chrisjones-org-uk and chrisjones-org-uk-dev, renamed by API (PATCH /workers/workers/{id} {name}: same IDs,
     so custom domains and builds stay attached); both done.
     Zero Trust team domain chrisjones-org-uk.cloudflareaccess.com (was the random still-mountain-1dde; "chrisjones" was
     taken), changed by PUT /access/organizations auth_domain, with ACCESS_TEAM "chrisjones-org-uk" in both envs.
     The display name is already "Christopher Jones - Fine Art". bigsas may become bigsas-co-uk when
     bigsas.co.uk moves to Cloudflare (check how it's hosted first).
   - .github/workflows/ssl-monitor.yml: removed (Nov 2026); Cloudflare issues and renews certificates itself.
   - GitHub Pages: switched off (Nov 2026): after the rename, Settings > Pages, Unpublish site and branch None
     (has_pages false). Then CNAME was deleted.
   - Local Apache copy on his Mac (/Library/WebServer/Documents/prd/sync) as a way to view the site: LAMP-era;
     it can't run the Worker, database or R2. The proper local preview is `npx wrangler dev` (or just dev);
     his clone stays for git. Mind his preference not to run code locally he hasn't vetted.
   - gallery/index.html forwarding page: done in 1b (worker.js redirect).
   - med/jpg/paint-palette.jpg and the other masters in med/jpg/: sources kept from the build-script days;
     the contact one goes with step 1c.
   Keep looking for more as work goes on (e.g. anything in index.html, worker.js or the README written for
   the static or Apache setup) and add them here.
1b. Retire build_site.py: done (Nov 2026), see "Nothing is built" above. The build command was removed from
   both Workers' build settings.
1c. Next (Christopher's choice, Nov 2026: 1c before detail images). Sign-in fix: done (Nov 2026). When
   signedIn() rejects a token Access let through (old team name, another application), worker.js
   signInAgain(): a page request clears Access's CF_Authorization cookie on that address and comes straight back
   (302), so Access starts a fresh sign-in itself; a signin_retry cookie (one minute) makes a second failure show
   a "Couldn't sign you in" page with a full sign-out link (/cdn-cgi/access/logout, which doesn't come back by
   itself) instead of looping. API and image requests, and any with X-Requested-With, get a 401; admin/editor.js
   fetchFor() sends X-Requested-With (so Access answers 401 for a run-out session rather than redirecting) and
   on a 401 shows the #signin bar, whose link signs in in a new tab, keeping what's typed.
   Backgrounds (Christopher's brief, Nov 2026): the client swaps any section's background, photo or video, in
   the editor; every section but the gallery (and the profile while its head is a live 3D drawing, see below).
   Done (Nov 2026) for the opening (hero), contact and footer:
   - Entries bg-<section>, kind 'background' (editor.js backgroundOf): type 'photo' (file, focus, shade, w, h,
     widths up to 3840, original; the first ones had no type and are read as photos) or 'video' (file, focus,
     shade, versions [{name, w, h, bytes, seconds, stills}], play once/loop, calm last/fade). A video version is
     uploaded as made (the browser can't re-encode video) to R2 videos/<name>.mp4 (a third folder, beside images/
     and originals/; uploadVideo streams it through, under 95 megabytes); its first and last frames are taken in
     the browser and stored as images/<name>-first-<width>.jpg and -last-. Names from GET free, which now looks
     at all of a name's sizes, frames and videos.
   - The page: index.html marks sections data-background="<section>" (BACKGROUNDS in editor.js and PAGE's bg in
     admin/editor.js list the same: hero, contact, footer). site.js bgTag prepends <img class="section-bg"> or
     <video class="section-bg"> (sources: portrait versions first, media (orientation: portrait), then by the
     pixels the screen shows across; each source carries its own frames as data-first/-last) plus a one-line
     script calling bgVideo() from backgrounds.js (in <head>), which sets the chosen version's own poster, plays
     it muted, once or looping, and gives visitors asking for reduced motion or Save-Data the last frame or a
     4-second fade first to last. --shade is a brightness filter on the picture (same as a black veil, without
     covering the words; glass.js reads --shade). Parallax and the header glass treat every .section-bg alike.
     The footer runs full width when it has one.
   - worker.js media(): visitors get images and videos only of published entries (paintings, background photos,
     video versions by name via json_each); video() answers single byte ranges with 206 (parsed from the Range
     header: R2's own range echo came back without offset/length locally), 416 when out of the file.
   - The editor (Content tab): backgroundBox() per section: the current background (photo, or the video's last
     frame; a built-in stand-in from git shown as such), focus (tap), phone/wide crop previews, shade, Plays,
     For reduced motion, the versions (size, length, megabytes, megabits a second, which screens get it; remove),
     Choose a photo / Replace with a video / Add a version / Remove / Undo. videoFacts() checks a video before
     upload: refuses only non-MP4 or unplayable; notes the codec (from the moov box: H.264 fine, HEVC/AV1/VP9
     warned), index after the picture data (no fast start), a sound track, over 30 seconds, megabits a second
     over 1.25 x (1 + 3.5 per 4K screen of pixels), over 20 megabytes, under 1920 pixels.
   - moveInBox(): one-off "Move them into storage" at the top of Content, while a section with a stand-in
     (STAND_INS: hero's three videos, contact's master paint-palette.jpg with focus 0.85, 1 and shade 0.12) has no
     entry: fetches them from /med/ and stores them as drafts, to publish under Review. dev's bg-contact was
     already Christopher's own upload (1200 pixels wide), converted to the typed form by hand.
   - Tested locally with wrangler dev and Playwright: upload, versions, move-in, publish, ranges (206, suffix,
     416), unpublished 404, upright phone gets the upright version, desktop the landscape, plays once and stops,
     reduced motion gets the still, footer full width. Not tested on a real phone or Safari.
   Still to do in 1c:
   - Once both sites have their backgrounds published: remove the stand-ins (index.html <video>/<img>
     data-stand-in and their script, STAND_INS and moveInBox in admin/editor.js) and med/*.mp4, med/contact-*,
     med/jpg/ from git.
   - Contact links (agreed Nov 2026): a tick and a username for each of Email, Instagram, Bluesky, Facebook,
     Threads, X, LinkedIn, TikTok, YouTube, Mastodon (user@instance), the link built from it; replaces the
     hand-written links in index.html and the header's icons.
   - Pause control (agreed Nov 2026: header icon): shown only while something on the page moves; pauses the
     background videos and the parallax and drift; remembered across the site (WCAG 2.2.2).
   - Profile: Christopher asked whether the head animation is just a video scrubbed by scrolling. It's a live
     WebGL drawing (face.js), but could be rendered once to a video and scrubbed (play mode 'scroll'), making the
     profile a section like any other; smooth scrubbing needs every frame stored whole (all keyframes), so larger
     files. His call.
   - Sections added by the client don't exist yet (Content has fixed sections); when they do, each gets this.
   Then detail images (2, below).
2. Image processing: white balance, four-corner crop and reopening a painting to change them are done (Nov
   2026). Agreed with Christopher (Nov 2026), in this order:
   a. Shared originals: done (Nov 2026), see the R2 layout above. The duplicates stored before it (the
      pentaptych's five identical 11 megabyte copies on dev; Small Composition in Yellow's four test uploads)
      are still there: merging them is optional, only if Christopher asks.
   b. Darkroom sections: done (Nov 2026). White balance and Corners are <details> sections, each with a summary
      line while closed (whiteText, cornersText), open once a photo is chosen when adding. A painting's Edit form
      shows its darkroom at once, sections closed and summarising the saved choices (no "Change white or
      corners…" button); opening a section fetches the original. Then the photo is shown small, with Previous
      (the painting's current picture, pictureOf) and New side by side, large; pressing and holding New shows
      Previous in its place (holdable; a short tap still enlarges). Ghosts of the saved choices: a faint mark on
      each slider, dashed corners and spots in the full-screen views (fullView's ghost argument), and "Back to
      saved", shown once anything differs.
   c. White balance without the drop-down: done (Nov 2026), see the darkroom above. Known weak spot:
      guessCorners on a photo that is all paper (the life drawings) finds the drawing, not the sheet.
   d. Replacing a painting's photo: done (Nov 2026). "Replace photo…" in a painting's Edit form (darkroom
      replace(); reads the old original first if no section was opened). Proportions within half a per cent of
      the photo it replaces (same photo, e.g. a higher-resolution copy): the corners, spots and sliders carry
      over; otherwise only the sliders, corners guessed afresh, spots cleared (and ghosts of the old corners and
      spots dropped). A note under the darkroom says which. The new photo goes to originals/ on Save (keepOriginal,
      so an already-stored one is reused) and the process points at it; the old original stays for History.
      "Back to saved" goes back to the old photo and its choices.
   e. Moving one edge at a time: done (Nov 2026), see the darkroom above. The idea (Christopher's): at each corner, besides the knob that moves the
      corner, a smaller circle on each of its two edges, extended a little past the corner. Dragging one moves
      only that edge, pivoting on its far corner (the line runs through the far corner and the finger), so the
      other edge, already right, stays put and the corner slides along it. Also: the magnifier bigger and
      further from the corner, so it doesn't hide what's being looked at.
   Then detail images (rectangles of free shape, Christopher's choice, drawn on the squared-up painting, cut
   from the full-size original; part of darkroom(), so available when adding and reopening). How details show
   on the site comes later: probably a page of its own for each painting that has them.
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
