/* The admin page's server side (worker.js hands it every /admin address).

   Who can use it: only someone Cloudflare Access has signed in. Access sits in front of /admin on
   dev.chrisjones.org.uk and asks for a one-time code sent to Christopher's email address; after that it passes
   each request on with a signed token (the Cf-Access-Jwt-Assertion header). This file checks that token's
   signature and audience itself as well, so even a request that somehow got past Access gets nothing.

   It only works on the dev Worker, which has the settings it needs:
     ACCESS_TEAM    the Zero Trust team name (the <team> in <team>.cloudflareaccess.com)    } in wrangler.jsonc,
     ACCESS_AUD     the Access application's audience tag                                 } env.dev.vars
     GITHUB_TOKEN   a GitHub token that can write the contents of this one repository: a secret, set in the
                    dashboard (Worker, Settings, Variables and Secrets), which deploys keep
   Without them (as on the live Worker), every /admin address is "not found".

   Adding a painting makes one commit on dev with two changes: the photo as masters/<name>.<ext> and the
   painting's entry in paintings.yaml. Cloudflare's build of dev runs tools/build_site.py --missing-only, which
   makes its image sizes and gallery entry. */

const REPO = 'chrisjones397/chrisjones397.github.io';
const BRANCH = 'dev';
const MAX_BYTES = 40 * 1024 * 1024;

