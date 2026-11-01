"""Full-size render of the painted-forest video (see README).

Runs paint7.py's planning unchanged at 1536 wide (same seeds, same strokes), then renders every stroke
scaled by S = 2.5 to 3840 x 2880. Masks, the canvas tooth texture and the photo underneath are scaled
with the strokes. Each stroke keeps its brush stamp and flips; where the bigger stroke calls for a
finer copy of that stamp (the planner picked a small copy for small strokes), the finer copy is used.

  STILL=1 python3 paint7_full.py   -> still7-3840.jpg only
  python3 paint7_full.py           -> 600 frames in vf13-3840/
"""
import os, sys, numpy as np, cv2

src = open('paint7.py').read()
cut = src.index('z3, z1 = np.zeros')
ns = {'__name__': 'paint7_plan'}
exec(compile(src[:cut], 'paint7.py', 'exec'), ns)        # the plan, exactly as at 1536

S = 2.5
H0, W0 = ns['H'], ns['W']
H, W = int(round(H0 * S)), int(round(W0 * S))
BS, BSM = ns['BS'], ns['BSM']
up = lambda m, interp=cv2.INTER_LINEAR: cv2.resize(np.asarray(m, np.float32), (W, H), interpolation=interp)

imgf = cv2.imread('forest-3840.jpg').astype(np.float32)  # the photo under the paint, at full size (it lines up with forest-1536.jpg)
assert imgf.shape[:2] == (H, W)
TOOTH = np.clip(up(ns['TOOTH'], cv2.INTER_CUBIC), 0, 1)
Z, Psoft, TZ, RZ = up(ns['Z']), up(ns['Psoft']), up(ns['TZ']), up(ns['RZ'])

def find_stamp(s):
    """Which brush, which flips: so the same stamp can be fetched at the resolution the bigger stroke needs."""
    for bi in (0, 1):
        for lv, (a0, _) in enumerate([BS[bi], BSM[bi][0], BSM[bi][1]]):
            if a0.shape != s['al'].shape: continue
            for fx in (False, True):
                for fy in (False, True):
                    a = a0[:, ::-1] if fx else a0
                    a = a[::-1] if fy else a
                    if np.array_equal(a, s['al']): return bi, lv, fx, fy
    return None

def scale(s):
    t = dict(s)
    t['x'] = (s['x'] + 0.5) * S - 0.5; t['y'] = (s['y'] + 0.5) * S - 0.5
    t['L'] = s['L'] * S; t['w'] = s['w'] * S
    if s.get('shaped'):
        f = find_stamp(s)
        if f is not None:
            bi, lv, fx, fy = f
            m = max(t['L'], t['w'])
            nlv = 2 if m < 24 else (1 if m < 60 else 0)       # same rule as the planner, applied at the new size
            if nlv < lv:
                key = (bi, nlv, fx, fy)
                if key not in STAMPS:                         # one shared copy per stamp, not one per stroke
                    al, tx = [BS[bi], BSM[bi][0], BSM[bi][1]][nlv]
                    if fx: al, tx = al[:, ::-1], tx[:, ::-1]
                    if fy: al, tx = al[::-1], tx[::-1]
                    STAMPS[key] = (np.ascontiguousarray(al), np.ascontiguousarray(tx))
                t['al'], t['tx'] = STAMPS[key]
    return t
STAMPS = {}

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

def compose(CL, AL, C, A, CT_, AT_, CR_=None, AR_=None):
    out = imgf.copy()
    a = (AL * Z)[..., None]; out = out * (1 - a) + CL * a
    a = np.clip(A * Psoft, 0, 1)[..., None]; out = out * (1 - a) + C * a
    a = (AT_ * TZ)[..., None]; out = out * (1 - a) + CT_ * a
    if CR_ is not None: a = (AR_ * RZ)[..., None]; out = out * (1 - a) + CR_ * a
    return np.clip(out, 0, 255).astype(np.uint8)

