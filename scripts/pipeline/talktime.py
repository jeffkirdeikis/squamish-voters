"""Who spoke when, for a council meeting recording (talk time per person).

Two passes over a 16 kHz mono wav, run as separate processes so they use the CPU in parallel:
  python talktime.py diarize <wav> <out.diar.json>     # sherpa-onnx: pyannote segmentation 3.0 + NeMo TitaNet voice prints
  python talktime.py words   <wav> <out.words.json>    # faster-whisper small.en, segment timestamps
  python talktime.py merge   <diar> <words> <out.json> # each transcript line gets the speaker it overlaps most
Speaker ids are anonymous (S0, S1 ...). Names come afterwards from the transcript (the chair calls each member by
name before they speak), in a labels file written for each meeting: {"S12": {"name": "Mayor Easton", "slug": "sean-easton", "role": "chair"}}.
Talk time is counted from the diarization turns, not the transcript lines, so pauses are not counted as speech.

Needs (uv run --python 3.12 --with sherpa-onnx --with soundfile --with faster-whisper):
models in ~/sv-meetings/models/ (sherpa-onnx-pyannote-segmentation-3-0/model.onnx, nemo_en_titanet_large.onnx),
from the k2-fsa/sherpa-onnx GitHub releases. Clustering threshold 0.9 was tuned on the Oct 6 2026 meeting audio:
lower values split one person into several voices in the chamber's room sound.
"""
import json, os, sys

MODELS = os.path.expanduser(os.environ.get("SV_MODELS", "~/sv-meetings/models"))
PROMPT = ("District of Squamish council meeting. Mayor Easton, Councillors Andersen, DesJardins, Ellis, Perreault, "
          "Prosko, Veltkamp. Squamish Nation, Brennan Park, Woodfibre LNG, Official Community Plan, rezoning, bylaw.")


def diarize(wav, out, threshold=0.9):
    import soundfile as sf, sherpa_onnx as so
    cfg = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=f"{MODELS}/sherpa-onnx-pyannote-segmentation-3-0/model.onnx"), num_threads=4),
        embedding=so.SpeakerEmbeddingExtractorConfig(model=f"{MODELS}/nemo_en_titanet_large.onnx", num_threads=4),
        clustering=so.FastClusteringConfig(num_clusters=-1, threshold=threshold),
        min_duration_on=0.3, min_duration_off=0.5)
    sd = so.OfflineSpeakerDiarization(cfg)
    a, sr = sf.read(wav, dtype="float32")
    assert sr == 16000, "needs 16 kHz audio"
    r = sd.process(a).sort_by_start_time()
    segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "spk": f"S{s.speaker}"} for s in r]
    json.dump({"duration": round(len(a) / sr), "segments": segs}, open(out, "w"))
    print(f"diarized {len(segs)} turns", flush=True)


def words(wav, out):
    from faster_whisper import WhisperModel
    model = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=4)
    import soundfile as sf
    audio, sr = sf.read(wav, dtype="float32")  # decode here: some faster-whisper/av version pairs fail to open files
    assert sr == 16000, "needs 16 kHz audio"
    segs, info = model.transcribe(audio, vad_filter=True, beam_size=1, initial_prompt=PROMPT)
    rows = []
    with open(out + ".partial", "w") as f:
        for s in segs:
            rows.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
            f.write(json.dumps(rows[-1]) + "\n"); f.flush()
    json.dump({"duration": round(info.duration), "segments": rows}, open(out, "w"))
    print(f"transcribed {info.duration:.0f}s", flush=True)


def merge(diar, wordsf, out):
    d = json.load(open(diar)); w = json.load(open(wordsf))
    turns = d["segments"]
    j = 0
    for s in w["segments"]:
        while j < len(turns) and turns[j]["end"] < s["start"]:
            j += 1
        ov = {}
        k = j
        while k < len(turns) and turns[k]["start"] < s["end"]:
            o = min(s["end"], turns[k]["end"]) - max(s["start"], turns[k]["start"])
            if o > 0:
                ov[turns[k]["spk"]] = ov.get(turns[k]["spk"], 0) + o
            k += 1
        s["spk"] = max(ov, key=ov.get) if ov else None
    talk = {}
    prev = None
    for t in turns:
        x = talk.setdefault(t["spk"], {"seconds": 0.0, "turns": 0})
        x["seconds"] += t["end"] - t["start"]
        if t["spk"] != prev:
            x["turns"] += 1
        prev = t["spk"]
    for x in talk.values():
        x["seconds"] = round(x["seconds"])
    json.dump({"duration": d["duration"], "turns": turns, "lines": w["segments"], "speakers": dict(sorted(talk.items(), key=lambda kv: -kv[1]["seconds"]))}, open(out, "w"), indent=0)
    print(json.dumps({k: v["seconds"] for k, v in list(talk.items())[:20]}))


if __name__ == "__main__":
    mode = sys.argv[1]
    {"diarize": lambda: diarize(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 0.9),
     "words": lambda: words(sys.argv[2], sys.argv[3]),
     "merge": lambda: merge(sys.argv[2], sys.argv[3], sys.argv[4])}[mode]()
