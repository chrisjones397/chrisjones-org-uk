"""The painted-forest video, version 8: shorter (12 seconds, was 20) and painted in one sweep (see README).

The strokes are paint7.py's plan, unchanged (same seeds, same strokes, so the finished painting is the same).
Only the timing is new. paint7 painted in passes, one after another: the lay-in, the sky, the trunks, then the
rest of the scene four times over, big brushes to small. Here one front of painting crosses the picture once,
from the top left to the bottom right, and every layer follows it: the lay-in at the front, the sky and trunks
just behind, then the rest of the scene with each finer brush a little further behind the one before. The gap
between them is wider than the biggest stroke, so a fine stroke is still never covered by a big one painted
after it. The layers are stacked in a fixed order at the end (lay-in, sky, trunks, rest), so painting them at
the same time doesn't change the result. Strokes overlap in time: several are in progress in each frame.

  S=1 STILLS=3,6,12 python3 paint8.py   -> test stills at 1536 wide (frames at those seconds), pf8-<s>.jpg
  python3 paint8.py                     -> 360 frames at 3840 x 2880 in vf8-3840/ (FROM= and TO= render part)
"""
import os, sys, numpy as np, cv2

src = open('paint7.py').read()
cut = src.index('z3, z1 = np.zeros')
ns = {'__name__': 'paint7_plan'}
exec(compile(src[:cut], 'paint7.py', 'exec'), ns)        # the plan, exactly as at 1536

S = float(os.environ.get('S', 2.5))
H0, W0 = ns['H'], ns['W']
H, W = int(round(H0 * S)), int(round(W0 * S))
BS, BSM = ns['BS'], ns['BSM']
up = lambda m, interp=cv2.INTER_LINEAR: m if S == 1 else cv2.resize(np.asarray(m, np.float32), (W, H), interpolation=interp)

imgf = cv2.imread('forest-1536.jpg' if S == 1 else 'forest-3840.jpg').astype(np.float32)
assert imgf.shape[:2] == (H, W)
TOOTH = np.clip(up(ns['TOOTH'], cv2.INTER_CUBIC), 0, 1)
Z, Psoft, TZ, RZ = up(ns['Z']), up(ns['Psoft']), up(ns['TZ']), up(ns['RZ'])

STAMPS = {}
def find_stamp(s):
    for bi in (0, 1):
        for lv, (a0, _) in enumerate([BS[bi], BSM[bi][0], BSM[bi][1]]):
            if a0.shape != s['al'].shape: continue
            for fx in (False, True):
                for fy in (False, True):
                    a = a0[:, ::-1] if fx else a0
                    a = a[::-1] if fy else a
                    if np.array_equal(a, s['al']): return bi, lv, fx, fy
    return None

def scale(s):                                            # as paint7_full.py
    if S == 1: return s
    t = dict(s)
    t['x'] = (s['x'] + 0.5) * S - 0.5; t['y'] = (s['y'] + 0.5) * S - 0.5
    t['L'] = s['L'] * S; t['w'] = s['w'] * S
    if s.get('shaped'):
        f = find_stamp(s)
        if f is not None:
            bi, lv, fx, fy = f
            m = max(t['L'], t['w'])
            nlv = 2 if m < 24 else (1 if m < 60 else 0)
            if nlv < lv:
                key = (bi, nlv, fx, fy)
                if key not in STAMPS:
                    al, tx = [BS[bi], BSM[bi][0], BSM[bi][1]][nlv]
                    if fx: al, tx = al[:, ::-1], tx[:, ::-1]
                    if fy: al, tx = al[::-1], tx[::-1]
                    STAMPS[key] = (np.ascontiguousarray(al), np.ascontiguousarray(tx))
                t['al'], t['tx'] = STAMPS[key]
    return t

def reach(s):
    R = int(max(s['L'], s['w'])) + 2
    return (int(max(s['y'] - R, 0)), int(min(s['y'] + R, H - 1)) + 1, int(max(s['x'] - R, 0)), int(min(s['x'] + R, W - 1)) + 1)

