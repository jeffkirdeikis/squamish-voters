# Rasterises public/favicon.svg (drawn by hand here; PIL can't read SVG) into the
# PNG/ICO sizes Google and phones look for. Re-run if the SVG changes.
from PIL import Image, ImageDraw
S = 40 * 32  # draw big, then downsample
def draw(pad=0):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    k = S / 40
    if pad: d.rectangle([0, 0, S, S], fill='#ffb703')  # full-bleed for apple-touch
    else: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=9 * k, fill='#ffb703')
    d.polygon([(5*k, 30*k), (15*k, 12*k), (21*k, 22*k), (26*k, 15*k), (35*k, 30*k)], fill='#0f4c3a')
    pts = [(12.5*k, 25*k), (16*k, 28.5*k), (24*k, 19.5*k)]
    w = int(3 * k); d.line(pts, fill='white', width=w, joint='curve')
    for x, y in (pts[0], pts[-1]): d.ellipse([x - w/2, y - w/2, x + w/2, y + w/2], fill='white')
    return im
base, flat = draw(), draw(pad=1)
for n in (48, 96, 192, 512): base.resize((n, n), Image.LANCZOS).save(f'public/icon-{n}.png')
flat.resize((180, 180), Image.LANCZOS).convert('RGB').save('public/apple-touch-icon.png')
base.resize((48, 48), Image.LANCZOS).save('public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