layin = [scale(s) for s in ns['layin']]; sky = [scale(s) for s in ns['sky']]
trunk = [scale(s) for s in ns['trunk']]; rest = [scale(s) for s in ns['rest']]
new = lambda: [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)]

if os.environ.get('STILL'):
    acc = {k: new() for k in 'LSTR'}
    for k, lst in (('L', layin), ('S', sky), ('T', trunk), ('R', rest)):
        for s in lst: place(s, 1.0, *acc[k])
    cv2.imwrite('still7-3840.jpg', compose(*acc['L'], *acc['S'], *acc['T'], *acc['R']), [cv2.IMWRITE_JPEG_QUALITY, 92])
    sys.exit()

# timing: the same as paint7.py (it uses the 1536 sizes and positions, so it is computed from the plan's strokes)
FPS = 30; LAY, SKY, TRK, REST, HOLD = 1.5, 5.0, 4.5, 8.0, 1.0
TILE = 192
def tile_key(p):
    s_ = p[0]; ty, tx = int(s_['y']) // TILE, int(s_['x']) // TILE
    return (s_['li'], ty, tx if ty % 2 == 0 else -tx, s_['y'], s_['x'])
rest_v = [b for _, b in sorted(zip(ns['rest'], rest), key=tile_key)]
pairs = {'L': (ns['layin'], layin), 'S': (ns['sky'], sky), 'T': (ns['trunk'], trunk), 'R': (sorted(ns['rest'], key=lambda s_: tile_key((s_,))), rest_v)}
plan = []; t0 = 0.0
for layer, span in (('L', LAY), ('S', SKY), ('T', TRK), ('R', REST)):
    small, big = pairs[layer]
    lens = np.array([s_['L'] * (0.25 if (layer == 'S' and s_['y'] < 0.12 * H0) else 1) for s_ in small]); durs = span * lens / lens.sum() * 0.85
    gaps = max(span - durs.sum(), 0) / len(small); st = t0 + np.concatenate([[0], np.cumsum(durs + gaps)[:-1]])
    plan += [(layer, s_, a_, d_) for s_, a_, d_ in zip(big, st, durs)]
    t0 += span
acc = {k: new() for k in 'LSTR'}
OUT = os.environ.get('OUT', 'vf13-3840'); os.makedirs(OUT, exist_ok=True)
nf = int(round((LAY + SKY + TRK + REST + HOLD) * FPS)); done = 0
f_from, f_to = int(os.environ.get('FROM', 0)), int(os.environ.get('TO', nf))
for f in range(nf):
    t = f / FPS
    while done < len(plan) and plan[done][2] + plan[done][3] <= t:
        ly, s_, _, _ = plan[done]; place(s_, 1.0, *acc[ly]); done += 1
    if f < f_from or f >= f_to: continue
    cur = dict(acc)
    if done < len(plan) and t >= plan[done][2]:
        ly, s_, st_, d_ = plan[done]
        R = int(max(s_['L'], s_['w'])) + 2                     # copy only the area the stroke in progress touches
        y0, y1 = int(max(s_['y'] - R, 0)), int(min(s_['y'] + R, H - 1)) + 1
        x0, x1 = int(max(s_['x'] - R, 0)), int(min(s_['x'] + R, W - 1)) + 1
        c2, a2 = acc[ly][0][y0:y1, x0:x1].copy(), acc[ly][1][y0:y1, x0:x1].copy()
        cs, as_ = c2.copy(), a2.copy()
        place(s_, 1 - (1 - (t - st_) / d_) ** 1.6, *acc[ly])
        out = compose(*cur['L'], *cur['S'], *cur['T'], *cur['R'])
        acc[ly][0][y0:y1, x0:x1], acc[ly][1][y0:y1, x0:x1] = cs, as_   # undo the half-painted stroke
    else:
        out = compose(*cur['L'], *cur['S'], *cur['T'], *cur['R'])
    cv2.imwrite(f'{OUT}/{f:04d}.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 92])
print('frames', nf, 'strokes', len(plan))
