# Notes for Claude: chrisjones.org.uk

Christopher's site: hand-written HTML, CSS and JavaScript, no framework, on Cloudflare (Workers, D1, R2, Access)
from this GitHub repository. Paintings, page text and pictures come from a database and file storage, edited at
admin.chrisjones.org.uk/edit/. The README is for people; this file is what a new Claude session needs.
Rewritten condensed on 11 Nov 2026 (step 1 of the plan below). The long version, with the reasoning and test
records of everything built before then, is in the history at commit 4375002 (`git show 4375002:CLAUDE.md`).

## Christopher's standing principles

- British English. Links are never underlined. Give him the commands, so he can do things himself.
- Build things the way they're properly done in this setup (Cloudflare with GitHub, current best practice): he's
  learning web development through this site and may build for clients. No LAMP or Drupal habits, no workarounds.
  Anything left from an earlier setup (GitHub Pages, Namecheap, local Apache) is vestigial: point it out and
  replace it properly. When choosing an approach, say what the standard way is and why.
- Solve problems properly and simply, not with fixes stacked on hacks; keep functionality in one place (the
  repository) rather than split across services. Every step reversible.
- Decoupled entities (his data-warehousing background): each thing its own entity, linked by ids; attributes on
  the right entity. Design the whole entity model first, then build in slices (Kimball's way: the bus matrix up
  front, the marts one at a time), so no slice carries an old shape forward.
- Design checks (agreed 11 Nov 2026): before each structural decision (tables, storage layout, routing, caching,
  what runs where), check Cloudflare's Reference Architectures (developers.cloudflare.com/reference-architecture/)
  and the relevant official docs, and tell him what they recommend and where the design departs from them, and why.
- Interface (site, editor, client work): symbols rather than text, with tooltips; he imagines the client has ADD
  and can't search a haystack of words. E.g. a change saved shows a tick, plainly not a button. Nothing may move
  when something appears. The client uses the editor for years, so a short learning curve is fine.
- Visitors: work with them, never against them (snap only in the direction of travel). Consistency: all text below
  the header shares one shadow (`--shadow`), links glow when pointed at, all titles share one size and weight (set
  once at the top of site.css), section headings mirror the Hero title's position (22%).
- Eventually only his own work and photos on the public site (today's AI-generated paintings and the pexels.com
  contact photo are placeholders; only Apple and Collaboration with Teo are fully real). He'll swap the contact
  photo himself in the Library.
- Nobody visits yet: no forwarding of old addresses. Work towards a clean start.
- His usage allowance matters: few browser tests and screenshots for small changes (he checks on dev); a new chat
  for each piece of work; after a chunk of work, update these notes with where things stand before he moves on.

## Names (glossary, agreed 10 Nov 2026)

One name per idea and one idea per name; the thing edited is named apart from what it produces; check a new word
against what's already used (code, database, editor, branches). Add new names here before using them.

- **Library item**: one thing uploaded, the file untouched (a photo, or a video's set of versions), plus what's
  true of the picture itself (alt text, credit). Folder media/<code>/ in R2, code 8 hex digits, never changed.
- **Recipe**: the darkroom settings applied to an item (white balance; four-corner squaring up for flat things,
  or straighten and crop for scenes). Several per item. It's what gets edited. (Not built yet: today a painting
  carries its `process` record; the restructure, step 4, moves it.)
- **Rendition** (r1, r2...): one frozen set of sizes a recipe produced. Never overwritten, so History and caches
  stay right.
