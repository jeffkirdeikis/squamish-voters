"""Short captioned clips of council moments, for the story and for Facebook / Instagram (4:5, 1080 x 1350).

The District's video sits in the middle on Squamish Voters green, a headline above it, captions from our transcript
below it (each line shown while it is spoken), the speaker's name and squamishvoters.com at the bottom.
Clips are saved for Jeff to look at; nothing is posted from here.

Usage: uv run --with pillow --with imageio-ffmpeg python clips.py <video_id> <talktime.json> <clips.json> <out_dir>
clips.json: [{"slug": "steep-slopes", "start": 4352, "end": 4400, "title": "Steep slope rules: the vote", "speaker": "Councillor Ellis"}]
Needs yt-dlp (run through uvx).
"""
import json, os, subprocess, sys, textwrap
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H = 1080, 1350
GREEN, YELLOW, WHITE = (15, 76, 58), (245, 184, 0), (255, 255, 255)
FONTS = os.path.join(os.path.dirname(__file__), "..", "..", "api", "_fonts")


def font(size, kind="sans"):
    f = {"serif": "Gelasio-Bold.ttf", "heavy": "Inter-ExtraBold.ttf", "sans": "Inter-SemiBold.ttf"}[kind]
    return ImageFont.truetype(os.path.join(FONTS, f), size)


def frame(title, speaker):
    im = Image.new("RGB", (W, H), GREEN)
    d = ImageDraw.Draw(im)
    d.text((60, 70), "SQUAMISH COUNCIL", font=font(30, "heavy"), fill=YELLOW)
    y = 120
    for line in textwrap.wrap(title, 26):
        d.text((60, y), line, font=font(64, "serif"), fill=WHITE); y += 76
    d.text((60, H - 90), speaker or "", font=font(32), fill=(220, 235, 228))
    d.text((W - 60, H - 90), "squamishvoters.com", font=font(32, "heavy"), fill=WHITE, anchor="ra")
    return im


def caption(text):
    im = Image.new("RGBA", (W, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lines = textwrap.wrap(text, 34)[:3]
    y = 10
    for ln in lines:
        d.text((W // 2, y), ln, font=font(48, "heavy"), fill=WHITE, anchor="ma", stroke_width=3, stroke_fill=(10, 40, 30)); y += 62
    return im


def main(vid, ttf, clipsf, out):
    os.makedirs(out, exist_ok=True)
    tt = json.load(open(ttf)); lines = tt["lines"]
    for c in json.load(open(clipsf)):
        s, e = c["start"], c["end"]
        work = os.path.join(out, f".work-{c['slug']}"); os.makedirs(work, exist_ok=True)
        raw = os.path.join(work, "raw.mp4")
        if not os.path.exists(raw):
            subprocess.run(["uvx", "-q", "yt-dlp", "--no-warnings", "--ffmpeg-location", FF, "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                            "--download-sections", f"*{s}-{e}", "--force-keyframes-at-cuts", "-o", raw, f"https://www.youtube.com/watch?v={vid}"], check=True)
        bg = os.path.join(work, "bg.png"); frame(c["title"], c.get("speaker")).save(bg)
        caps = []
        for l in lines:
            if not (l["end"] > s and l["start"] < e and l.get("text")):
                continue
            rows = textwrap.wrap(l["text"], 34)
            chunks = [" ".join(rows[i:i + 2]) for i in range(0, len(rows), 2)]
            n = sum(len(c) for c in chunks) or 1
            t = l["start"]
            for ch in chunks:  # long sentences show two lines at a time, timed by their share of the words
                d = (l["end"] - l["start"]) * len(ch) / n
                caps.append({"start": t, "end": t + d, "text": ch}); t += d
        inputs, filt, last = ["-i", raw, "-loop", "1", "-i", bg], [], "base"
        # video 1080 wide, placed under the headline; captions under the video
        filt.append(f"[1:v]scale={W}:{H},format=yuv420p[bgv]")
        filt.append(f"[0:v]scale={W}:-2[v0]")
        filt.append(f"[bgv][v0]overlay=0:380:shortest=1[base]")
        for i, l in enumerate(caps):
            p = os.path.join(work, f"cap{i}.png"); caption(l["text"]).save(p)
            inputs += ["-i", p]
            a, b = max(0, l["start"] - s), min(e - s, l["end"] - s)
            filt.append(f"[{last}][{i + 2}:v]overlay=0:{380 + 608 + 24}:enable='between(t,{a:.2f},{b:.2f})'[c{i}]"); last = f"c{i}"
        dst = os.path.join(out, f"{c['slug']}.mp4")
        subprocess.run([FF, "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filt), "-map", f"[{last}]", "-map", "0:a?", "-t", str(e - s),
                        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", dst], check=True)
        print("clip", dst, flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:5])
