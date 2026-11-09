/* The contact links: the places someone can find or write to the site's owner, each a tick and a username in the
   editor (Content, Contact), with the link built from the username. One copy of the list, used by the page
   (site.js puts the ticked ones into the contact section and the header), the server (editor.js checks what's
   saved) and the editor page (admin/editor.js imports this file from the site's top folder).

   Stored as one entry, 'links' (kind 'links'): { <site>: { name, on } } in the order below, so an unticked site
   keeps its username for next time. Shown in this order too.

   Each site: what it's called, a sample username for the empty box, the pattern a username must match (after
   tidy(), which takes off a leading @ and reads a pasted profile address), the address it links to, how the
   username is shown, and its icon (SVG drawn in a 24-pixel square, lines in the text's colour). */

const ATTRS = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

export const SITES = [
  { key: 'email', name: 'Email', sample: 'hello@example.com', pattern: /^[^\s@<>"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
    url: (u) => `mailto:${u}`, shown: (u) => u,
    icon: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>' },
  { key: 'instagram', name: 'Instagram', sample: 'only1jones2', pattern: /^[a-z0-9._]{1,30}$/i,
    url: (u) => `https://www.instagram.com/${u}/`, shown: (u) => `@${u}`, hosts: ['instagram.com'],
    icon: '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.3"/><circle cx="17.4" cy="6.6" r="0.6"/>' },
  { key: 'bluesky', name: 'Bluesky', sample: 'name.bsky.social', pattern: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
    url: (u) => `https://bsky.app/profile/${u}`, shown: (u) => `@${u}`, hosts: ['bsky.app'], skip: ['profile'],
    icon: '<path transform="translate(12 12) scale(0.84) translate(-12 -12)" d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z"/>' },
  { key: 'facebook', name: 'Facebook', sample: 'your.name', pattern: /^[a-z0-9.]{1,50}$/i,
    url: (u) => `https://www.facebook.com/${u}`, shown: (u) => u, hosts: ['facebook.com', 'fb.com'],
    icon: '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><path d="M16 7.5h-1.6c-1.4 0-2.2.8-2.2 2.2V21.5M9 12.5h6"/>' },
  { key: 'threads', name: 'Threads', sample: 'your.name', pattern: /^[a-z0-9._]{1,30}$/i,
    url: (u) => `https://www.threads.com/@${u}`, shown: (u) => `@${u}`, hosts: ['threads.com', 'threads.net'],
    icon: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 9v4.2c0 2.6 3.9 2.6 3.9-1.2A7.5 7.5 0 1 0 15 18.9"/>' },
  { key: 'x', name: 'X', sample: 'yourname', pattern: /^[a-z0-9_]{1,15}$/i,
    url: (u) => `https://x.com/${u}`, shown: (u) => `@${u}`, hosts: ['x.com', 'twitter.com'],
    icon: '<path d="M4 4h4.2L20 20h-4.2zM19.5 4l-6.6 7.4M4.5 20l6.6-7.4"/>' },
  { key: 'linkedin', name: 'LinkedIn', sample: 'your-name', pattern: /^[a-z0-9-]{3,100}$/i,
    url: (u) => `https://www.linkedin.com/in/${u}/`, shown: (u) => u, hosts: ['linkedin.com'], skip: ['in'],
    icon: '<rect x="2.5" y="2.5" width="19" height="19" rx="3.5"/><circle cx="7.6" cy="7.4" r="0.6"/><path d="M7.6 10.5v6.5M11.2 17v-6.5M11.2 13.6c0-2 1.3-3.1 2.8-3.1s2.6 1 2.6 3.1V17"/>' },
  { key: 'tiktok', name: 'TikTok', sample: 'yourname', pattern: /^[a-z0-9._]{2,24}$/i,
    url: (u) => `https://www.tiktok.com/@${u}`, shown: (u) => `@${u}`, hosts: ['tiktok.com'],
    icon: '<path d="M13.5 3.5v11.3a3.6 3.6 0 1 1-3.6-3.6M13.5 3.5c.4 2.6 2.4 4.5 5 4.7"/>' },
  { key: 'youtube', name: 'YouTube', sample: 'yourchannel', pattern: /^[a-z0-9._-]{3,30}$/i,
    url: (u) => `https://www.youtube.com/@${u}`, shown: (u) => `@${u}`, hosts: ['youtube.com'],
    icon: '<rect x="2" y="5.5" width="20" height="13" rx="4"/><path d="M10 9.2l5 2.8-5 2.8z"/>' },
  { key: 'mastodon', name: 'Mastodon', sample: 'name@mastodon.social', pattern: /^[a-z0-9_]{1,30}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
    url: (u) => { const [n, host] = u.split('@'); return `https://${host}/@${n}`; }, shown: (u) => `@${u}`,
    icon: '<path d="M6 4h12a2.5 2.5 0 0 1 2.5 2.5v6.5a4.5 4.5 0 0 1-4.5 4.5h-4c-1.3 0-2.6.5-3.5 1.5v-1.6A4.5 4.5 0 0 1 3.5 13V6.5A2.5 2.5 0 0 1 6 4z"/><path d="M8 13.5V9.6a1.7 1.7 0 0 1 3.4 0V12M11.4 12V9.6a1.7 1.7 0 0 1 3.4 0v3.9"/>' },
];
export const SITE = Object.fromEntries(SITES.map((s) => [s.key, s]));

/* A username as typed, made into the stored form: spaces and a leading @ taken off, and a pasted profile address
   (https://www.instagram.com/name/, https://mastodon.social/@name...) read for the username. */
export function tidy(key, typed) {
  let u = String(typed || '').trim().replace(/^mailto:/i, '');
  const s = SITE[key];
  if (/^https?:\/\//i.test(u) || (s.hosts && s.hosts.some((h) => u.toLowerCase().replace(/^www\./, '').startsWith(`${h}/`)))) {
    try {
      const url = new URL(/^https?:/i.test(u) ? u : `https://${u}`);
      const parts = url.pathname.split('/').filter(Boolean).filter((p) => !(s.skip || []).includes(p));
      if (key === 'mastodon') {
        const n = (parts[0] || '').replace(/^@/, '');
        u = n ? `${n}@${url.hostname}` : u;
      } else if (parts[0]) u = decodeURIComponent(parts[0]);
    } catch { /* not an address after all: checked as typed */ }
  }
  return u.replace(/^@/, '');
}

export const ok = (key, u) => !!SITE[key] && SITE[key].pattern.test(u);
export const icon = (key, size) => `<svg viewBox="0 0 24 24"${size ? ` width="${size}" height="${size}"` : ''} aria-hidden="true" focusable="false" ${ATTRS} stroke-width="1.8">${SITE[key].icon}</svg>`;

/* The ticked links, in order, as [site, username]. */
export const ticked = (links) => SITES.filter((s) => links[s.key] && links[s.key].on && links[s.key].name).map((s) => [s, links[s.key].name]);