- **Media**: images and videos in general (/media/ addresses, R2 binding MEDIA, an entry's `media` field).
- **Framing**: how media (through a recipe) is cropped and focused for a place on a page: focus point, crops for
  wide and upright screens; for a video, how it plays and what reduced-motion visitors get. Any place, not only
  backgrounds. (Was "treatment".)
- **Uses**: **Artwork** (a painting in the gallery: title, medium, size, year, genre, detail crops; points at a
  recipe); **Background** (a section's: points at framings; keeps the shade); **Foreground** (media among the text
  of a page, with caption, side, width). Later: portrait, team member.
- **Hero**: the home page's first section (the forest). The code, database (bg-hero, t-hero) and editor all say
  Hero; never "the opening".
- **Gallery**: the collection (paintings and drawings), its home page section (#gallery), and its page (/gallery/).
  In the editor its groupings are **genres** (kind 'section' in the data, for history's sake).
- **Featured**: the starred paintings (a star in the editor; field `featured`), the home page's wall. Not a genre
  (the Featured genre was removed, 11 Nov 2026).
- **Floating view** and **Fixed view**: the gallery's two views as visitors see them (the view switch's
  tooltips, 14 Nov 2026); in the code the fixed view is `grid` (data-view, gallery-view, ?view=).
- Taken, so not for anything new: **version** (a video's versions; History's versions), **dev** (the branch and
  site), **Treatment**.

## Branches, hosting, who does what

- **dev**: all work; published at dev.chrisjones.org.uk (noindex). **main**: live, chrisjones.org.uk; it only
  moves by fast-forwarding to dev, when Christopher says. **painted-forest-tools**: the Hero video's scripts; never
  merged or published. (net-checks, a diagnostic branch, deleted by him 11 Nov 2026.)
- Two Workers build from the repository: chrisjones-org-uk builds main (migrations first, then `npx wrangler deploy`),
  chrisjones-org-uk-dev builds dev (migrations first, then `npx wrangler deploy --env dev`; both must keep
  `--env dev`). No build command:
  nothing is built. Settings in wrangler.jsonc; `.assetsignore` lists what isn't published (anchor root files
  with /, as a bare name matches in every folder).
- Claude works in a cloud clone: edits, commits and pushes to dev. Christopher reviews on dev and says when to
  put it live. He has a clone on his Mac at /Library/WebServer/Documents/prd/sync (on dev, SSH remote) and pushes
  some things himself; he prefers not to run code locally that he hasn't checked.

Starting a session (Claude):

    git clone https://github.com/chrisjones397/chrisjones-org-uk && cd chrisjones-org-uk
    git checkout dev && git pull --rebase

Christopher, on the Mac, before working and again before pushing:

    cd /Library/WebServer/Documents/prd/sync
    git checkout dev
    git status                  # anything uncommitted? commit it (or git stash) first
    git pull --rebase

If a rebase stops with a conflict, stop and ask. Claude pulls with --rebase before pushing too.

Putting dev live (only when he says):

    git checkout main && git pull --ff-only && git merge --ff-only dev && git push && git checkout dev

After any push (dev or main), wait for Cloudflare's build of that commit to succeed before telling him to look:
GET /accounts/{id}/builds/workers/{worker id}/builds through the Cloudflare API connector (live
c288de355d24430da80566f5ec46ceec, dev 22d6bcc2561f461f876a4d479319c793). If it fails, read its logs and fix it.

## How the site is made

Files (all at the top level unless said):

- **Gallery views (14 Nov 2026)**: the grid is the default everywhere; floating is opt-in through the view switch
  (localStorage gallery-view = floating), on the home page too, where everyone else gets the still invitation wall
  and "See the paintings". He's considering dropping floating altogether (motion sickness).
- **index.html**: the home page, in order: Hero (`.hero`, forest video) / gallery section (`#gallery`,
  `.invite`) / contact (`#contact`) / profile with the head animation (`.face-section`, three windows tall) /
  footer. **gallery/index.html**: the gallery page, every painting, as a grid (the default) or floating (class gallery-3d,
  chosen by its head script: only if the visitor chose floating, remembered in localStorage gallery-view, ?view=
  sets it); a painting's address opens in that view with the painting brought forward; the grid stays in the page, visually hidden, under the
  floating view. **templates/header.html** (the one header, including the gallery's view switch) and
  **templates/404.html**: not published themselves; bundled into the Worker as text.
- **site.css**: every style, once, linked by every page (scoped by `body.page`, `.gallery-page`, `.notfound`).
  Never reintroduce copies of shared markup or styles.
- **worker.js** (server): runs first (wrangler.jsonc run_worker_first) for /, /gallery, /gallery/*, /media/*,
  /edit, /edit/*, and for any address with no file (not_found_handling "none"). Pages:
  `/` home; `/gallery/` the gallery page; `/gallery/<name>/` the gallery page with that painting brought forward
  (its title, og:image from `preview`, canonical); an address missing its last / is sent on
  to the one with it; anything else gets templates/404.html with status 404. `/media/<code>/<file>`: Library
  files (libraryFile), to visitors only if a published, not hidden entry's `media` is that code (cached a year),
  never an original; videos answer range requests (206/416). Everything but chrisjones.org.uk and www gets
  noindex. Pages are no-cache (no-store on the editor's host).
- **site.js** (server): load() reads the entries (draft or published) and fills pages with HTMLRewriter: the
  header partial (with an icon per ticked contact link), `data-text="key"` and `data-paragraphs="key"` (entries
  t-<key>; a block's own <p>s are replaced only when the database has text for it), `data-background` sections
  (bgTag: an <img> or <video class="section-bg">, focus, `--shade`), the contact links (`data-links`), the gallery
  data JSON (home: the Featured paintings, `c.featured`, all of them if none is starred; gallery page: all, with
  `groups`, where each genre starts) and the invitation wall (homeRewriter), the grid (gridRewriter, each item
  id="p-<name>"). homePreview() gives the home page's
  og:image (the Hero's photo, or its video's last frame, nearest above 1200 pixels).
- **paths.js**, **links.js** (shared by server, page and editor, published): the R2 layout, and the contact
  sites (Email, Instagram, Bluesky, Facebook, Threads, X, LinkedIn, TikTok, YouTube, Mastodon: pattern, address,
  icon). The email address is written backwards in data-addr; index.html's script turns it round and copies it.
- **gallery.js** (Three.js, vendored in face/vendor/): the floating wall, on the home page (#gallery, the Featured
  paintings) and the gallery page (section .wall, all, genre titles as text in the section, aria-hidden). The
  stage says where it is: data-page (where sending a painting back returns to), data-title. The section is as
  tall as the wall; the view is sticky while the page scrolls through and paintings rise past at different depths.
  Click brings a painting forward (`painting-forward` on the section) and pushes /gallery/<name>/ (no reload);
  click again, Escape, scrolling or Back sends it back. Arrangement from entry settings-gallery (size, spacing,
  spread, depth, nearness, drift, seed); `?tune` shows sliders. Each page's head script decides at once whether
  WebGL runs (class gallery-3d; no-float when it can't), else the invitation wall (home) or grid stands in.
- **wall.js**: where each painting hangs (arrange), plain arithmetic, no drawing. Pairs are judged over the whole
  stretch of scrolling while both are in view (pair: grazing or near misses in either direction, the nearer
  hiding over half the further, edges lined up), as nearer ones slide past further ones. Can be run in node to
  check a layout: the check used on 11 Nov 2026 compared old and new at six window sizes with the live paintings.
- **focus.js**: the grid view's painting brought forward: a <dialog> (showModal, so over the header too) at
  /gallery/<name>/ (pushState; arrows, swipe, Escape, cross, click beside, Back). The image's size on screen is
  set from its proportions first (nothing jumps); the file at that size (the grid's srcset) is decoded off-screen
  and swapped in when ready, the grid's copy standing in meanwhile; the paintings either side are fetched ahead.
  The title and details stay put at the bottom (--cap keeps room for them); the painting is centred above. Not used in the floating view.
- **The invitation wall** (home, when not floating): up to five Featured paintings in slots (site.css .invite-pic:
  a centre --x, --y and a size --side, the side of a square of equal area; site.js gives each painting --k, the
  square root of its proportions), so every shape gets the same area. Hand-placed, no seed (only the floating
  wall has one). motion.js drifts them at depths chosen so paintings above one another move alike.
- **motion.js**: title drift, profile text spring, parallax, directional snapping (glide on to the next resting
  place in the direction of travel, never back; free inside the gallery and profile; any input cancels).
- **pause.js**: the header's pause button and shared state (window.pauser); a site-wide setting, so always in the
  header on every page (14 Nov 2026), lit while something moves by itself (a background video until it has played
  once, the gallery's drift, the profile's sea), dimmed (class still) otherwise.
- **backgrounds.js** (in <head>): bgVideo() picks the version (portrait versions for upright screens, then by
  pixels across), sets its own poster, plays muted once or looping; reduced-motion or Save-Data visitors get the
  last frame or a fade first to last.
- **glass.js**: the header's thick glass over pictures passing under it (not the head animation; over the
  gallery only with `?glass=N`, as it made phones stutter). **header.js**: (phones held sideways, max-height 540px: a 58px
  header that slides right away on scrolling down, and while a floating painting is forward) phones slim the header on scrolling
  down; the gallery's view switch (two symbols just under the header, right edge under the menu's, measured as
  --switch-right; gallery page: always, current view lit, switches in place with a 'gallery-view' event; home: while
  #gallery crosses the window's middle, links to /gallery/?view=floating or grid; hidden with no-float). Symbols
  in the header are spaced by --icon-gap (14px), the pause button included.
- **face/**: the head animation (face.js, WebGL), driven by scrolling through .face-section. Its build scripts
  aren't in the repository.

## Content: D1, R2 and the editor

- **D1** (migrations/): `entries` (one row per painting, genre, text, setting, background, links; `draft` and
  `published` JSON side by side; a change = they differ; draft NULL = removed in the draft, published NULL =
  never published), `releases` (each publish), `revisions` (what each entry became, and was, per release),
  `library` (items: id = code, kind photo/video, grp site/painting, name, hash, data, added). JSON is written with
  fixed key order (editor.js normalise), so equal text means no change. Databases: live site-content
  (92160592-99ad-48c8-84db-e418928d0f46), dev site-content-dev (746fef4b-4f14-402a-b658-3ef2a1576dbb). Query
  through the Cloudflare API connector. dev's database is a sandbox for code: content never goes from dev to live.
  **Migrations** (step 4 slice 1): the tables are made and changed only by numbered files in migrations/ (Wrangler's
  standard D1 migrations: `npx wrangler d1 migrations create DB "what it does"` makes the next file;
  `npx wrangler d1 migrations apply DB --remote`, with `--env dev` for dev, applies those not yet applied, in
  order, each once, recorded in the table d1_migrations; in a build it answers its own question with yes). Never
  edit one that has been applied: add the next. 0001_initial.sql is the tables as they stood (IF NOT EXISTS, so a
  no-op on both databases, whose tables were checked identical to it on 11 Nov 2026). The standard way
  (Cloudflare's docs) is to apply them in the deploy command, so the database changes with the code, including
  when he puts dev live: both Workers' deploy commands do. The old db/seed.sql (pre-Library format, unusable) was deleted.
- **R2**: bucket site-media (live), site-media-dev (dev), binding MEDIA. One folder per Library item (paths.js):
  a photo's original.<ext> (never shown to visitors) and renditions r1/, r2/ (<width>.<ext>, preview.jpg for
  paintings); a video's <w>x<h>.mp4 versions (one set) and frames wide-1/, tall-1/ (first-/last-<width>.jpg,
  once per shape, from that shape's largest version). Entries name the item (`media`) and the parts they use.
- **Painting entry**: name (its address, kept when retitled), title, medium, cm [height, width] (centimetres,
  to a tenth), year, estimated (not measured), size_shown (only when it differs from the default: shown when
  measured), details (made by the server: "Oil on canvas, 60 x 90 cm, 2020", "(est.)" after a shown estimate),
  section (genre), order, wide, white_paper (a drawing on white paper: reopening starts with "Find the paper"'s
  spots), w, h, widths, media, rendition, ext, preview, process (the darkroom's choices; paintings moved from git
  have none), featured (starred: on the home page's wall; only when true; a star in the editor's Gallery tab,
  a draft change like any other), hidden. A measured size drives the squared-up shape (unless "Square up to its measured proportions"
  is unticked); not measured, the photo's perspective gives the shape and the size only the scale.
- **Background entry** bg-<section> (hero, contact, footer: BACKGROUNDS in editor.js, PAGE's bg in edit/state.js;
  index.html marks them data-background): type photo (rendition, widths, w, h) or video (versions, frames, play
  once/loop, calm last/fade); both focus and shade.
- **The editor** (any host starting "admin": admin.chrisjones.org.uk for live, admin-dev for dev, each wholly
  behind Cloudflare Access, "Site editor" and "Site editor (dev)", team chrisjones-org-uk; editor.js checks the
  Access token too, vars ACCESS_TEAM and ACCESS_AUD). On that host the whole site shows drafts, with a pill at the
  bottom (worker.js bar(): an amber eye = this is the preview; the amber count = changes waiting, to Review, or a
  green tick when all is published; a pencil to the editor). The editor itself is /edit/ (edit/index.html and
  ES modules in edit/, listed in order at the top of edit/editor.js, each importing only from those above it:
  dom, state, marks, render, server, widgets, darkroom, uploads, details, picture, add, painting, background,
  uses, compare, the five *-view.js, editor.js which registers the views and starts. Shared state is the one
  `state` object in state.js, written only by server.js; render() still redraws the whole view. Its API
  /edit/api/* is in editor.js and library.js). On other hosts /edit is
  not found. A rejected token: worker.js signInAgain() clears Access's cookie once and retries, then shows a
  "Couldn't sign you in" page; API calls get 401 and the editor shows a "Sign in again" bar.
  Tabs: Gallery (add a painting, genres and their paintings, Edit forms), Content (a box per page section:
  heading, paragraphs, background box, contact links), Library (items newest first, Site pictures and Paintings:
  name edited in place, code, what uses it, a line per part, Delete for good when unused; tick two or three to
  compare side by side, or blink between two), Review (ticks, publish or discard), History (Bring back; for a
  removal, it undoes it). Header: an eye opens the preview.
  One saving rule: every change saves itself as a draft at once (a save queue), shown by a tick that takes no
  room (on the changed button's or label's top right corner, or inside a text field on its right), fading over
  3.5 seconds, with a tooltip. Hide (an eye on published paintings, genres, backgrounds) acts at once on the live
  site, as its own release. Remove takes a thing out of the page (its file stays in the Library); Delete for good
  only in the Library.
- **The darkroom** (edit/darkroom.js, in the browser, as the free plan gives Workers 10 ms of CPU): from a working
  copy (at most 4096 pixels): white balance from spots (none, one to even the colour, two to follow the light,
  three to five a flat slope, six or more a gentle curve), "Find the paper" placing 20 spots round a drawing's
  margins; brightness of the white (50 to 100%) and warmth kept; then four corners (guessed first, dragged in a
  full-screen view with magnifier and edge circles; labels say which is the bottom, so squaring up also turns or
  mirrors it), squared up by a perspective map to the measured shape or the photo's true proportions (Zhang and
  He's method). Before and after side by side; reopening shows previous and new, press and hold to blink, ghosts
  of the saved choices, "Back to as it was", "Replace photo…". Results are JPEG sizes (Safari can't encode WebP),
  made as the item's next rendition; a picture saves itself 1.2 s after the last change. The same photo is found
  by its hash and never uploaded twice.
- **Video uploads**: the browser can't re-encode, so a video is uploaded as made (MP4 only, under 95 megabytes),
  checked first (codec, fast start, sound, length, bit rate, size); first and last frames taken in the browser.

Local test: `.dev.vars` with DEV_USER="local test" (never committed);
`npx wrangler dev --env dev --local --persist-to /tmp/wr --port 8787` is the site, a second one on --port 8788
(with --inspector-port 9230) is the editor, signed in as DEV_USER; load the tables with
`CI=1 npx wrangler d1 migrations apply DB --env dev --local --persist-to /tmp/wr`, then content: a few rows
written by hand in dev's format (don't pull whole tables through the connector: about 45 kilobytes of JSON). R2
works locally too (empty), so uploads can be tested with made-up pictures. Headless Chromium with Playwright
works for the editor and, slowly (no graphics card), the gallery. Install wrangler and playwright outside the
repository; if Playwright's browser download is refused, launch with executablePath set to the one under
/opt/pw-browsers.

## Testing

For small changes (wording, colours, positions): push and let him check on dev. Browser tests only when behaviour
changes; screenshots only for layout questions; always say what was and wasn't tested (real phones and Safari
never are, from here).

## Cloudflare settings (dashboard, not the repository)

Secrets: PURGE_TOKEN (API token "Cache Purge" on zone chrisjones.org.uk) on both Workers, beside var ZONE_ID; a
secret saved in the dashboard must then be deployed. The Workers' Git connection is one repository connection for
both (repo_name chrisjones-org-uk). Always Use HTTPS, minimum TLS 1.2, DNSSEC, Email Routing (catch-all to his
Gmail). The domain's address records belong to the Workers' custom domains (including a wildcard) and can't be
edited by hand.

## Paper experiment (14 Nov 2026, on dev only)

A white page with charcoal words: one block at the end of site.css (its own commit, "Paper (experiment)"), over the
grey design; --page is the page colour, read by gallery.js and face.js. Words over pictures (.has-bg) stay white.
To drop it: `git revert` that commit. To put the gallery work live without it, fast-forward main to the commit
before it: `git merge --ff-only dc20bcf` in place of `dev`.

## The plan (agreed 10 Nov 2026 after the whole site review; each step in a new chat)

Review findings still open: entries are coupled (a painting carries its file, sizes, preview and darkroom
settings); the gallery judges gaps only sideways (paintings graze top to bottom, two over half covered on upright
phones); the wall grows with the collection (18 paintings, about five screens); paintings exist only in the 3D
drawing on the home page (invisible to search engines and screen readers); the Hero video has about 13,800
strokes in 20 seconds, the scene covered in four passes; the head animation's build scripts aren't here; the
editor redraws the whole view after every change; fonts come from Google, not the site; a draft rendition of a published item can be fetched by guessing its address.

1. **Clean start: done 11 Nov 2026, live.** These notes condensed and the README rewritten.
   One Gallery vocabulary: section #gallery (was #paintings), the gallery page /gallery/ (was /gallery/list/,
   file gallery/index.html), a painting /gallery/<name>/ (was /paintings/<name>/), the floating wall's script
   gallery.js at the top level (was gallery/gallery.js); "Hero" throughout (the Library's background names say
   Hero). Old addresses and redirects gone (/gallery to #paintings, /paintings/..., /gallery/list/). The editor
   moved from /admin/ to /edit/ (folder edit/), so "admin" is no longer in the address twice. The saved tick
   takes no room. The preview pill restyled as the editor's pills, in symbols. Old-format readers removed: details
   lines without medium/cm/year (History's 36 live and 41 dev versions were converted first, by API, 11 Nov 2026;
   D1 Time Travel bookmarks from before: live 00000217-00000002-00005120-33f29ce0b1f0a0f32674fd4a5a21ce89, dev
   00000128-00000002-00005120-2ca6c957ceb51be2bd6f6bb5c11bc029), the "paper all round" white balance (never stored
   in any process record; drawings marked white_paper now reopen with "Find the paper"'s spots; the method itself
   stays inside guessCorners), drafts hidden before Hide acted at once (none left). Also: the duplicate .float-text
   styles in index.html and a dead `section#gallery` rule removed; the 404 page's underlined link fixed.
   Tested locally (wrangler dev, Playwright): every address above, painting brought forward from its address and
   sent back, menu link from a painting's address, the editor and its API at /edit/, the tick's placement, the
   pill. Not tested on a phone or Safari.
2. **Gallery, public: done 11 Nov 2026, live.** Placement judged in both directions over the
   scrolling (wall.js; at six window sizes with the live paintings, grazes went from up to all the time two are
   in view to at most a quarter of it, edges lined up from up to 10 pairs to none; the wall about a tenth longer).
   His decisions: a star per painting, called Featured, chooses the home page's wall (and the no-3D
   stand-ins; the old settings-invitation entry, five painting names set by hand in the database with no editor
   control, and its code are gone, deleted from both databases); /gallery/ floating by default, one wall with genre titles passing; the view switch
   as two symbols just under the header, right-aligned under the menu's symbols (the gap before the pause
   button evened up for it). A painting's address is now the gallery page with it brought forward. On dev's
   database the five former invitation paintings are starred. He removed the Featured genre on both (Green Background
   with Seven Figures now in Drawings). Live had no paintings starred when it went live, so its home wall shows
   every painting until he stars some.
   Tested locally (wrangler dev, Playwright, no pictures as R2 isn't local): the gallery page floating with genre
   titles, switching to the grid and back, remembered on reload, a painting's address brought forward and
   Escape back to /gallery/, the switch's alignment (computer and phone sizes), the home page's switch showing
   only over the wall. Not tested: real phones, Safari, the editor's star (built, not clicked).
3. **Hero: parked 11 Nov 2026, design to decide.** Tried on dev and taken off again, so dev looks like live:
   - Half-height Hero on upright phones (.hero clamp(half the window, 75vw, the whole window); the gallery heading
     and snapping follow the Hero's height), first under the old see-through header (looked odd), then with the
     header as a floating bar (inset --bar-gap 14px, 8px on phones; rounded 14px; shadow; max 1240px), commit
     3108612, inspired by https://hidokmeh.com/ (its inset solid bar; not its tumbling gold 3D logo, agreed too much
     movement). Removed by 3f600c2; to bring both back: `git revert 3f600c2`. His to decide after sleeping on it, along
     with a small still mark in the header (paintbrush or palette knife, flat outline like the other symbols;
     perhaps one glint on load or pointing). Ask for screenshots of references: fetching a page gives only text.
   - Video v9 rendered (painted-forest-tools f7371e0, paint8.py): the same 13,829 strokes in one sweep from top
     left to bottom right, finer brushes trailing, 11.6 s (was 20); 3840x2880 11.3 MB, 2560x1920 5.3 MB, 1536x1152
     2.4 MB. He has the files but isn't keen: quicker but not lighter, and he doesn't like the sweep. His thought
     for next time: two passes instead of four (rather than one sweep). Not uploaded; dev's Hero is still v8
     (af55b314, 20 s); live's Hero is a photo (078633f1), his choice.
   - Later: an upright version only if needed; his reveal idea (strokes from the photo to his own real painting
     of it, colours from a photo of the painting); a filmed timelapse is far off.
4. **Uploads restructure**, with migration files and edit/editor.js split into modules. Three layers: Library
   item (file plus alt text, credit), Recipe (several per item; the painting's process moves here; photos of flat
   things squared up, scenes straightened and cropped; videos only crops/focus per shape and stills), uses
   (Artwork, Framing). The Library is the only upload; the Gallery picks from it (no "Add a painting" upload);
   Library routes ("Make a painting" from a photo, back into the gallery, uses marks linking to where they're
   used, "Replace photo… From the Library…"); paintings dragged to reorder and between genres; crop before any
   resizing (upload keeps only the original; sizes are made by a recipe). Also wanted: one original shared by
   several paintings (pentaptych parts), "Delete for good" from History too, a clear Review of background changes.
   In slices, each its own chat, each ending in a working state on dev: (1) migration files and edit/editor.js split
   into modules, nothing changing for him (no design decisions); (2) Library item and Recipe tables, paintings'
   process moved into Recipes; (3) the Library the only upload, the Gallery picking from it; (4) dragging to
   reorder and between genres, and the smaller extras.
   **Slice 1: done 11 Nov 2026, live.** edit/editor.js (1,884 lines) cut into 20 modules by line
   ranges, no logic changed; migrations/0001_initial.sql replaces db/schema.sql. Tested locally (wrangler dev,
   Playwright, fresh database made by the migration): a 42-step run through all five views, with real uploads to
   local R2 (add a painting, reopen its picture and change it, Library photos, backgrounds from the Library and
   from a file, compare and blink, publish, History's Bring back, Delete for good), run on the old single script
   and on the modules: every view's HTML and the final database contents came out identical. Not tested: videos,
   the full-screen corner and spot views, real phones, Safari.
   **Migrations in the builds: done 11 Nov 2026, both.** Each Worker's deploy command applies migrations first
   (set by API on the build triggers, live 7d78d6d4-0728-4141-8a1b-43ec43441cac, dev
   8834efe2-0394-4763-b062-25a83f572101): live `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`,
   dev the same with `--env dev` on both halves. Both build tokens have D1: Edit. 0001 is recorded as applied in
   both databases (their build logs showed it). A failed migration fails the build and leaves the running site
   as it was. Slice 2 is next.
   **Before slice 2 (agreed 11 Nov 2026): the entity model.** Write the whole model as docs/entities.md (every
   entity in the glossary, its attributes, keys and links; storage keyed by content digest, names living in the
   database, never in storage), checked against the design checks above. He agrees it before any table is
   built; the slices then build to it.
5. **Framings and backgrounds as lists**: a section points at a list of framings (one shown; carousel later),
   keeps its shade; a framing has settings for wide and upright screens (focus, crop, perhaps section height);
   paintings usable as backgrounds by reference. On a phone turning: photos follow by CSS; a playing video is
   never restarted or swapped, only re-cropped; a resting one may swap to the other shape's still or version.
6. **Edit in place**, replacing the Content tab: words edited on the preview; backgrounds chosen only from the
   Library (with "None") through a scrollable floating panel of tiles (one row or column) that stays open while
   the client clicks through several; contact links and other non-text settings in floating panels like ?tune.
   Sections added by the client come with it (then any section can be hidden, and given a background).
7. **Detail images and painting pages**: free-shape rectangles drawn on the squared-up painting, cut from the
   full-size original; probably a page for each painting that has them.
8. **Head animation**, after he retakes its videos (perhaps black and white; contours and movement). Decision: it
   plays itself once in a one-screen section, pausable like the Hero, instead of three screens of scrolling; try
   it on dev with speeds adjustable, his call after seeing it. He likes every part (sea, tornado, swoop, the head
   turning, triangles building the skin, face to photograph); the swoop is too fast. Live today it's about 1.8
   megabytes; a scrubbed video would be about 20 megabytes a version.
9. **Users and roles**.

Dropped: "change address" forwarding.
