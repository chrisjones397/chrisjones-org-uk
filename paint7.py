import numpy as np, cv2, os, sys, json
rng = np.random.default_rng(5)
img = cv2.imread('forest-1536.jpg'); H, W = img.shape[:2]
imgf = img.astype(np.float32)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
yy = np.arange(H)[:, None] * np.ones((1, W))
up = yy < 0.405 * H            # below this, the light patches are sunlit ground and ferns, not sky

# ---------------- sky: unchanged from the approved version ----------------
core = (hsv[..., 2] > 232) & (hsv[..., 1] < 45) & up
nearsky = cv2.dilate(core.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
Psoft = (np.clip((hsv[..., 2] - 188) / 40, 0, 1) * np.clip((125 - hsv[..., 1]) / 55, 0, 1) * nearsky * up).astype(np.float32)
# bright sky caught in a trunk's traced edge (between the trunk and the leaves) is sky, not trunk
_rough = np.zeros((H, W), np.uint8)
for _p in json.load(open('outlines.json')).values(): cv2.fillPoly(_rough, [np.array(_p, np.int32)], 1)
_inner = cv2.erode(_rough, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
edge_sky = (cv2.imread('trunkmask.png', 0) > 0) & (hsv[..., 2] > 215) & (hsv[..., 1] < 50) & (_inner == 0) & up
Psoft = np.maximum(Psoft, edge_sky.astype(np.float32))
P = (Psoft > 0.5).astype(np.uint8)
dist = cv2.distanceTransform(P, cv2.DIST_L2, 5)
sd = cv2.GaussianBlur(dist, (0, 0), 8); gx, gy = cv2.Sobel(sd, cv2.CV_32F, 1, 0), cv2.Sobel(sd, cv2.CV_32F, 0, 1)
pal = np.array([[183, 142, 115], [188, 149, 122], [178, 137, 110], [181, 146, 124], [190, 152, 128]], np.float32)
pal_top = np.array([[148, 100, 74], [153, 105, 79], [143, 95, 69], [150, 104, 82]], np.float32)
layin_col = np.array([192, 163, 141], np.float32); layin_top = np.array([168, 132, 108], np.float32)

BR = []        # as used for the sky (the stamp's full rectangle, textured)
BS = []        # the real brush shape, for the new strokes
BSM = []       # ...and smaller copies of it
for f in ['brush_fromweb2_large_horizontal.png', 'brush_fromweb2_small_horizontal.png']:
    im = cv2.imread('brushes/' + f, cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
    ys_, xs_ = np.nonzero(im[..., 3] > 0.05); imc = im[ys_.min():ys_.max() + 1, xs_.min():xs_.max() + 1]
    BR.append((np.ascontiguousarray(imc[..., 3]), np.ascontiguousarray(cv2.cvtColor(imc[..., :3], cv2.COLOR_BGR2GRAY))))
    g = cv2.cvtColor(im[..., :3], cv2.COLOR_BGR2GRAY)
    ys_, xs_ = np.nonzero(g > 0.05); g = g[ys_.min():ys_.max() + 1, xs_.min():xs_.max() + 1]
    sh_ = cv2.GaussianBlur(np.clip((g - 0.05) / 0.45, 0, 1), (0, 0), 3)          # the real brush outline, softened a little
    BS.append((np.ascontiguousarray(sh_), np.ascontiguousarray(g)))
    mips = []
    for k_ in (4, 8):
        sz = (max(g.shape[1] // k_, 8), max(g.shape[0] // k_, 8))
        mips.append((np.ascontiguousarray(cv2.resize(sh_, sz, interpolation=cv2.INTER_AREA)), np.ascontiguousarray(cv2.resize(g, sz, interpolation=cv2.INTER_AREA))))
    BSM.append(mips)

def stroke(x, y, ang, L, w, r):
    P_ = pal_top if y < 0.12 * H else pal
    c = P_[r.integers(len(P_))] + r.normal(0, 3, 3) + np.array([10, 2, -10]) * np.clip(y / (0.45 * H), 0, 1)
    return shaped(x, y, ang, L, w, c, r, kind='sky')

_tr = np.random.default_rng(77)
TOOTH = (0.6 * cv2.GaussianBlur(_tr.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 1.0) * 2.2
         + 0.4 * cv2.GaussianBlur(_tr.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 3.0) * 4.0)
TOOTH = np.clip((TOOTH - TOOTH.mean()) / (4 * TOOTH.std()) + 0.5, 0, 1)        # 0 = hollow, 1 = high point of the surface

def shaped(x, y, ang, L, w, c, r, op=1.0, dry=0.0, fade=0.0, big=None, kind='', scumble=0.0):
    bi = 0 if (r.random() < 0.75 if big is None else big) else 1
    al, tx = BS[bi]
    if max(L, w) < 24: al, tx = BSM[bi][1]
    elif max(L, w) < 60: al, tx = BSM[bi][0]
    if r.random() < 0.5: al, tx = al[:, ::-1].copy(), tx[:, ::-1].copy()
    if r.random() < 0.5: al, tx = al[::-1].copy(), tx[::-1].copy()
    return dict(x=x, y=y, ang=ang, L=L, w=w, al=al, tx=tx, c=np.asarray(c, np.float32), op=op, dry=dry, fade=fade, shaped=True, kind=kind, scumble=scumble)

def place(s, frac, C, A):
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
        if s['dry']: a = a * (1 - s['dry'] + s['dry'] * np.clip((t - 0.80) / 0.12, 0, 1))   # thin paint catches on the bristle lines
        if s.get('scumble'):                                                   # dry paint, rough surface: it only catches on the high points,
            catch = 0.65 * TOOTH[y0:y1 + 1, x0:x1 + 1] + 0.35 * np.clip((t - 0.78) / 0.15, 0, 1)   # along the bristle lines,
            need = s['scumble'] + 0.3 * np.clip(u / L, 0, 1)                   # and less as the brush runs dry along the stroke
            a = a * np.clip((catch - need) / 0.12 + 0.5, 0, 1)
        if s['fade']: a = a * (1 - s['fade'] * np.clip(u / L, 0, 1))                         # and runs out along the stroke
        a = a * s['op']
        m_ = np.clip((t - 0.84) * 5 + 0.5, 0, 1)
        shade = 0.92 + 0.12 * m_                                              # the bristle marks show in each stroke...
        lift = 16 * (m_ - 0.5) if s['kind'] in ('trunk', 'rest') else 0                 # ...and on dark bark the ridges catch the light
    else:
        a = np.clip((a - 0.1) / 0.6, 0, 1) * (u <= L * frac)
        shade = 0.93 + 0.14 * np.clip((t - 0.85) * 4 + 0.5, 0, 1)
    col = s['c'][None, None] * shade[..., None]
    if s.get('shaped') and s['kind'] in ('trunk', 'rest'): col = col + lift[..., None]
    sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
    C[sl] = C[sl] * (1 - a[..., None]) + col * a[..., None]; A[sl] = A[sl] + (1 - A[sl]) * a

# sky strokes: same plan as before, now with the real brush shape
cov = np.zeros((H, W), np.float32); dummy = np.zeros((H, W, 3), np.float32); sky = []; last = None
for i in range(320):
    todo = (P > 0) & (cov < 0.6)
    dens = cv2.blur(todo.astype(np.float32), (51, 51)); big = todo & (dens > 0.05)
    if big.sum() < 0.01 * P.sum(): break
    ys, xs = np.nonzero(big)
    top = ys < 0.12 * H
    if top.any(): xs, ys = xs[top], ys[top]; k_ = np.argmin(xs - 500 * dens[ys, xs] + rng.uniform(0, 30, len(xs)))
    else:
        sec = xs * 5 // W; h_ = sec == sec.min(); xs, ys = xs[h_], ys[h_]
        if last is None: last = (xs.min(), 0.12 * H)
        k_ = np.argmin(np.hypot(xs - last[0], ys - last[1]) - 600 * dens[ys, xs] + rng.uniform(0, 40, len(xs)))
    x, y = xs[k_], ys[k_]
    dd = dist[y, x]; wedge = np.clip(1 - dd / 30, 0, 1)
    ae = np.arctan2(gy[y, x], gx[y, x]) + np.pi / 2; af = np.deg2rad(rng.normal(-20, 15))
    ang = np.arctan2(np.sin(ae) * wedge + np.sin(af) * (1 - wedge), np.cos(ae) * wedge + np.cos(af) * (1 - wedge))
    w = rng.uniform(34, 60) if dd > 10 else rng.uniform(24, 38); L = w * rng.uniform(1.3, 2.4)
    s = stroke(x, y, ang, L, w, np.random.default_rng(i + 7)); sky.append(s)
    place(s, 1.0, dummy, cov); last = (x, y)
print('sky strokes', len(sky), 'left', round(float(((P > 0) & (cov < 0.6)).sum() / P.sum()), 3))

over = cv2.morphologyEx(P, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
reach = cv2.dilate(P, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(np.float32)
rag = np.clip(cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 2.5) * 1.2 + 0.5, 0, 1)
Psoft = np.clip(np.maximum(np.maximum(Psoft, over.astype(np.float32)), reach * rag), 0, 1)
washzone = reach * np.clip((hsv[..., 2] - 175) / 40, 0, 1) * np.clip((150 - hsv[..., 1]) / 60, 0, 1)
Z = np.maximum(Psoft, washzone)                     # where the lay-in goes: the sky and the glare between leaves beside it

# ---------------- lay-in: a few big, thin, scrubbed strokes instead of the flat wash ----------------
lr = np.random.default_rng(11); covL = np.zeros((H, W), np.float32); layin = []; last = None
Zb = Z > 0.3
for i in range(45):
    todo = Zb & (covL < 0.8)
    if todo.sum() < 0.01 * Zb.sum(): break
    dens = cv2.blur(todo.astype(np.float32), (101, 101))
    ys, xs = np.nonzero(todo)
    if last is None: last = (0, 0)
    k_ = np.argmin(np.abs(xs - last[0]) * 1.0 + np.abs(ys - last[1]) * 0.4 - 900 * dens[ys, xs] + lr.uniform(0, 60, len(xs)))
    x, y = xs[k_], ys[k_]
    w = lr.uniform(95, 140); L = w * lr.uniform(1.8, 2.6)
    ang = np.deg2rad(lr.normal(-15, 28)) + (np.pi if lr.random() < 0.5 else 0)
    c = (layin_top if y < 0.12 * H else layin_col) + lr.normal(0, 5, 3) + np.array([8, 2, -8]) * np.clip(y / (0.45 * H), 0, 1)
    s = shaped(x, y, ang, L, w, c, lr, op=lr.uniform(0.72, 0.86), dry=0.5, fade=0.4, big=True, kind='layin'); layin.append(s)
    place(s, 1.0, dummy, covL); last = (x, y)
print('lay-in strokes', len(layin), 'left', round(float((Zb & (covL < 0.5)).sum() / Zb.sum()), 3))

# ---------------- trunks ----------------
M = (cv2.imread('trunkmask.png', 0) > 0).astype(np.uint8)
leafy = ((hsv[..., 0] > 22) & (hsv[..., 0] < 95) & (hsv[..., 1] > 70) & (hsv[..., 2] > 50)).astype(np.uint8)
leafy = cv2.morphologyEx(leafy, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))       # leaves in front of the trunks stay
T0 = (M & (1 - leafy)).astype(np.uint8)
T0[edge_sky] = 0                                                   # (see the sky section)
rag2 = np.clip(cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 2.0) * 1.2 + 0.5, 0, 1)
near_sky = cv2.dilate(T0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))).astype(np.float32) * (Z > 0.05)   # close the light gap between trunk and sky
TZ = np.clip(np.maximum(np.maximum(T0.astype(np.float32), cv2.dilate(T0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) * rag2), near_sky * rag2), 0, 1)
TZ = TZ * (1 - cv2.GaussianBlur(leafy.astype(np.float32), (0, 0), 1.0))
outl = json.load(open('outlines.json'))
order = sorted(outl, key=lambda k: np.mean([p[0] for p in outl[k]]))
lab = np.full((H, W), -1, np.int32); axis = np.zeros((H, W), np.float32); width = np.zeros((H, W), np.float32)
for ti, k in enumerate(order):
    pm = np.zeros((H, W), np.uint8); cv2.fillPoly(pm, [np.array(outl[k], np.int32)], 1)
    pm = cv2.dilate(pm, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) & M
    rows = np.nonzero(pm.any(1))[0]
    cx = np.array([np.nonzero(pm[r])[0].mean() for r in rows]); wd = np.array([pm[r].sum() for r in rows], np.float32)
    cxs = cv2.GaussianBlur(cx.reshape(-1, 1).astype(np.float32), (1, 0), 20).ravel() if len(cx) > 3 else cx
    slope = np.gradient(cxs) if len(cxs) > 2 else np.zeros_like(cxs)
    ang_r = np.arctan2(1.0, slope); wd = cv2.GaussianBlur(wd.reshape(-1, 1), (1, 0), 10).ravel() * np.abs(np.sin(ang_r))
    for r, a_, w_ in zip(rows, ang_r, wd):
        sel = pm[r] > 0; lab[r, sel] = ti; axis[r, sel] = a_; width[r, sel] = w_
blur_s = {s_: cv2.GaussianBlur(imgf, (0, 0), s_) for s_ in (2, 4, 8)}
def sample(x, y, w):
    s_ = 2 if w < 10 else (4 if w < 22 else 8)
    return blur_s[s_][y, x]

Tf = T0.astype(np.float32)
local = cv2.GaussianBlur(imgf * Tf[..., None], (0, 0), 25) / np.maximum(cv2.GaussianBlur(Tf, (0, 0), 25), 1e-3)[..., None]
lab_img = cv2.cvtColor(np.clip(blur_s[4], 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
pals = {}
for ti_ in range(len(order)):
    px = lab_img[(lab == ti_) & (T0 > 0)]
    if len(px) < 50: continue
    K = 5 if len(px) > 20000 else 4
    _, _, cen = cv2.kmeans(px, K, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5), 4, cv2.KMEANS_PP_CENTERS)
    m = cen.mean(0); cen[:, 0] = m[0] + (cen[:, 0] - m[0]) * 1.1          # a little more light and dark between the mixes
    pals[ti_] = (cen, cv2.cvtColor(np.clip(cen, 0, 255).astype(np.uint8)[None], cv2.COLOR_LAB2BGR)[0].astype(np.float32))
def mix(ti_, c, r):
    cen, bgr = pals[ti_]
    l_ = cv2.cvtColor(np.clip(c, 0, 255).astype(np.uint8)[None, None], cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
    j = int(np.argmin(((cen - l_) ** 2).sum(1)))
    return bgr[j] + r.normal(0, 2.5, 3)                                      # the same mix, picked up again: nearly identical
tr = np.random.default_rng(23); trunk = []; covT = np.zeros((H, W), np.float32)
CT = np.zeros((H, W, 3), np.float32); AT = np.zeros((H, W), np.float32)
for ti, k in enumerate(order):                        # the base: each trunk in turn, top to bottom
    mine = (lab == ti) & (T0 > 0); last = None
    for i in range(400):
        todo = mine & (covT < 0.65)
        if todo.sum() < 0.01 * max(mine.sum(), 1): break
        ys, xs = np.nonzero(todo)
        if last is None: k_ = np.argmin(ys + tr.uniform(0, 20, len(ys)))
        else: k_ = np.argmin(np.hypot(xs - last[0], (ys - last[1]) * 1.5) + tr.uniform(0, 15, len(xs)))
        x, y = xs[k_], ys[k_]
        w = float(np.clip(0.5 * width[y, x], 9, 40)) * tr.uniform(0.85, 1.15); L = w * tr.uniform(1.4, 2.6)
        ang = axis[y, x] + np.deg2rad(tr.normal(0, 12)) + (np.pi / 2 + np.deg2rad(tr.normal(0, 20)) if tr.random() < 0.15 else 0)
        pts = [(int(np.clip(x + np.cos(ang) * d, 0, W - 1)), int(np.clip(y + np.sin(ang) * d, 0, H - 1))) for d in np.linspace(-L / 3, L / 3, 5)]
        pts = [p for p in pts if mine[p[1], p[0]]] or [(x, y)]
        c = np.median([blur_s[8][p[1], p[0]] for p in pts], 0)
        c = mix(ti, local[y, x] + 1.25 * (c - local[y, x]), tr)     # each stroke is one colour from this trunk's palette
        s = shaped(x, y, ang, L, w, c, tr, kind='trunk'); s['ti'] = ti; trunk.append(s)
        place(s, 1.0, CT, AT); place(s, 1.0, dummy, covT); last = (x, y)
nbase = len(trunk)
# details: smaller strokes where the paint so far differs most from the photo (the bark's light patches and dark marks)
for ti, k in enumerate(order):
    mine = (lab == ti) & (T0 > 0); covD = np.zeros((H, W), np.float32)
    for i in range(40):
        diff = np.abs(blur_s[2] - CT).sum(2) * mine * (covD < 0.5)
        dd_ = cv2.blur(diff, (9, 9))
        y, x = np.unravel_index(np.argmax(dd_), dd_.shape)
        if dd_[y, x] < 70: break
        w = float(np.clip(0.12 * width[y, x], 3, 6)) * tr.uniform(0.85, 1.2); L = w * tr.uniform(3, 5)
        pale = local[y, x].mean() > 140 and blur_s[2][y, x].mean() < local[y, x].mean()
        ang = axis[y, x] + (np.pi / 2 if pale else 0) + np.deg2rad(tr.normal(0, 10))   # dark marks across pale birch bark
        s = shaped(x, y, ang, L, w, mix(ti, sample(x, y, 5), tr), tr, big=False, kind='trunk'); s['ti'] = ti; trunk.append(s)
        place(s, 1.0, CT, AT); place(s, 1.0, dummy, covD)
print('trunk strokes', nbase, '+ detail', len(trunk) - nbase)
trunk = sorted(trunk, key=lambda s_: s_['ti'])          # in the video: one trunk at a time, its marks straight after

# ---------------- the rest of the scene: leaves, grass, bracken, ground, the fern ----------------
Rcore = ((Z < 0.3) & (T0 == 0)).astype(np.uint8)                       # not the sky (or its glare), not the trunks
rag3 = np.clip(cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 2.0) * 1.2 + 0.5, 0, 1)
RZ = np.clip(np.maximum(Rcore.astype(np.float32), cv2.dilate(Rcore, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) * rag3), 0, 1)
rr = np.random.default_rng(31)
pick = np.nonzero(Rcore.ravel())[0]; pick = rr.choice(pick, min(60000, len(pick)), replace=False)
labR = cv2.cvtColor(np.clip(blur_s[4], 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).reshape(-1, 3)[pick].astype(np.float32)
_, _, cenR = cv2.kmeans(labR, 14, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.5), 3, cv2.KMEANS_PP_CENTERS)
bgrR = cv2.cvtColor(np.clip(cenR, 0, 255).astype(np.uint8)[None], cv2.COLOR_LAB2BGR)[0].astype(np.float32)
def mixR(c, r):
    l_ = cv2.cvtColor(np.clip(c, 0, 255).astype(np.uint8)[None, None], cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
    return bgrR[int(np.argmin(((cenR - l_) ** 2).sum(1)))] + r.normal(0, 2.5, 3)
gray = cv2.cvtColor(np.clip(blur_s[2], 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
Ix, Iy = cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)
Jxx, Jyy, Jxy = [cv2.GaussianBlur(v, (0, 0), 6) for v in (Ix * Ix, Iy * Iy, Ix * Iy)]
theta = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy) + np.pi / 2                 # along the edges
lam = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2); coher = (lam / (Jxx + Jyy + 1e-3)) ** 2
refs = {12: cv2.GaussianBlur(imgf, (0, 0), 12), 6: cv2.GaussianBlur(imgf, (0, 0), 6), 3: cv2.GaussianBlur(imgf, (0, 0), 3), 2: blur_s[2]}
fhsv = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.0), cv2.COLOR_BGR2HSV)
FERN = ((fhsv[..., 0] >= 22) & (fhsv[..., 0] <= 52) & (fhsv[..., 1] > 90) & (fhsv[..., 2] > 100)).astype(np.uint8)
_reg = np.zeros_like(FERN); _reg[600:900, 540:1230] = 1; FERN &= _reg
FERN = cv2.morphologyEx(FERN, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(FERN); _keep = np.zeros_like(FERN)
for i_ in range(1, n_):
    if st_[i_, cv2.CC_STAT_AREA] > 150: _keep[lab_ == i_] = 1
FERN = cv2.morphologyEx(_keep, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
labF = cv2.cvtColor(np.clip(blur_s[4], 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB)[FERN > 0].astype(np.float32)
_, _, cenF = cv2.kmeans(labF, 6, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.5), 3, cv2.KMEANS_PP_CENTERS)
bgrF = cv2.cvtColor(np.clip(cenF, 0, 255).astype(np.uint8)[None], cv2.COLOR_LAB2BGR)[0].astype(np.float32)
def mixAt(c, r, x, y):                                  # the fern's own palette on the fern, the scene's elsewhere
    if not FERN[int(y), int(x)]: return mixR(c, r)
    l_ = cv2.cvtColor(np.clip(c, 0, 255).astype(np.uint8)[None, None], cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
    return bgrF[int(np.argmin(((cenF - l_) ** 2).sum(1)))] + r.normal(0, 2.5, 3)
def quant(im_):                                       # the photo as it would be with only the palette's colours
    l_ = cv2.cvtColor(np.clip(im_, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).reshape(-1, 1, 3).astype(np.float32)
    j = np.argmin(((l_ - cenR[None]) ** 2).sum(2), 1); out = bgrR[j].reshape(H, W, 3)
    jf = np.argmin(((l_ - cenF[None]) ** 2).sum(2), 1); outF = bgrF[jf].reshape(H, W, 3)
    return np.where(FERN[..., None] > 0, outF, out)
qrefs = {k_: quant(v) for k_, v in refs.items()}
CR = np.zeros((H, W, 3), np.float32); AR = np.zeros((H, W), np.float32); rest = []
LAYERS = [(40, 12, 26, None), (20, 6, 13, 40), (10, 3, 7, 60), (5, 2, 4, 70)]   # width, detail of the photo, spacing, how wrong before repainting
for li, (bw, rs, sp, thr) in enumerate(LAYERS):
    ref = refs[rs]
    if thr is not None:
        err = cv2.blur(np.abs(qrefs[rs] - CR).sum(2) * (AR > 0.3) + 999 * (AR <= 0.3), (sp, sp))   # repaint only where a different mix is needed
    gy_, gx_ = np.mgrid[sp // 2:H:sp, sp // 2:W:sp]
    pts = np.stack([gy_.ravel(), gx_.ravel()], 1) + rr.integers(-sp // 2, sp // 2 + 1, (gy_.size, 2))
    pts[:, 0] = np.clip(pts[:, 0], 0, H - 1); pts[:, 1] = np.clip(pts[:, 1], 0, W - 1)
    pts = pts[Rcore[pts[:, 0], pts[:, 1]] > 0]
    if thr is not None:
        ground = pts[:, 0] > 0.62 * H
        pts = pts[err[pts[:, 0], pts[:, 1]] > thr * np.where(ground, 1.6, 1.0)]      # the ground stays broad and simple
    if li == 3: pts = pts[(coher[pts[:, 0], pts[:, 1]] > 0.3) & (np.hypot(Ix, Iy)[pts[:, 0], pts[:, 1]] > 40)]   # last: only clear edges (fronds, logs)
    rr.shuffle(pts); n0 = len(rest)
    for y, x in pts:
        w = bw * rr.uniform(0.8, 1.2); L = w * rr.uniform(1.4, 2.6)
        if y > 0.62 * H and li < 2: w *= 1.3; L *= 1.6                        # long flat strokes for the ground
        if li == 3: L = w * rr.uniform(3, 5)                                  # thin lines along fronds and logs
        if coher[y, x] > 0.25: ang = theta[y, x] + np.deg2rad(rr.normal(0, 8))
        elif y > 0.6 * H: ang = np.deg2rad(rr.normal(0, 15))               # the ground: flat strokes
        else: ang = rr.uniform(0, np.pi)
        s_ = shaped(x, y, ang, L, w, mixAt(ref[y, x], rr, x, y), rr, big=(li < 2), kind='rest'); s_['li'] = li; rest.append(s_)
        place(s_, 1.0, CR, AR)
    print('rest layer', li, 'strokes', len(rest) - n0)
    if li == 2:
        # the fern's edges: broken strokes. Quick flicks of fern colour out from the edge, and the ground's colour cut back in
        F = FERN
        Fb = cv2.GaussianBlur(F.astype(np.float32), (0, 0), 3); fgx, fgy = cv2.Sobel(Fb, cv2.CV_32F, 1, 0), cv2.Sobel(Fb, cv2.CV_32F, 0, 1)
        cnts, _ = cv2.findContours(F, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        n0 = len(rest)
        for cn in cnts:
            if len(cn) < 30: continue
            for (x, y) in cn[::7, 0]:
                g_ = np.array([fgx[y, x], fgy[y, x]]); nn = np.hypot(*g_)
                if nn < 1e-4: continue
                out = -g_ / nn                                               # pointing out of the fern
                if rr.random() < 0.65:
                    d = rr.uniform(0, 4); cx_, cy_ = x - out[0] * d, y - out[1] * d
                    sx, sy = int(np.clip(x - out[0] * 4, 0, W - 1)), int(np.clip(y - out[1] * 4, 0, H - 1))
                    ang = np.arctan2(out[1], out[0]) + np.deg2rad(rr.normal(0, 20))
                else:
                    d = rr.uniform(2, 6); cx_, cy_ = x + out[0] * d, y + out[1] * d
                    sx, sy = int(np.clip(x + out[0] * 7, 0, W - 1)), int(np.clip(y + out[1] * 7, 0, H - 1))
                    ang = np.arctan2(-out[1], -out[0]) + np.deg2rad(rr.normal(0, 20))
                w = rr.uniform(7, 12); L = rr.uniform(18, 34)
                s_ = shaped(int(cx_), int(cy_), ang, L, w, mixAt(blur_s[2][sy, sx], rr, sx, sy), rr, big=False, kind='rest', scumble=rr.uniform(0.38, 0.5)); s_['li'] = 2.5
                rest.append(s_); place(s_, 1.0, CR, AR)
        print('fern edge strokes', len(rest) - n0)

# last touches: where the sun catches the distant bracken and grass along the horizon, small dry-brushed highlights
# in two colours very close to white: one brown (dead bracken, dry grass), one green
hhsv = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.0), cv2.COLOR_BGR2HSV).astype(np.float32)
hreg = np.zeros((H, W), bool); hreg[450:560, 30:1095] = True
HL = ((hhsv[..., 2] > 205) & (hhsv[..., 1] < 90) & hreg).astype(np.uint8)
# ...and the sunlit field to the right of the big right-hand trunk, all in the green
hreg2 = np.zeros((H, W), bool); hreg2[515:585, 1230:1536] = True
HL2 = ((hhsv[..., 2] > 205) & (hhsv[..., 1] < 150) & hreg2).astype(np.uint8)
HL = np.maximum(HL, HL2)
HL = cv2.morphologyEx(HL, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
hl_brown = np.array([216, 236, 248], np.float32)        # BGR, i.e. a very pale warm brown
hl_green = np.array([214, 248, 236], np.float32)        # BGR, i.e. a very pale green
hue_around = cv2.GaussianBlur(img, (0, 0), 3)
hue_around = cv2.cvtColor(hue_around, cv2.COLOR_BGR2HSV)[..., 0]
hr_ = np.random.default_rng(41); n0 = len(rest)
gy_, gx_ = np.mgrid[2:H:4, 2:W:4]
pts = np.stack([gy_.ravel(), gx_.ravel()], 1) + hr_.integers(-2, 3, (gy_.size, 2))
pts[:, 0] = np.clip(pts[:, 0], 0, H - 1); pts[:, 1] = np.clip(pts[:, 1], 0, W - 1)
pts = pts[HL[pts[:, 0], pts[:, 1]] > 0]; hr_.shuffle(pts)
pts = pts[~(hreg2[pts[:, 0], pts[:, 1]] & (hr_.random(len(pts)) < 0.5))]   # the bigger sunlit field: half as many, so they stay broken
for y, x in pts:
    w = hr_.uniform(3, 5); L = w * hr_.uniform(2.0, 3.5)
    ang = theta[y, x] + np.deg2rad(hr_.normal(0, 12)) if coher[y, x] > 0.25 else hr_.uniform(0, np.pi)
    col = hl_green if (hue_around[y, x] >= 26 or hreg2[y, x]) else hl_brown   # which, from the colour of the bracken around it
    s_ = shaped(int(x), int(y), ang, L, w, col + hr_.normal(0, 2, 3), hr_, big=False, kind='rest', scumble=hr_.uniform(0.35, 0.45)); s_['li'] = 4
    rest.append(s_); place(s_, 1.0, CR, AR)
print('highlight strokes', len(rest) - n0)

def compose(CL, AL, C, A, CT_, AT_, CR_=None, AR_=None):
    out = imgf.copy()
    a = (AL * Z)[..., None]; out = out * (1 - a) + CL * a
    a = np.clip(A * Psoft, 0, 1)[..., None]; out = out * (1 - a) + C * a
    a = (AT_ * TZ)[..., None]; out = out * (1 - a) + CT_ * a
    if CR_ is not None: a = (AR_ * RZ)[..., None]; out = out * (1 - a) + CR_ * a
    return np.clip(out, 0, 255).astype(np.uint8)

z3, z1 = np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)
CL = np.zeros((H, W, 3), np.float32); AL = np.zeros((H, W), np.float32)
for s in layin: place(s, 1.0, CL, AL)
C = np.zeros((H, W, 3), np.float32); A = np.zeros((H, W), np.float32)
for s in sky: place(s, 1.0, C, A)
if os.environ.get('STILL'):
    cv2.imwrite('still6-layin.jpg', compose(CL, AL, z3, z1, z3, z1), [cv2.IMWRITE_JPEG_QUALITY, 90])
    cv2.imwrite('still7.jpg', compose(CL, AL, C, A, CT, AT, CR, AR), [cv2.IMWRITE_JPEG_QUALITY, 90])
    sys.exit()

FPS = 30; LAY, SKY, TRK, REST, HOLD = 1.5, 5.0, 4.5, 8.0, 1.0
# the rest of the scene in the video: big strokes everywhere first, then smaller ones; each pass works across the picture
# in tiles, row by row (left to right, then back), so one brush moves around the picture rather than dabs appearing at random
TILE = 192
def tile_key(s_):
    ty, tx = int(s_['y']) // TILE, int(s_['x']) // TILE
    return (s_['li'], ty, tx if ty % 2 == 0 else -tx, s_['y'], s_['x'])
rest_v = sorted(rest, key=tile_key)
plan = []                                    # (layer, stroke, start, duration)
t0 = 0.0
for layer, lst, span in (('L', layin, LAY), ('S', sky, SKY), ('T', trunk, TRK), ('R', rest_v, REST)):
    # the top strip of sky is under the header, so it is painted quickly
    lens = np.array([s_['L'] * (0.25 if (layer == 'S' and s_['y'] < 0.12 * H) else 1) for s_ in lst]); durs = span * lens / lens.sum() * 0.85            # short strokes may finish within a frame, one after another
    gaps = max(span - durs.sum(), 0) / len(lst); st = t0 + np.concatenate([[0], np.cumsum(durs + gaps)[:-1]])
    plan += [(layer, s_, a_, d_) for s_, a_, d_ in zip(lst, st, durs)]
    t0 += span
acc = {'L': [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)],
       'S': [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)],
       'T': [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)],
       'R': [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)]}
os.makedirs('vf13', exist_ok=True)
nf = int(round((LAY + SKY + TRK + REST + HOLD) * FPS)); done = 0
for f in range(nf):
    t = f / FPS
    while done < len(plan) and plan[done][2] + plan[done][3] <= t:
        ly, s_, _, _ = plan[done]; place(s_, 1.0, *acc[ly]); done += 1
    cur = {k: v for k, v in acc.items()}
    if done < len(plan) and t >= plan[done][2]:
        ly, s_, st_, d_ = plan[done]
        c2, a2 = acc[ly][0].copy(), acc[ly][1].copy(); place(s_, 1 - (1 - (t - st_) / d_) ** 1.6, c2, a2); cur[ly] = [c2, a2]
    cv2.imwrite(f'vf13/{f:04d}.jpg', compose(*cur['L'], *cur['S'], *cur['T'], *cur['R']), [cv2.IMWRITE_JPEG_QUALITY, 92])
print('frames', nf, 'strokes', len(plan))