def place(s, frac, C, A):                                # paint7.py's place(), at the new size
    L, w, ang = s['L'], s['w'], s['ang']; ca, sa = np.cos(ang), np.sin(ang)
    R = int(max(L, w)) + 2
    x0, x1 = int(max(s['x'] - R, 0)), int(min(s['x'] + R, W - 1)); y0, y1 = int(max(s['y'] - R, 0)), int(min(s['y'] + R, H - 1))
    if x1 <= x0 or y1 <= y0: return
    X, Y = np.meshgrid(np.arange(x0, x1 + 1) - s['x'], np.arange(y0, y1 + 1) - s['y'])
    u = X * ca + Y * sa + L / 2; v = -X * sa + Y * ca + w / 2
    hb, wb = s['al'].shape
    mx = (u / L * (wb - 1)).astype(np.float32); my = (v / w * (hb - 1)).astype(np.float32)
    a = cv2.remap(s['al'], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    t = cv2.remap(s['tx'], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=1)
    if s.get('shaped'):
        a = a * (u <= L * frac)
        if s['dry']: a = a * (1 - s['dry'] + s['dry'] * np.clip((t - 0.80) / 0.12, 0, 1))
        if s.get('scumble'):
            catch = 0.65 * TOOTH[y0:y1 + 1, x0:x1 + 1] + 0.35 * np.clip((t - 0.78) / 0.15, 0, 1)
            need = s['scumble'] + 0.3 * np.clip(u / L, 0, 1)
            a = a * np.clip((catch - need) / 0.12 + 0.5, 0, 1)
        if s['fade']: a = a * (1 - s['fade'] * np.clip(u / L, 0, 1))
        a = a * s['op']
        m_ = np.clip((t - 0.84) * 5 + 0.5, 0, 1)
        shade = 0.92 + 0.12 * m_
        lift = 16 * (m_ - 0.5) if s['kind'] in ('trunk', 'rest') else 0
    else:
        a = np.clip((a - 0.1) / 0.6, 0, 1) * (u <= L * frac)
        shade = 0.93 + 0.14 * np.clip((t - 0.85) * 4 + 0.5, 0, 1)
    col = s['c'][None, None] * shade[..., None]
    if s.get('shaped') and s['kind'] in ('trunk', 'rest'): col = col + lift[..., None]
    sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
    C[sl] = C[sl] * (1 - a[..., None]) + col * a[..., None]; A[sl] = A[sl] + (1 - A[sl]) * a

def compose(acc):
    (CL, AL), (C, A), (CT_, AT_), (CR_, AR_) = acc['L'], acc['S'], acc['T'], acc['R']
    out = imgf.copy()
    a = (AL * Z)[..., None]; out = out * (1 - a) + CL * a
    a = np.clip(A * Psoft, 0, 1)[..., None]; out = out * (1 - a) + C * a
    a = (AT_ * TZ)[..., None]; out = out * (1 - a) + CT_ * a
    a = (AR_ * RZ)[..., None]; out = out * (1 - a) + CR_ * a
    return np.clip(out, 0, 255).astype(np.uint8)

# ---------------- timing: one sweep ----------------
FPS = 30
SWEEP = 6.5          # seconds for the front to cross the picture
HOLD = 1.5           # the finished painting, still, at the end
# how far each layer runs behind the front, in seconds (the gap between brush sizes is wider than the biggest stroke)
LAG = {'L': 0.0, 'S': 0.35, 'T': 0.9, 'Td': 1.5, 0: 1.0, 1: 1.9, 2: 2.7, 2.5: 3.2, 3: 3.6, 4: 4.0}
jr = np.random.default_rng(97)
plan = []                                                 # (start, duration, layer, stroke)
for layer, lst in (('L', ns['layin']), ('S', ns['sky']), ('T', ns['trunk']), ('R', ns['rest'])):
    for s in lst:
        p = 0.55 * s['x'] / W0 + 0.45 * s['y'] / H0 + jr.normal(0, 0.03)     # where the front is (0 top left, 1 bottom right)
        key = s['li'] if layer == 'R' else ('Td' if layer == 'T' and s['w'] < 7.5 else layer)   # the bark's marks after its base
        start = LAG[key] + SWEEP * float(np.clip(p, 0, 1))
        dur = float(np.clip(s['L'] / 700, 1 / FPS, 0.6))                     # brush speed about 700 pixels a second (at 1536)
        plan.append((start, dur, layer, s))
plan.sort(key=lambda e: e[0])
plan = [(st, d, ly, scale(s)) for st, d, ly, s in plan]
END = max(st + d for st, d, _, _ in plan)
nf = int(np.ceil((END + HOLD) * FPS))
print('strokes', len(plan), 'painting ends at', round(END, 2), 's; frames', nf, flush=True)

acc = {k: [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)] for k in 'LSTR'}
stills = [float(v) for v in os.environ['STILLS'].split(',')] if os.environ.get('STILLS') else None
want = sorted({min(int(round(v * FPS)), nf - 1) for v in stills}) if stills else None
OUT = os.environ.get('OUT', 'vf8-3840'); f_from, f_to = int(os.environ.get('FROM', 0)), int(os.environ.get('TO', nf))
if not stills: os.makedirs(OUT, exist_ok=True)
nxt = 0; active = []
for f in range(nf):
    t = f / FPS
    while nxt < len(plan) and plan[nxt][0] <= t: active.append(plan[nxt]); nxt += 1
    still_going = []
    for e in active:                                      # strokes finished by now: painted for good, in start order
        if e[0] + e[1] <= t: place(e[3], 1.0, *acc[e[2]])
        else: still_going.append(e)
    active = still_going
    if want is not None:
        if f not in want: continue
    elif f < f_from or f >= f_to: continue
    saved = []
    for st, d, ly, s in active:                           # strokes in progress: painted part way, then taken off again
        y0, y1, x0, x1 = reach(s)
        saved.append((ly, y0, y1, x0, x1, acc[ly][0][y0:y1, x0:x1].copy(), acc[ly][1][y0:y1, x0:x1].copy()))
        place(s, 1 - (1 - (t - st) / d) ** 1.6, *acc[ly])
    out = compose(acc)
    for ly, y0, y1, x0, x1, c, a in reversed(saved):
        acc[ly][0][y0:y1, x0:x1], acc[ly][1][y0:y1, x0:x1] = c, a
    if want is not None: cv2.imwrite(f'pf8-{f / FPS:g}.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    else: cv2.imwrite(f'{OUT}/{f:04d}.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if want is not None and f >= want[-1]: break
print('done', flush=True)
