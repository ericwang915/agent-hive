#!/usr/bin/env python3
# Turn one generated character (seven stills, a few videos) into a skin: cut out, same canvas for every picture,
# and one copy per bee colour with the character's own colour (hair, body) swapped.
# usage: SKIN_SRC=<folder with one folder per skin> build_skin.py <skin> [face or a-loop names...]
# The source folder holds, per skin, happy.jpg … sleep.jpg (1:1, white background) and run.mp4, idle.mp4, sleep.mp4, error.mp4.
# A skin that is not built in (see scripts/skins/pack_skin.js) is written to SKIN_OUT, outside the app's own skins/ folder.
# Needs Pillow, numpy and ffmpeg.
import sys, os, glob, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFilter
HERE = os.environ.get('SKIN_SRC') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src'); OUT = os.environ.get('SKIN_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'skins')
COLORS = ['#F2A97E', '#9CC9F0', '#A9D8B8', '#B8A4E8', '#F5B8CF', '#FFD27A', '#E8C48F', '#D9C2A3']
MOODS = ['happy', 'grin', 'love', 'wow', 'flat', 'sad', 'sleep']; LOOPS = ['run', 'idle', 'sleep', 'error']
# band: the hue range (degrees) of the part that takes the bee's colour, and the least saturation / brightness it has
CFG = {
  'maid': dict(src='maid', stills={m: m + '.jpg' for m in MOODS},
               band=(300, 356), vband=(300, 363), vsmax=.43, smin=.10, vmin=.45, keep={'love': (.33, .44, .67, .54)}),
  'bee': dict(src='bee', stills={m: m + '.jpg' for m in MOODS}, band=(28, 62), vband=(28, 62), smin=.30, vmin=.62, keep={}),
}
# Any other skin is drawn like the maid: the part that takes the bee's colour is pink in the source pictures
class Cfg(dict):
    def __missing__(self, k): return {**CFG['maid'], 'src': k, 'stills': {m: m + '.jpg' for m in MOODS}, 'keep': {}, 'smax': .52, **MORE.get(k, {})}
# smax: anything pinker than the character's own colour (heart eyes, an open mouth) is left as drawn
MORE = {
  'cat': dict(band=(300, 366), vband=(300, 366), smin=.08),      # pale pink fur that runs toward red
  'shiba': dict(band=(340, 369), vband=(340, 369), smin=.25),    # a salmon hoodie; the fur and blush sit just past it
  'pixel': dict(band=(315, 348), vband=(315, 348), smax=1),      # hot pink, with the heart eyes a redder hue
}
CFG = Cfg(CFG)
SIDE, PAD, FOOT, FPS = 200, 1.25, .06, 8

def hsv(rgb):
    r, g, b = [rgb[..., i] / 255. for i in range(3)]; mx = np.max(rgb, -1) / 255.; mn = np.min(rgb, -1) / 255.; d = mx - mn
    h = np.zeros_like(mx); m = d > 1e-6
    i = m & (mx == r); h[i] = ((g - b)[i] / d[i]) % 6
    i = m & (mx == g) & (mx != r); h[i] = (b - r)[i] / d[i] + 2
    i = m & (mx == b) & (mx != r) & (mx != g); h[i] = (r - g)[i] / d[i] + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx
def rgb(h, s, v):
    h = (h % 360) / 60; i = np.floor(h).astype(int) % 6; f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    out = np.zeros(h.shape + (3,))
    for k, (a, b, c) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k; out[m] = np.stack([a[m], b[m], c[m]], -1)
    return (out * 255 + .5).clip(0, 255).astype('uint8')
