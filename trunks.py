import numpy as np, cv2, json
img = cv2.imread('forest-1536.jpg'); H, W = img.shape[:2]
# rough outlines traced from the photo: left edge top to bottom, then right edge bottom to top
T = {
 'A_big_left': [(255,0),(250,100),(232,200),(210,300),(185,350),(170,400),(155,500),(140,560),(125,620),(110,650),
                (275,650),(270,600),(285,520),(300,470),(305,420),(310,360),(330,300),(340,200),(350,100),(360,0)],
 'A_limb':     [(150,255),(165,248),(218,318),(200,340)],
 'B_birch':    [(62,250),(58,300),(62,400),(72,480),(75,560),(125,560),(115,480),(105,400),(100,300),(95,250)],
 'C_pale':     [(337,250),(337,350),(340,450),(338,540),(385,540),(368,450),(360,350),(355,250)],
 'D_tall':     [(428,30),(418,100),(410,200),(400,300),(394,400),(390,500),(392,555),(420,555),(414,500),(416,400),(422,300),(430,200),(438,100),(440,30)],
 'E_lean':     [(527,200),(500,300),(475,400),(450,480),(420,550),(468,550),(482,480),(505,400),(530,300),(548,205)],
 'F_mid':      [(600,120),(588,200),(568,300),(552,400),(538,500),(530,545),(562,545),(568,500),(585,400),(600,300),(612,200),(618,120)],
 'G_mid':      [(818,150),(825,300),(833,400),(838,520),(868,520),(862,400),(852,300),(842,150)],
 'I_big_right':[(1300,0),(1255,100),(1225,200),(1205,300),(1182,400),(1175,500),(1170,600),(1150,680),
                (1290,680),(1278,600),(1275,500),(1280,400),(1290,300),(1310,200),(1335,100),(1355,0)],
 'J_curve':    [(1395,0),(1400,100),(1405,200),(1418,300),(1430,350),(1470,410),(1536,465),(1536,410),(1495,380),(1460,340),(1445,300),(1428,200),(1420,100),(1418,0)],
}
json.dump(T, open('outlines.json', 'w'))
rough = np.zeros((H, W), np.uint8)
for k, p in T.items(): cv2.fillPoly(rough, [np.array(p, np.int32)], 1)
# refine the edges to the photo: sure inside = the outline shrunk; possible = a band either side; elsewhere = not trunk
gm = np.full((H, W), cv2.GC_BGD, np.uint8)
band = cv2.dilate(rough, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
gm[band > 0] = cv2.GC_PR_BGD
gm[rough > 0] = cv2.GC_PR_FGD
core = cv2.erode(rough, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
gm[core > 0] = cv2.GC_FGD
bg, fg = np.zeros((1, 65)), np.zeros((1, 65))
cv2.grabCut(img, gm, None, bg, fg, 6, cv2.GC_INIT_WITH_MASK)
M = ((gm == cv2.GC_FGD) | (gm == cv2.GC_PR_FGD)).astype(np.uint8)
M = cv2.morphologyEx(M, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
M = cv2.morphologyEx(M, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
cv2.imwrite('trunkmask.png', M * 255)
ov = img.copy(); ov[M > 0] = (ov[M > 0] * 0.4 + np.array([255, 0, 255]) * 0.6).astype(np.uint8)
cnts, _ = cv2.findContours(rough, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); cv2.drawContours(ov, cnts, -1, (0, 255, 255), 1)
cv2.imwrite('maskcheck.jpg', ov)
print('trunk share', M.mean(), 'rough', rough.mean())
