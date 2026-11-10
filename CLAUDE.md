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
Interface principle (Christopher, Nov 2026), for the site, the editor and client work: symbols rather than text,
for looks and because he imagines the client has ADD and can't search a haystack of words for the needle (AI
agents are too keen on text). E.g. a change saved automatically shows a tick on the right with a tooltip, plainly
not a button, rather than a message. The client uses the editor for years, so a short learning curve is fine.
Consistency matters to him: all text below the header shares one shadow (`--shadow` on body; the header has its
own lighter one), links glow when pointed at, and all titles (h1, section h2) share one size and weight, set
once at the top of site.css. Section headings mirror the opening title's position (22%).

## Names (glossary, agreed with Christopher 10 Nov 2026)

How names are chosen: one name per idea and one idea per name; the thing that's edited is named apart from what
it produces; every new word is checked against what's already used (code, database, editor, branch names: so
not "development", which would read as the dev branch); established terms where they fit. Use these names in
the editor, the code, the database and these notes alike; add new ones here before using them. In the editor
the client mostly sees symbols, so a name matters most for the code and the notes.

- **Library item**: one thing uploaded, the file untouched (a photo, or a video's set of versions), plus what's
  true of the picture itself (alt text, credit). Folder media/<code>/.
- **Recipe**: the darkroom settings applied to an item (white balance; four-corner squaring up for flat things,
  or straighten and crop for scenes). An item can have several. It's what gets edited.
- **Rendition** (r1, r2...): one frozen set of sizes a recipe has produced. Adjusting a recipe makes the next
  one; older ones are never overwritten, so History can bring them back and cached copies never go wrong (the
  standard digital-asset-management term). Not to be used for the recipe.
- **Framing**: how a picture (photo or video, through a recipe) is cropped and focused for a place on a page:
  focus point, crops for wide and upright screens; for a video, how it plays and what reduced-motion visitors
  get. Christopher's name, first for backgrounds (10 Nov: he asked whether photos placed elsewhere, e.g. beside
  text, should share it). Claude's proposal, to confirm: one Framing for any place, as the settings are the same.
- **Uses / places**, each pointing at what it shows: **Artwork** (a painting in the gallery, shown whole, so it
  points straight at a recipe: title, medium, size, year, genre, detail crops); **Section background** (points at
  framings; keeps the shade, which depends on the words over it); **Figure** (proposed, for a photo beside text
  on a page: points at a framing; keeps its caption, side and width). Later: portrait, team member...