export async function admin(request, env, url) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !env.GITHUB_TOKEN) return env.ASSETS.fetch(new URL('/404.html', url));
  const who = await signedIn(request, env);
  if (!who) return new Response('Sign in required.', { status: 403 });

  if (url.pathname === '/admin') return Response.redirect(`${url.origin}/admin/`, 301);
  if (url.pathname === '/admin/') {
    const page = await env.ASSETS.fetch(new URL('/admin/index.html', url));
    return new Response(page.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  try {
    if (url.pathname === '/admin/api/sections' && request.method === 'GET') {
      const { yaml } = await readYaml(env);
      return json({ sections: sectionTitles(yaml), names: paintingTitles(yaml).map(slug) });
    }
    if (url.pathname === '/admin/api/add' && request.method === 'POST') return await add(request, env, who);
  } catch (e) {
    return json({ error: e.message || String(e) }, e.status || 500);
  }
  return env.ASSETS.fetch(new URL('/404.html', url));
}

// ---- signing in: check the Access token -------------------------------------------------------------------

let certs = null;   // the team's public keys, kept while this Worker instance lives
async function signedIn(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  if (!sig) return null;
  try {
    const header = JSON.parse(b64text(h)), payload = JSON.parse(b64text(p));
    const auds = [].concat(payload.aud);
    if (!auds.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    for (const fresh of [false, true]) {
      if (!certs || fresh) {
        const r = await fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
        certs = (await r.json()).keys;
      }
      const jwk = certs.find((k) => k.kid === header.kid);
      if (!jwk) continue;
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64bytes(sig), new TextEncoder().encode(`${h}.${p}`));
      return ok ? (payload.email || 'signed in') : null;
    }
  } catch { /* a malformed token is simply not signed in */ }
  return null;
}
const b64bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64text = (s) => new TextDecoder().decode(b64bytes(s));

// ---- adding a painting -------------------------------------------------------------------------------------

async function add(request, env, who) {
  const form = await request.formData();
  const field = (k) => String(form.get(k) || '').trim();
  const title = field('title');
  const name = slug(title);
  if (!title || !name) throw fail('The title is missing.');
  const image = form.get('image');
  if (!image || typeof image === 'string' || !image.size) throw fail('The photo is missing.');
  if (image.size > MAX_BYTES) throw fail('The photo is over 40 MB.');
  const ext = (image.name.match(/\.(jpg|png|webp|tif)$/) || [])[1];
  if (!ext) throw fail('The photo must be JPEG, PNG, WebP or TIFF.');
  let section = field('section');
  const isNew = section === '__new';
  if (isNew) section = field('newsection');
  if (!section) throw fail('The section is missing.');

  const details = [field('medium'),
    field('height') && field('width') ? `${num(field('height'))} x ${num(field('width'))} cm` : '',
    field('year')].filter(Boolean).join(', ');
  const entry = [`      - title: ${q(title)}`]
    .concat(details ? [`        details: ${q(details)}`] : [])
    .concat(field('wide') ? ['        wide: true'] : [])
    .concat(field('white_paper') ? ['        white_paper: true'] : []);

  // Read dev as it is now, add to it, and move dev on, trying again if something else was pushed meanwhile.
  const bytes = new Uint8Array(await image.arrayBuffer());
  for (let attempt = 0; attempt < 3; attempt++) {
    const { yaml, commit, tree } = await readYaml(env);
    if (paintingTitles(yaml).map(slug).includes(name)) throw fail(`“${title}” is already in the gallery.`);
    if (!isNew && !sectionTitles(yaml).includes(section)) throw fail(`There's no section called “${section}”.`);
    if (isNew && sectionTitles(yaml).includes(section)) throw fail(`There's already a section called “${section}”.`);
    const changed = isNew ? addSection(yaml, section, entry) : addToSection(yaml, section, entry);

    const blob = await gh(env, 'POST', '/git/blobs', { content: base64(bytes), encoding: 'base64' });
    const newTree = await gh(env, 'POST', '/git/trees', { base_tree: tree, tree: [
      { path: `masters/${name}.${ext}`, mode: '100644', type: 'blob', sha: blob.sha },
      { path: 'paintings.yaml', mode: '100644', type: 'blob', content: changed },
    ] });
    const made = await gh(env, 'POST', '/git/commits', {
      message: `Add “${title}” (from the admin page)\n\n${isNew ? 'In a new section' : 'In the section'} ${section}; sent by ${who}.`,
      tree: newTree.sha, parents: [commit],
    });
    try {
      await gh(env, 'PATCH', `/git/refs/heads/${BRANCH}`, { sha: made.sha, force: false });
      return json({ name, section, commit: made.sha });
    } catch (e) {
      if (e.status !== 422) throw e;   // 422: dev moved on while we worked; read it again
    }
  }
  throw fail('dev kept changing while adding; try again.', 409);
}

// ---- paintings.yaml, edited as text so its comments and layout stay as they are ---------------------------

// The lines of the sections: list, from "sections:" to the next top-level line (or the end).
function sectionsBlock(lines) {
  const start = lines.findIndex((l) => /^sections:\s*$/.test(l));
  if (start < 0) throw fail("paintings.yaml has no sections: list.", 500);
  let end = start + 1;
  while (end < lines.length && !/^\S/.test(lines[end])) end++;
  return [start, end];
}
const unq = (s) => {   // a YAML scalar's value: double-quoted, single-quoted or plain (up to any " #" comment)
  s = s.trim();
  let m = s.match(/^"((?:[^"\\]|\\.)*)"/);
  if (m) return JSON.parse(`"${m[1]}"`);
  m = s.match(/^'((?:[^']|'')*)'/);
  if (m) return m[1].replace(/''/g, "'");
  return s.replace(/\s+#.*$/, '').trim();
};
function sectionTitles(yaml) {
  const lines = yaml.split('\n'), [a, b] = sectionsBlock(lines);
  return lines.slice(a, b).map((l) => l.match(/^  - title:\s*(.+)$/)).filter(Boolean).map((m) => unq(m[1]));
}
function paintingTitles(yaml) {
  return yaml.split('\n').map((l) => l.match(/^      - title:\s*(.+)$/)).filter(Boolean).map((m) => unq(m[1]));
}
function addToSection(yaml, section, entry) {
  const lines = yaml.split('\n'), [a, b] = sectionsBlock(lines);
  const at = lines.findIndex((l, i) => i > a && i < b && /^  - title:/.test(l) && unq(l.replace(/^  - title:/, '')) === section);
  let end = at + 1;   // the section runs to the next section or the end of the list
  while (end < b && !/^  - title:/.test(lines[end])) end++;
  while (end > at + 1 && lines[end - 1].trim() === '') end--;   // before any blank lines that end it
  lines.splice(end, 0, ...entry);
  return lines.join('\n');
}
function addSection(yaml, section, entry) {
  const lines = yaml.split('\n'), [a, b] = sectionsBlock(lines);
  let end = b;
  while (end > a + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, '', `  - title: ${q(section)}`, '    paintings:', ...entry);
  return lines.join('\n');
}
const q = (s) => JSON.stringify(s);   // a double-quoted YAML string (so "#" and ": " are safe)
const num = (s) => String(Number(s));

// The same rule as slug() in tools/build_site.py.
export function slug(title) {
  let t = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  t = t.replace(/&/g, ' and ').replace(/[#,.'’]/g, '');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---- GitHub ------------------------------------------------------------------------------------------------

async function readYaml(env) {
  const ref = await gh(env, 'GET', `/git/ref/heads/${BRANCH}`);
  const commit = ref.object.sha;
  const c = await gh(env, 'GET', `/git/commits/${commit}`);
  const file = await gh(env, 'GET', `/contents/paintings.yaml?ref=${commit}`);
  const yaml = new TextDecoder().decode(b64bytes(file.content.replace(/\n/g, '')));
  return { yaml, commit, tree: c.tree.sha };
}
async function gh(env, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
               'x-github-api-version': '2022-11-28', 'user-agent': 'chrisjones.org.uk admin' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = new Error(`GitHub said ${r.status} to ${method} ${path.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
