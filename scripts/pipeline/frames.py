"""Stills from the District's meeting video for the story: slides shown on screen, and the speaker at each quote/moment.

Usage: uv run --with pillow --with numpy --with imageio-ffmpeg python frames.py <video.mp4> <meeting.json> <out_dir>
Writes:
  out/slides/slide-<hh-mm-ss>.jpg   one per distinct slide (bright, low colour, text heavy main area; near duplicates dropped)
  out/slides/contact.jpg            all slide picks on one sheet, labelled with their time, for choosing by eye
  out/people/<hh-mm-ss>-<who>.jpg   the frame 1.5 s into each quote and "moment" in m.night (the speaker's camera tile
                                    carries their name on the District's stream; crop by eye before publishing)
The video is the District of Squamish's public YouTube recording; credit it as such under every still.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()


def grab(video, t, w=None):
    vf = ["-vf", f"scale={w}:-2"] if w else []
    r = subprocess.run([FF, "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", *vf, "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    if not r.stdout:
        return None
    import io
    return Image.open(io.BytesIO(r.stdout)).convert("RGB")


def duration(video):
    r = subprocess.run([FF, "-i", video], capture_output=True, text=True)
    import re
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def dhash(im, n=12):
    g = np.asarray(im.convert("L").resize((n + 1, n)), dtype=np.int16)
    return (g[:, 1:] > g[:, :-1]).flatten()


def slide_score(im):
    a = np.asarray(im.resize((160, 90)), dtype=np.float32) / 255
    main = a[5:85, 2:130]  # the stream's big panel; speaker tiles sit on the right
    bright = (main.mean(axis=2) > 0.82).mean()
    sat = (main.max(axis=2) - main.min(axis=2)).mean()
    g = main.mean(axis=2)
    edges = (np.abs(np.diff(g, axis=1)) > 0.25).mean()
    return bright, sat, edges


def crop_slide(im):
    """Cut the shared screen out of the stream layout: the widest run of non-black columns (the slide panel, left of the
    black gap before the speaker tiles), then the non-black rows inside it."""
    a = np.asarray(im, dtype=np.float32).mean(axis=2) / 255
    H, W = a.shape
    lit = (a > 0.12).mean(axis=0) > 0.35
    best, cur, start = (0, 0), 0, 0
    for x, v in enumerate(list(lit) + [False]):
        if v and cur == 0: start = x
        cur = cur + 1 if v else 0
        if not v and x - start > best[1] - best[0] and x > start: best = (start, x)
    x0, x1 = best
    if x1 - x0 < W * 0.4:
        return im
    rows = np.where((a[:, x0:x1] > 0.12).mean(axis=1) > 0.6)[0]
    if len(rows) < H * 0.3:
        return im
    return im.crop((x0, rows[0], x1, rows[-1] + 1))


def hms(t):
    t = int(t)
    return f"{t // 3600:02d}-{t % 3600 // 60:02d}-{t % 60:02d}"


def main(video, meeting, out):
    m = json.load(open(meeting))
    os.makedirs(f"{out}/slides", exist_ok=True); os.makedirs(f"{out}/people", exist_ok=True)
    dur = duration(video)
    picks, hashes = [], []
    tmp = f"{out}/.scan"; os.makedirs(tmp, exist_ok=True)
    # one pass: a small frame every 4 seconds (frame k is at 4k + 2 s)
    subprocess.run([FF, "-loglevel", "error", "-i", video, "-vf", "fps=1/4,scale=320:-2", "-q:v", "4", f"{tmp}/f%05d.jpg"], check=True)
    for k, f in enumerate(sorted(os.listdir(tmp))):
        t = 4 * k + 2
        im = Image.open(f"{tmp}/{f}").convert("RGB")
        b, s, e = slide_score(im)
        if b > 0.33 and s < 0.15 and e > 0.015:
            h = dhash(im)
            if all((h != x).sum() > 18 for x in hashes[-40:]):
                hashes.append(h)
                full = grab(video, t + 1.0)
                if full:
                    full = crop_slide(full)
                    p = f"{out}/slides/slide-{hms(t)}.jpg"; full.save(p, quality=92); picks.append((t, p))
    if picks:
        th = [Image.open(p).resize((480, 270)) for _, p in picks]
        cols = 4; rows = (len(th) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * 480, rows * 300), "white"); d = ImageDraw.Draw(sheet)
        for i, (im, (tt, _)) in enumerate(zip(th, picks)):
            x, y = i % cols * 480, i // cols * 300
            sheet.paste(im, (x, y)); d.text((x + 6, y + 274), hms(tt).replace("-", ":"), fill="black")
        sheet.save(f"{out}/slides/contact.jpg", quality=85)
    n = m.get("night") or {}
    who = {v["voice"]: v["name"] for v in n.get("voices", [])}
    marks = [(q["t_s"], q.get("name") or "quote") for q in n.get("quotes", []) if q.get("t_s") is not None]
    marks += [(x["t_s"], x["label"][:40]) for x in n.get("moments", [])]
    for tt, label in marks:
        im = grab(video, tt + 1.5)
        if im:
            safe = "".join(c if c.isalnum() else "-" for c in label).strip("-")[:40]
            im.save(f"{out}/people/{hms(tt)}-{safe}.jpg", quality=90)
    print(f"{len(picks)} slides, {len(marks)} people frames")


if __name__ == "__main__":
    main(*sys.argv[1:4])