- Already taken, so not for anything new: **version** (a video's versions; History's versions), **dev** (the
  branch and site), **Treatment** (the old name for Framing).

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
  The gallery section's markup is hand-written in index.html. No pictures or videos are in git (med/ went in
  1c): backgrounds, paintings and their frames are all in R2. The home page's og:image is added by worker.js:
  the painting shown, or else site.js homePreview() (the opening's photo, or its video's last frame, at the
  size nearest above 1200 pixels). Never reintroduce copies of shared markup or styles.
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
- **pause.js**: the header's pause button and the shared paused state (window.pauser); see 1c below.
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
  title, og:image from `preview`, canonical link, `<base href="/">`). Files: one folder in R2 per Library item,
  media/<code>/ (paths.js has the layout; see 1d slice 3), served by worker.js libraryFile() at /media/<code>/...,
  to visitors only if a published entry's media is that code (checked in D1, then cached for a year), never an
  original; to the signed-in editor always. A photo already stored (same content: the first 12 hex digits of its
  SHA-256, worked out in the browser, as hashing in the Worker would overrun the free plan's CPU) is found by GET
  /admin/api/stored?hash= (the add form says so, and which paintings use it), so it's never uploaded twice and
  one photo can serve several paintings, each with its own set of sizes. Uploads never overwrite (409). Everything but chrisjones.org.uk and www gets noindex.
- **The editor**: any host starting "admin" is the editor: admin.chrisjones.org.uk (live Worker, Access app
  "Site editor") and admin-dev.chrisjones.org.uk (dev Worker, "Site editor (dev)"), each guarded as a whole by
  Cloudflare Access (Christopher's email); editor.js also checks the Access token (vars ACCESS_TEAM and
  ACCESS_AUD per Worker; a rejected token is handled by signInAgain(), see 1c). There the site shows drafts, with a bar; /admin/ is the editor (admin/index.html,
  admin/editor.js: Gallery (add a painting at the top, then the genres and their paintings, with "Add a genre" under the Genres heading (a genre just added is picked in the add form; forms are rebuilt on every re-render, so carry() brings over what was typed in the add form and open Edit forms); the gallery's
  groupings are "genres" in the editor, kind 'section' in the data), Content (a box per page section, Hero,
  Gallery, Contact, Profile, Footer: its heading, then a box per paragraph, added, moved and deleted there;
  PAGE in admin/editor.js), Review with ticks, History with "Bring back"); its API is /admin/api/* in
  editor.js (state, history, save, discard, publish, which pulls in what a change needs, restore, upload), and the
  Library's in library.js (see 1d).
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
  and the original goes into its Library item untouched (original.<ext>). Before that, admin/darkroom.js prepares the picture
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
  /admin/api/original?key=media/<code>, editor only; paintings moved from git have no process record and reopen
  as the whole photo, with "paper all round" if white_paper) and starts from the saved choices. Saving makes new
  sizes only if the choices changed, as the item's next set (r2, r3...), so the old images stay for History.
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
   - med/ (the opening video, contact photo and their masters in med/jpg/): removed in 1c (9 Nov 2026), once
     both sites had them in R2. The masters are in the history before "Backgrounds: built-in copies removed".
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
     frame), focus (tap), phone/wide crop previews, shade, Plays,
     For reduced motion, the versions (size, length, megabytes, megabits a second, which screens get it; remove),
     Choose a photo / Replace with a video / Add a version / Remove / Undo. videoFacts() checks a video before
     upload: refuses only non-MP4 or unplayable; notes the codec (from the moov box: H.264 fine, HEVC/AV1/VP9
     warned), index after the picture data (no fast start), a sound track, over 30 seconds, megabits a second
     over 1.25 x (1 + 3.5 per 4K screen of pixels), over 20 megabytes, under 1920 pixels.
   - The built-in opening video and contact photo were moved into R2 on both sites by a one-off "Move them into
     storage" editor button (moveInBox, STAND_INS), published by Christopher, then the button, the stand-ins in
     index.html and med/ were removed (9 Nov 2026; in the history before "Backgrounds: built-in copies removed").
   - Tested locally with wrangler dev and Playwright: upload, versions, move-in, publish, ranges (206, suffix,
     416), unpublished 404, upright phone gets the upright version, desktop the landscape, plays once and stops,
     reduced motion gets the still, footer full width. Not tested on a real phone or Safari.
   Where things stand (9 Nov 2026): all of the above is live. Both databases have bg-hero (the forest video,
   three versions) and bg-contact (the palette photo) published; bg-footer none.
   Contact links: done and live (9 Nov 2026). links.js (published, imported by site.js, editor.js and
   admin/editor.js: one copy) lists Email, Instagram, Bluesky, Facebook, Threads, X, LinkedIn, TikTok, YouTube,
   Mastodon (user@instance), each with its username pattern, address, shown form and icon (SVG lines, drawn by
   Claude; Instagram's and Bluesky's as before). Entry 'links', kind 'links': { <site>: { name, on } } in that
   order (editor.js linksOf; tidy() takes off a leading @ and reads a pasted profile address; an unticked site
   keeps its username). site.js: the contact section's <div data-links> gets a line each, and the header's
   <li class="nav-icons"> an icon each (templates/header.html has it empty). The email address is written
   backwards in data-addr on #footer-email; index.html's script turns it round, shows it, and both it and the
   header's icon copy it. Editor: Content, Contact, Links box (tick, icon, username, the built link to try).
   The hand-written links are gone from index.html and the header; the entry (email, Instagram, Bluesky, as
   before) was put straight into both databases, published, with a History release "Contact links moved from
   the page into the editor" (dev release 30, live release 3), so live keeps its links when dev goes live.
   Tested locally (wrangler dev, Playwright): checks refuse bad usernames and ticked-but-empty, all ten render
   in the contact section and header, email copies. Not tested on a phone.
   Pause control: done (9 Nov 2026, on dev). pause.js (in <head>, before backgrounds.js) keeps the state:
   window.pauser { paused, watch(fn), moving(name, on) }, class `paused` on <html>, localStorage 'paused' (and
   the storage event, so other tabs follow). The button (#pause-motion, a circled pause or play symbol, drawn
   like the contact icons) is its own <li class="nav-pause"> in templates/header.html (site.js only rewrites
   <li class="nav-icons">), hidden until something registers as moving by itself: each background video until
   it has played once and stopped, the gallery's drift (if drift > 0), the profile's sea. So it shows on the home
   page, not on the list or 404 pages, and not for reduced-motion visitors (the sea is now still for them too).
   Paused: videos pause where they are and play on from there; a page opened paused shows the video's last frame
   (poster) with preload metadata, and play starts it from the beginning; the gallery's drift clock (driftT)
   stops; the sea's waveClock stops; motion.js puts the title, gallery heading and profile text in place
   (translate 0, fully shown) and drops parallax transforms; played again, they jump to where they should be,
   no spring. Clicking paintings, the mouse shift and snapping still work: they answer the visitor.
   Tested locally (wrangler dev, Playwright, a test video): pause, remembered on reload with the last frame,
   play from the start, text and parallax still, hidden on the list page, lined up with the icons at phone and
   desktop widths. Not tested on a phone or Safari.
   Still to do in 1c, in this order:
   - Profile: Christopher asked whether the head animation is just a video scrubbed by scrolling. It's a live
     WebGL drawing (face.js), but could be rendered once to a video and scrubbed (play mode 'scroll'), making the
     profile a section like any other; smooth scrubbing needs every frame stored whole (all keyframes), so larger
     files. His call.
   - Sections added by the client don't exist yet (Content has fixed sections); when they do, each gets this.
   - Deleting for good (raised 9 Nov 2026): Christopher uploaded an upright test video to the opening on dev
     (bg-hero-464x832 and -v2), published it briefly, removed it, and wanted it gone everywhere. Claude deleted its
     six files from site-media-dev by API, took it out of History (revisions 101 and 102) and purged Cloudflare's
     cache for their addresses. The editor has no way to do this: removed things stay in storage for History by
     design. Propose a "Delete for good" in History or on a removed item (files from R2, the item from every
     revision, cache purged), for clients too.
   - Head animation, measured 9 Nov 2026 (40 frames rendered at 1920 x 1080 and 750 x 1688, plus two seconds of
     consecutive frames, encoded with ffmpeg): live is about 1.8 megabytes (face-model.bin 1.1, textures 0.7;
     Three.js shared with the gallery). Scrubbed video needs about 750 frames (24 per second of its 32 seconds):
     every frame a keyframe (smooth in Safari) about 25 to 30 kilobytes a frame, so about 20 megabytes per version,
     two versions (upright and wide frame the head differently); a keyframe every 6 frames about 5 megabytes but
     uneven seeking on iPhone; a WebP sequence drawn on a canvas 10 to 20 megabytes. Claude recommended staying
     live and making the drawing's background see-through so the profile can take a background like any section.
     Christopher hasn't decided.
1d. The library (agreed 9 Nov 2026: before carousels). Christopher's points: basic file management (rename,
   delete for good) without over-engineering; one clear saving rule; Hide as the opposite of Publish; backgrounds
   not tied to names like bg-hero; a list per section (carousel later), which may use gallery paintings; site
   pictures kept apart from paintings. Plan (Claude's proposal, agreed in outline):
   - A `media` table in D1: one record per uploaded file (id, kind photo/video, the name shown, group 'site' or
     'painting', sizes, frames, original, added). Storage keys are fixed, from the id, never renamed (R2 can only
     copy and delete; renaming would break History and caches); renaming edits the name in D1.
   - A Library tab: Site pictures and Paintings, each file with what uses it; "Delete for good" only when nothing
     (draft, published or History) uses it, removing all its files and purging the cache; or, from History,
     removing it from the revisions too (the 9 Nov case above).
   - Backgrounds point at media ids: a list per section ({ items: [ids], show: 'one' }; 'carousel' later); an item
     may be a painting, used by reference (its processed images), so it follows reprocessing.
   - Video frames per shape, not per version (done in slice 2): one first/last set for the landscape versions, one for upright, at
     sensible JPEG quality (today each version gets its own set: 24 stills, about 18 megabytes, for one video;
     the 2560-wide first frame is 1.9 megabytes). Clear dev's leftovers (bg-hero-*, bg-contact, bg-contact-v2)
     with the new delete.
   - One saving rule: every change saves itself as a draft at once (paintings too, no Save button), shown by a
     tick on the right with a tooltip; nothing reaches visitors until Publish. Hide/Hidden: a painting, picture or
     section comes off the site but stays in the editor; it goes through Review and Publish like any change.
     Three distinct actions: Hide (off the site, kept), Remove (out of the page, file stays in the library),
     Delete for good (library, when unused).
   - Not a git repository, nor Cloudflare Artifacts (closed beta, made for text and code, 1 gigabyte included):
     R2 holds the files by content and D1 the catalogue and history, which is already how git works inside.
   Progress (9 Nov 2026), in slices, each pushed to dev for Christopher to try:
   - Slice 1, the catalogue and Library tab: done on dev. library.js (server; editor.js routes GET library,
     POST library/name and library/delete). An item is one thing uploaded with every file made from it: a photo
     (its original plus each set of sizes, linked through the entries' process.original/original, or
     originals/<name>.* for paintings moved from git) or a video version (videos/<name>.mp4 plus its -first/-last
     frames); sizes with no original are an item of their own (images/<stem>). Its id is its main file's key,
     fixed; the `media` table (db/schema.sql; created in both databases 9 Nov 2026) holds id, kind, grp
     (site/painting), name, files, bytes, added, and is brought up to date with R2 on every GET library (rows
     added, files updated, rows whose files are gone dropped; names kept). Uses: entries' draft and published,
     and revisions' data only (previous is never restored). Delete for good: refused (409) while a draft or the
     published site uses it; with history: true, its revisions go and any release left empty; then R2, the row,
     and the cache: caches.default locally, and Cloudflare's purge by URL if secret PURGE_TOKEN (Zone > Cache
     Purge) is set beside var ZONE_ID. Editor: Library tab (admin/editor.js libraryView), Site pictures and
     Paintings, newest first: picture, name (edited in place, saved on Enter or leaving it, tick), what uses it
     (green dot on the site, pencil in a draft, clock only in History; named only when it differs from the
     item's name), size, bin (dimmed with the users in its tooltip while in use). The header's Preview is now
     an eye symbol so the tabs fit one line on a phone. Tested locally (wrangler dev, Playwright).
   - Slice 2, a video as a set, and frames per shape: done on dev (9 Nov 2026). A background video's versions are
     one set (Christopher: the client chooses them as a set for the design, so uploading keeps them together):
     "Choose a video…" and "Add a version…" take several files at once (one set); the Library shows one row per
     set, id videos/<file> (the entry's file), with each version as a small outline of its shape (tooltip: size,
     megabytes); a stored version no entry lists any more is its own row ("Opening background video, W × H"),
     unused, so it can be deleted. Frames once per shape (frames.js, shared like links.js: holder(), holders()):
     the largest level version and the largest upright one hold first/last frames (stills), the others none;
     editor.js accepts a version without stills if its shape has a holder. admin/editor.js withFrames() keeps
     that true on adding (frames only from a new version that becomes its shape's largest; while checking
     several files only the largest of each shape keeps its frames in memory) and on removing (frames read
     back from the stored video, framesOf(), if the holder went). Frames: FRAME_WIDTHS up to 2560, JPEG 0.8
     (photos stay 0.88 up to 3840); storeSizes() treats "already exists" as done. Older videos (the forest)
     keep a set per version until replaced. Tested locally (wrangler dev, Playwright, VP9 test videos, as
     Playwright's Chromium has no H.264): three at once, frames only on 1280 x 960 and 360 x 640, removing the
     1280 retook them from the 640, the page's sources and poster use each shape's frames.
   - Slice 3, the Library's layout (agreed 9 Nov 2026; supersedes slice 1's guessing and his earlier "two
     folders, files named after the painting"): one folder per Library item, media/<code>/, code 8 hex digits
     (Christopher chose a bare code: a name in it could mislead after a rename), made by POST library/new when
     the item is created, never changed; the name is the Library's own (table `library`: id, kind, grp, name,
     hash, data, added, added_by; created in both databases 9 Nov 2026). Layout in paths.js (shared, published,
     like links.js; paintingAt, paintingPattern, photoAt, versionAt, framesFor): a photo's original.<ext>, its
     sets of sizes r1/, r2/... (<width>.<ext>, preview.jpg for paintings); a video's <w>x<h>.mp4 versions and
     frames wide-1/, tall-1/ (first-/last-<width>.jpg). GET library/next gives the next free part name, so
     nothing is overwritten; POST library/data records parts (renditions, versions, frames) in the item's data,
     used to pick it. Entries name the item (media) and the parts they use (painting: rendition, ext, widths,
     preview.src media/<code>/rN/preview.jpg, process.original media/<code>; background photo: rendition,
     widths, w, h; background video: versions [{file, w, h, bytes, seconds}], frames {wide, tall: {dir, widths,
     from}}), so a change shows only once published (editor.js normalise / backgroundItem). worker.js
     libraryFile(): /media/<code>/<file>, to visitors only if a published entry's media is that code, never
     original.*. Uploads: PUT upload?key=media/<code>/... (library.js uploadAllowed: the item must exist; names
     as above), streamed. Same photo twice: hash on the item (GET stored answers media/<code>).
     Editor: keepOriginal() makes the photo item; storeImages() the painting's next rN; photoItem(),
     videoItem(), withFrames() (frames per shape, remade under the next wide-N/tall-N when the shape's largest
     version changes) for backgrounds and the Library's + button; "From the Library…" in each background box
     (libraryPicker, backgroundFrom: a photo's newest jpg set; a video's versions and frames, keeping focus and
     shade). Library tab: rows by group, newest first, each with picture, name, code (tap copies), what uses
     it, then a line per part (symbol, size, users' marks, megabytes, a bin when nothing at all uses it; not the
     original); the row's bin deletes the folder (only while no draft or published version uses it; History
     versions go with it when asked). Tested locally against a copy of dev's database and every one of its R2
     names (stand-in files): the move (272 files into 38 items, 110 entries and History versions rewritten),
     all 162 addresses on the home, list and gallery data load, originals refused, + photo and video set,
     picking, adding a painting through the darkroom, part and item deletes, removing the old files.
   - The move: done on both sites by Christopher (9 Nov 2026; dev 37 items, live 21), with a one-off Library
     button (migrate.js: plan, copy in batches, rewrite entries and History, remove the old folders and the
     move's tables). No file, entry or History version uses the old names (images/, originals/, videos/) any
     more, so the move and every old-name reader (frames.js, old branches in paths.js, worker.js, editor.js:
     free, stored, originals/ and videos/ uploads, old entry formats) were removed: in the history before
     "Library: old layout retired". Earlier notes above (1c backgrounds, slices 1 and 2) describe the old names.
   - Slice 4, one saving rule and Hide: done on dev (9 Nov 2026).
     Saving: every change saves itself as a draft at once, paintings included (the Edit form's Save draft button is
     gone). admin/editor.js save(items, msg, key) runs saves one after another (a queue, so they never cross and the
     later wins; items may be a function, built when its turn comes, from the latest entries); with a key (the
     changed element's data-k) the answer is a tick, not a message: placeMarks() puts a tick on the right inside a
     text field (class saved, a background SVG) or just after anything else (span.mark; inside a label), fading over
     3.5 seconds, tooltip "Saved as a draft...", kept through re-renders. render() keeps the focused field (data-k):
     focus, caret and what's typed, so a save landing mid-typing loses nothing. beforeunload warns while saves are
     pending. A painting's Edit form: each field saves on change (savePainting: from the latest draft and the form;
     picture fields left as the draft has them). Its picture saves itself: darkroom opts.onChange (after every
     update()) -> pictureChanged(), which waits PICTURE_REST (1.2 s) of quiet, then storePicture(): makes the next rN
     set (keepOriginal once for a replaced photo, re.kept) and saves; a set made earlier in the same sitting (re.made)
     is deleted once superseded (library/delete part; nothing else can use it); back at the choices it opened with
     ("Back to as it was", formerly "Back to saved"), it puts back the opening's own picture fields (re.opened),
     making nothing. Closing the form stores a waiting change at once (closeEdit). discard() resets an open form
     (editFields, reopened). "Undo changes" isn't offered on a never-published painting (it would delete it in one
     tap; Remove asks first). The add form keeps its "Add as a draft" button: adding is an act, not a save.
     Hide: `hidden: true` in the entry's JSON (editor.js hide(): paintings, genres (kind section) and backgrounds;
     stored only when true, last, so showing again restores the same text). site.js load() skips hidden entries in
     both modes (the preview shows the site as it will be): a hidden genre takes its paintings with it; a hidden
     painting's address is "not found"; worker.js libraryFile() refuses visitors a file unless a published entry
     that isn't hidden uses its item (files already in Cloudflare's cache stay there until deleted for good: hiding
     is meant to be undone and nothing links to them). library.js: a published-but-hidden use has state 'hidden'
     (closed-eye mark in the Library; still blocks Delete for good). Editor: an eye button (hideButton) on each
     painting row, genre and background box: open eye on the site, closed eye hidden (row or box faded); badges
     "Hidden" / "Shown again" when that's the whole change, and Review says so in one line (a new painting picture is
     one line too, "Picture: made afresh"). A new photo or video put into a hidden background stays hidden.
     Wording: Remove (out of the page, its file stays in the Library) for paintings, genres, paragraphs and
     backgrounds; Delete for good only in the Library.
     Not done: hiding whole page sections (Hero, Contact, Profile...): they're fixed in index.html and the scripts
     (gallery.js, face.js, motion.js, the header's links) expect them, so this goes with sections added by the
     client, when sections become entries.
     Fixed on the way: backgroundBox()'s `label` (the new Library item's name) was declared after `return box`, so
     "Choose a photo…" / "Choose a video…" in a background box failed ("Cannot access 'label' before
     initialization") since slice 3, on live too; "From the Library…" worked.
     Tested locally (wrangler dev, Playwright, against the seed converted to the current layout): hide and show
     paintings, genres, backgrounds (preview, live site, list page, painting address 404, file 404 for visitors,
     Library mark, Review lines); each Edit field saving with its tick; typing in the next field while a save lands;
     the picture saving itself after Find the paper and a slider, the superseded set deleted, Back to as it was
     making nothing, closing straight after a change; Undo resetting an open form. Not tested on a phone or Safari.
   - Slice 4b: done on dev (9 Nov 2026), from his first use of slice 4.
     a. Hide acts at once (his model: Hide is the opposite of Publish). POST /admin/api/hide { id, hidden }
        (editor.js setHidden): paintings, genres and backgrounds already published; the published version and the
        draft both change at once (a draft that no longer passes the checks is left as it was), as a release of its
        own ("Hidden: <title>" / "Shown again: ..."), revision data/previous, so History can bring it back; other
        waiting edits stay waiting. A never-published thing has no eye (the server refuses it too).
        admin/editor.js hideButton(e, what) -> hideNow() (runs in the save queue); isHidden reads the published
        version (or a draft hidden before 4b); the tick's tooltip says it's on or off the site now (marks hold
        [time, tooltip]); History badges a hide or show "Hidden" / "Shown again". Replaces slice 4's "hiding goes
        through Review" (old hidden drafts still show as Hidden in Review until published).
     b. Comparing in the Library: tap a thumbnail to see it large; a tick box on each row (three at most); with two
        or three ticked a pill at the bottom compares them (showItems: an overlay, side by side, one above another on
        an upright phone; under each, name, code, the original's pixels and megapixels (most marked green), its
        megabytes and type, date added; a video lists its versions). library.js gives each item thumb and large
        (largest size up to 1536). The original's pixels: dimensions.js (server only, in .assetsignore) reads them
        from the first 512 kilobytes of the original (an R2 range read; JPEG with EXIF quarter-turns, PNG, WebP,
        HEIC/AVIF with irot; tested on each), once, into the item's data.original { w, h } (0 x 0 if unreadable),
        up to 20 per GET library. That fills it for items moved from the old layout and for new ones (nothing
        recorded it before).
     c. Library routes ("Make a painting" from a Library photo, "Back into the gallery", uses marks linking to where
        they're used, "Replace photo… From the Library…"): moved into the restructure below (Christopher, 9 Nov).
     Tested locally (wrangler dev, Playwright): hide and show a painting and a genre (published and draft, release
        and note, painting address and file 404 then 200), a waiting title edit kept while hiding, refused for a
        never-published painting and for text; eyes only on published things; tick, compare and large view at
        desktop and phone widths; original sizes filled. Not tested on a phone or Safari.
   - Uploads generally: confirmed by Christopher (9 Nov 2026), next, before backgrounds as lists (his order:
     restructure, then lists on top of it, so backgrounds are built once). Three layers, each its own entity:
     (1) Library item: the file as uploaded, untouched, plus what's true of the picture itself (alt text,
     credit/photographer); (2) the Recipe (named 10 Nov 2026, see Names at the top; not "Rendition", which is what r1, r2... are): white balance, then either four-corner squaring up for flat things (paintings, drawings, documents)
     or straighten and crop for scenes (rooms, people, buildings), where squaring up would distort; it produces
     its sets of sizes; several per item allowed; (3) uses, each pointing at a recipe: artwork (title, medium,
     size, year, genre, detail crops, shown in the gallery; its measured size drives the squaring-up shape),
     background framing (named "Framing" by Christopher: focus and crops per screen shape, how a video plays and
     what reduced-motion visitors get; was "treatment" in the slice 5 design below), later portrait/team member
     etc. The Library's Site pictures / Paintings split becomes a filter by use. The painting's `process` record
     moves out of the painting into the recipe. Videos: the browser can't re-encode, so no colour work after
     upload; their recipe is only crops/focus per shape and the still frames; colour is fixed before upload.
     The Library routes (4b c) are built as part of it.
   - Next slices, in order: the uploads restructure (above, with the Library routes); backgrounds as lists of
     framings (with the upright-screen settings below); paintings usable as backgrounds by reference.
   - Slice 5 design (agreed with Christopher by voice, 9 Nov 2026). He thinks in decoupled entities (data
     warehousing background): each thing its own entity, linked by ids, not coupled. Three layers, plainly
     normalised in D1 (our own design, not copied from Drupal or Sanity):
     1. Library item: just the file(s) (exists: table `library`, media/<code>/).
     2. Framing (Christopher's name, 9 Nov; was "treatment"; it points at a recipe, see uploads generally): how one item is used as a background, an entity in its own right, reusable:
        points at a Library item; focus point and crop for wide screens and for upright screens (art direction:
        per-shape settings, so the framing ideas below live here); for a video, how it plays (once or loop)
        and what reduced-motion visitors get.
     3. Section: points at a list of treatments (one shown for now; carousel later), and keeps the shade, since
        how dark it must be depends on the words over it, not the picture.
     Turning a phone (Christopher's concern): photos follow the turn by themselves (CSS crop; <picture>/media
     picks the other shape's crop). Videos: a browser picks its version once and doesn't switch on a turn, so
     never restart or swap a playing video (it keeps playing, re-cropped round the new shape's focus); when it's
     resting (on its last frame, or a reduced-motion visitor's still), swap to the other shape's still or
     version, unnoticed. Listen for the orientation/resize change in backgrounds.js.
   - Uploads generally, as first proposed (superseded by the confirmed version above):
     every photo may need the darkroom, painting or not, so "site picture" vs "painting" stops being a property
     of the file. Layers: (1) Library item: the file as uploaded, untouched, plus what's true of the picture
     itself (alt text, credit/photographer); (2) development (name to settle): a darkroom recipe on an item (white
     balance, then either four-corner squaring up for flat things (paintings, drawings, documents) or straighten
     and crop for scenes (rooms, people, buildings), where squaring up would distort), producing its sets of
     sizes; several per item allowed; (3) uses, each its own entity pointing at a development: artwork (title,
     medium, size, year, genre, detail crops, shown in the gallery; its measured size drives the squaring-up
     shape), background treatment (focus and crops per screen shape), later portrait/team member etc. The
     Library's Site pictures / Paintings split becomes a filter by use. Moves the painting's `process` record out
     of the painting into the development. Videos: the browser can't re-encode, so no colour work after upload;
     their "development" is only crops/focus per shape and the still frames; colour is fixed before upload.
   - After that, edit in place (step 4) replaces the Content tab (Christopher, 9 Nov 2026: the Gallery tab stays,
     a list suits it; the Content tab's design is the weak one, so don't spend effort redesigning it now). For
     backgrounds and contact links, which aren't text to click into, he liked the idea of a floating panel over
     the preview like the gallery's ?tune sliders. He's also conscious that much recent work isn't visible to
     visitors and wants to put effort into the public-facing site soon.
   - Framing on upright screens (Christopher thinking aloud, 9 Nov 2026, not decided): the forest works on wide
     screens because the bright fern sits against dark trees; an upright phone's full-height crop of the 4:3
     video shows only about 35% of its width, so the trees are lost (moving the focus helped landscape phones).
     His idea: a section height for upright screens (full, three-quarters, half: about 35, 46 and 69% of the
     width shown). Also possible: a separate focus for upright screens; an upright version framed for it
     (art direction; already served to upright screens), e.g. rendered from painted-forest-tools. All are
     per-shape settings, so they go with "backgrounds as lists of media ids": each section keeps settings for
     wide and for upright screens.
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

Secrets (not in wrangler.jsonc, never in git): PURGE_TOKEN (API token "Cache Purge" on zone chrisjones.org.uk only),
set on both Workers 9 Nov 2026. Saving a secret in the dashboard only uploads a new
version: it must then be deployed (Deployments, or POST .../workers/scripts/<name>/deployments with that version
at 100%). Later `wrangler deploy` builds keep secrets. The Workers' Git connection (Builds) is one repository
connection for both; its repo_name was renamed to chrisjones-org-uk by API (PUT /builds/repos/connections, same
repo_id) on 9 Nov 2026, after the dashboard showed "Error fetching GitHub User or Organization details".

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