def cut(im, grey):
    a = im.convert('RGB'); n = np.asarray(a).astype(int); mx, mn = n.max(2), n.min(2)
    if grey:                                                    # a video's backdrop: neutral, and about as bright as the frame's corners
        c = np.median([mx[2, 2], mx[2, -3], mx[-3, 2], mx[-3, -3]]); bg = ((mx - mn) < 16) & (np.abs(mx - c) < 30) & (mx < 247)
    else: bg = ((mx - mn) < 14) & (mx > 238)                    # a still's backdrop is white; only what touches the frame's edge counts
    b = Image.fromarray((bg * 255).astype('uint8')).copy(); W, H = b.size
    for xy in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (W // 2, H - 1), (0, H // 2), (W - 1, H // 2)]:
        if b.getpixel(xy) == 255: ImageDraw.floodfill(b, xy, 128)
    al = Image.fromarray(((np.asarray(b) != 128) * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(.7))
    if grey:                                                    # specks of backdrop left behind: keep the one piece that holds the frame's centre
        solid = al.point(lambda v: 255 if v > 128 else 0).copy(); W, H = solid.size
        for xy in [(W // 2, H // 2), (W // 2, H // 2 - 40), (W // 2, H // 2 + 40)]:
            if solid.getpixel(xy) == 255: ImageDraw.floodfill(solid, xy, 200); break
        keep = solid.point(lambda v: 255 if v == 200 else 0).filter(ImageFilter.MaxFilter(5))
        if keep.getbbox(): al = Image.composite(al, Image.new('L', al.size, 0), keep)
    a = a.convert('RGBA'); a.putalpha(al); return a
def place(im, box):                                             # the character's box → the padded square canvas
    x0, y0, x1, y1 = box; S = max(x1 - x0, y1 - y0); C = int(S * PAD); cx = (x0 + x1) // 2; top = y1 + int(S * FOOT) - C
    c = Image.new('RGBA', (C, C), (0, 0, 0, 0)); c.paste(im, (C // 2 - cx, -top)); return c.resize((SIDE, SIDE), Image.LANCZOS)
def place_like(im, box, still):                              # a video frame, at the still's scale: same width, same top edge
    w0, h0 = still; S0 = max(w0, h0); x0, y0, x1, y1 = box; S = (x1 - x0) * S0 / w0; C = int(S * PAD); cx = (x0 + x1) // 2
    top = int(C - S * FOOT - h0 * S / S0)
    c = Image.new('RGBA', (C, C), (0, 0, 0, 0)); c.paste(im, (C // 2 - cx, top - y0)); return c.resize((SIDE, SIDE), Image.LANCZOS)
def tint(im, cfg, target, ref, keep=None, band='band'):
    n = np.asarray(im).copy(); h, s, v = hsv(n[..., :3].astype(float)); lo, hi = cfg[band]
    m = (((h - lo) % 360) <= hi - lo) & (s <= (cfg.get('vsmax', 1) if band == 'vband' else cfg.get('smax', 1))) & (s >= cfg['smin']) & (v >= cfg['vmin'])
    if keep: H, W = m.shape; x0, y0, x1, y1 = keep; m[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = False
    th, ts, tv = [x[0, 0] for x in hsv(np.array([[[int(target[i:i + 2], 16) for i in (1, 3, 5)]]], float))]
    rs, rv = ref
    s2 = np.clip(s * ts / rs, 0, 1); v2 = np.clip(v * min(1.12, tv / rv), 0, 1)
    out = rgb(np.full_like(h, th), s2, v2); n[..., :3][m] = out[m]; return Image.fromarray(n)
def ref_of(im, cfg):
    n = np.asarray(im); h, s, v = hsv(n[..., :3].astype(float)); lo, hi = cfg['band']
    m = (((h - lo) % 360) <= hi - lo) & (s >= cfg['smin']) & (v >= cfg['vmin']) & (n[..., 3] > 200)
    return float(np.median(s[m])), float(np.percentile(v[m], 80))
def save_all(skin, name, frames, cfg, ref, keep=None, band='band'):
    for i, c in enumerate(COLORS):
        d = f'{OUT}/{skin}/{i}'; os.makedirs(d, exist_ok=True); fr = [tint(f, cfg, c, ref, keep, band) for f in frames]
        if len(fr) == 1: fr[0].save(f'{d}/{name}.webp', quality=86, method=6)
        else: fr[0].save(f'{d}/{name}.webp', save_all=True, append_images=fr[1:], duration=int(1000 / FPS), loop=0, quality=64, method=4)
    return os.path.getsize(f'{OUT}/{skin}/0/{name}.webp')

def main():
    skin = sys.argv[1]; cfg = CFG[skin]; only = sys.argv[2:]; src = f'{HERE}/{cfg["src"]}'
    base = cut(Image.open(f'{src}/{cfg["stills"]["happy"]}').resize((1024, 1024), Image.LANCZOS), False); ref = ref_of(base, cfg); bb = base.getchannel('A').getbbox(); still = (bb[2] - bb[0], bb[3] - bb[1]); print('reference s, v', ref)
    for m in MOODS:
        if only and m not in only: continue
        f = f'{src}/{cfg["stills"][m]}'
        if not os.path.exists(f): print('missing still', m); continue
        a = cut(Image.open(f).resize((1024, 1024), Image.LANCZOS), False); k = cfg['keep'].get(m)
        placed = place(a, a.getchannel('A').getbbox())
        if k:
            x0, y0, x1, y1 = a.getchannel('A').getbbox(); S = max(x1 - x0, y1 - y0); C = int(S * PAD); cx = (x0 + x1) // 2; top = y1 + int(S * FOOT) - C
            f2 = lambda x, y: ((x * 1024 + C // 2 - cx) / C, (y * 1024 - top) / C)
            (kx0, ky0), (kx1, ky1) = f2(k[0], k[1]), f2(k[2], k[3]); k = (kx0, ky0, kx1, ky1)
        print(m, save_all(skin, m, [placed], cfg, ref, k))
    for l in LOOPS:
        if only and 'a-' + l not in only: continue
        f = f'{src}/{l}.mp4'
        if not os.path.exists(f): print('no video', l); continue
        tmp = f'{src}/_{l}'; os.makedirs(tmp, exist_ok=True)
        if not glob.glob(tmp + '/*.png'): subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', f'fps={FPS},scale=960:-1', tmp + '/f%03d.png'], check=True)
        fr = [cut(Image.open(x), True) for x in sorted(glob.glob(tmp + '/*.png'))]
        bx = np.array([x.getchannel('A').getbbox() for x in fr]); mid = [int(np.median(bx[:, i])) for i in range(4)]
        sq = [place_like(x, mid, still) for x in fr]
        g = [np.asarray(x.convert('L').resize((48, 48))).astype(int) for x in sq]
        # the loop: a stretch of 2.5 to 5.5 s whose last frame looks most like its first
        best = min((np.abs(g[j] - g[i]).mean() - (j - i) * .01, i, j) for i in range(0, len(g) - 20, 2) for j in range(i + 20, min(len(g), i + 45)))
        _, i, j = best; first = sq[i]; loop = sq[i:j]; n = 3
        for k in range(n):                                       # ease the seam: the last frames lean toward the first
            t = (k + 1) / (n + 1); loop[-n + k] = Image.blend(loop[-n + k], first, t * .7)
        loop = [x.resize((160, 160), Image.LANCZOS) for x in loop]
        print(l, 'frames', i, j, 'seam', round(float(best[0]), 2), save_all(skin, 'a-' + l, loop, cfg, ref, None, 'vband'))
main()
