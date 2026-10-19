"""Transcribe meeting audio with faster-whisper on CPU. Writes one line per segment: [hh:mm:ss] text
Usage: python3 transcribe.py <audio> <out.txt>
"""
import sys
from faster_whisper import WhisperModel

audio, out = sys.argv[1], sys.argv[2]
# small.en keeps a 4-hour meeting under about an hour on a GitHub runner; names of local places still need the prompt.
model = WhisperModel("small.en", device="cpu", compute_type="int8")
segments, info = model.transcribe(
    audio,
    vad_filter=True,
    beam_size=1,
    initial_prompt="District of Squamish council meeting. Mayor Easton, Councillors Andersen, DesJardins, Ellis, Perreault, Prosko, Veltkamp. Squamish Nation, Brennan Park, Woodfibre LNG, Official Community Plan, rezoning, bylaw.",
)
with open(out, "w") as f:
    for s in segments:
        t = int(s.start)
        f.write(f"[{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}] {s.text.strip()}\n")
        f.flush()
print(f"transcribed {info.duration:.0f}s of audio")
