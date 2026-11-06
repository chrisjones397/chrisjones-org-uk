# Notes for Claude: chrisjones.org.uk

Christopher's site: hand-written HTML, CSS and JavaScript, no framework and no build step on Cloudflare.
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
  chrisjones397-github-io-dev builds dev (`npx wrangler deploy --env dev`). Settings in wrangler.jsonc;
  `.assetsignore` lists what isn't published (this file, the README, tools/, masters/, paintings.yaml...).

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
  white balanced by the build from the paper at their edges; masters untouched), plus
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
- **worker.js** (the only server code; wrangler.jsonc sends only /paintings/* to it): a painting's address is the
  home page with that painting brought forward, one version of the truth however you arrive. It serves index.html
  with that painting's title, description and og:image (from gallery/paintings.json), a canonical link, and
  `<base href="/">` so relative paths still work. There are no separate painting pages (removed Nov 2026).
  Test locally with `npx wrangler dev --env dev` (http://localhost:8787); plain Apache has no Worker.

## Testing

Christopher's usage matters, and the cloud browser has no graphics card (3D and video are very slow there).
For small changes (wording, colours, positions): build, push, and let him check on dev. Run browser tests only
when behaviour changes (snapping, gallery switching), keep screenshots to layout questions, and say what was
and wasn't tested.
