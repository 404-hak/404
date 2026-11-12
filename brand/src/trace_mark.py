"""404 · трассировка знака из растрового исходника в симметричный вектор.
Запуск: python3 brand/src/trace_mark.py  →  brand/src/mark-data.mjs
Нужно: pip install potracer numpy pillow
"""
import json, os
import numpy as np
from PIL import Image
import potrace

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'mark-source.png')
OUT = os.path.join(HERE, 'mark-data.mjs')
UP = 4            # апскейл перед трассировкой — гладкие края
TARGET_H = 1250   # высота знака в единицах файла

img = np.asarray(Image.open(SRC).convert('L'), dtype=np.float64)
bg = np.percentile(img, 5)
fg = np.percentile(img[img > (img.max() + bg) / 2], 60)
a = np.clip((img - bg) / (fg - bg), 0, 1)
a[a < 0.12] = 0  # шум фона

ys, xs = np.nonzero(a > 0.5)
y0, y1 = ys.min(), ys.max()

# ось симметрии: подбираем x0, при котором знак лучше всего совпадает с отражением
def mirror(arr, x0):
    w = arr.shape[1]
    xm = 2 * x0 - np.arange(w)
    xi = np.floor(xm).astype(int); f = xm - xi
    out = np.zeros_like(arr)
    ok = (xi >= 0) & (xi + 1 < w)
    out[:, ok] = arr[:, xi[ok]] * (1 - f[ok]) + arr[:, xi[ok] + 1] * f[ok]
    return out

cx = (a * np.arange(a.shape[1])).sum() / a.sum()
best = min(np.arange(cx - 6, cx + 6, 0.25), key=lambda x0: np.abs(a - mirror(a, x0)).sum())
sym = (a + mirror(a, best)) / 2
print(f'axis centroid={cx:.2f} best={best:.2f}')

# апскейл и порог
pad = 12
x_l = int(np.floor(2 * best - xs.max())) - pad
x_r = int(np.ceil(xs.max())) + pad
crop = sym[y0 - pad:y1 + pad + 1, max(0, x_l):x_r + 1]
offx, offy = max(0, x_l), y0 - pad
im = Image.fromarray((crop * 255).astype(np.uint8))
im = im.resize((im.width * UP, im.height * UP), Image.LANCZOS)
big = np.asarray(im, dtype=np.float64) / 255
bm = big > 0.5

# potracer трассирует «тёмные» пиксели (значение < 0.5) — подаём инверсию
path = potrace.Bitmap(~bm).trace(turdsize=60, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                                alphamax=1.0, opticurve=True, opttolerance=0.25)

# в координаты исходника → нормализация (верх стебля = 0, ось симметрии = W/2)
def P(p):
    x, y = (p.x if hasattr(p, 'x') else p[0]), (p.y if hasattr(p, 'y') else p[1])
    return (x / UP + offx, y / UP + offy)

curves = []
for c in path:
    pts = [P(c.start_point)]
    segs = [('M', pts[0])]
    for s in c.segments:
        if s.is_corner:
            segs.append(('L', P(s.c))); segs.append(('L', P(s.end_point)))
        else:
            segs.append(('C', P(s.c1), P(s.c2), P(s.end_point)))
    curves.append(segs)

allx = [p[0] for c in curves for s in c for p in s[1:]]
ally = [p[1] for c in curves for s in c for p in s[1:]]
top, bot = min(ally), max(ally)
half = max(abs(x - best) for x in allx)
H = bot - top
k = TARGET_H / H
W = 2 * half * k
tx = lambda p: ((p[0] - best) * k + W / 2, (p[1] - top) * k)

def fmt(v): return f'{v:.2f}'.rstrip('0').rstrip('.')
d = ''
for c in curves:
    for s in c:
        d += s[0] + ' '.join(f'{fmt(tx(p)[0])},{fmt(tx(p)[1])}' for p in s[1:])
    d += 'Z'

# --- размеры для чертежа (по симметричному растру исходника) ---
m = sym > 0.5
rows, cols = np.nonzero(m)
dx = np.abs(cols - best)
hw = dx.max()
def ymin(sel): return rows[sel].min()
def ymax(sel): return rows[sel].max()
horn = ymin(dx > 0.63 * hw)
hornX = dx[(dx > 0.63 * hw) & (rows == horn)].mean()
wing = ymin((dx > 0.40 * hw) & (dx < 0.63 * hw))
wingX = dx[(dx > 0.40 * hw) & (dx < 0.63 * hw) & (rows == wing)].mean()
# окончания штрихов на правой половине: ран в строке y не продолжается в y+1
def runs(row):
    out, x = [], 0
    while x < len(row):
        if row[x]:
            st = x
            while x < len(row) and row[x]: x += 1
            out.append((st, x - 1))
        x += 1
    return out
xa = int(round(best))
ends = []
for y in range(y0, y1):
    r0 = [r for r in runs(m[y, xa + 5:]) if r[1] - r[0] >= 0]
    r1 = runs(m[y + 1, xa + 5:])
    for a_, b_ in r0:
        if not any(c <= b_ + 1 and d_ >= a_ - 1 for c, d_ in r1):
            ends.append((y, (a_ + b_) / 2 + 5))
ends = [e for e in ends if e[0] > wing]
print('ends', ends[:8])
innerBot = ends[0][0]
outerBot = max(e[0] for e in ends)
# точка ветвления: первая строка ниже концов крыльев, где центральный ран шире 12 px
junction = None
for y in range(wing, y1):
    row = m[y]
    l = r = xa
    while l > 0 and row[l - 1]: l -= 1
    while r < len(row) - 1 and row[r + 1]: r += 1
    if row[xa] and (r - l) / 2 > 12:
        junction = y; break
widest = rows[dx == hw].mean()
Hpx = y1 - y0
pct = lambda y: (y - y0) / Hpx * 100
metrics = {
    'ratio': TARGET_H / W,
    'hornTop': pct(horn), 'hornSpanW': hornX * 2 / (2 * hw) * 100,
    'wingTip': pct(wing), 'wingSpanW': wingX * 2 / (2 * hw) * 100,
    'junction': pct(junction),
    'innerBottom': pct(innerBot),
    'outerBottom': pct(outerBot),
}
print(json.dumps({k_: round(v, 2) for k_, v in metrics.items()}, ensure_ascii=False))
print('curves', len(curves), 'W', round(W, 1), 'H', TARGET_H)

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// Сгенерировано brand/src/trace_mark.py из source/mark-source.png — не править руками\n')
    f.write(f'export const MARK_W = {W:.2f};\nexport const MARK_H = {TARGET_H};\n')
    f.write(f'export const MARK_D = {json.dumps(d)};\n')
    f.write(f'export const MARK_METRICS = {json.dumps(metrics)};\n')
