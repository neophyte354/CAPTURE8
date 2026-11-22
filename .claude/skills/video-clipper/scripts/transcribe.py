#!/usr/bin/env python3
"""Transkrip video/audio dengan faster-whisper, lengkap dengan timestamp per kata.

Pakai:
  python3 transcribe.py INPUT.mp4 OUT_DIR [--model small] [--lang id]

Hasil di OUT_DIR:
  transcript.json  -> segmen + kata + timestamp (dipakai make_clip.py untuk subtitle)
  transcript.txt   -> teks bertimestamp [mm:ss] yang mudah dibaca untuk cari momen viral
"""
import argparse
import json
import os


def fmt(t):
    m, s = divmod(int(t), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out_dir")
    ap.add_argument("--model", default="small", help="tiny/base/small/medium/large-v3")
    ap.add_argument("--lang", default=None, help="kode bahasa, mis. id / en (kosong = deteksi otomatis)")
    a = ap.parse_args()

    from faster_whisper import WhisperModel

    os.makedirs(a.out_dir, exist_ok=True)
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        a.input, language=a.lang, word_timestamps=True, vad_filter=True
    )

    data = {"language": info.language, "duration": info.duration, "segments": []}
    lines = []
    for seg in segments:
        words = [
            {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
            for w in (seg.words or [])
        ]
        data["segments"].append(
            {"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip(), "words": words}
        )
        lines.append(f"[{fmt(seg.start)} - {fmt(seg.end)}] {seg.text.strip()}")
        print(lines[-1], flush=True)

    with open(os.path.join(a.out_dir, "transcript.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out_dir, "transcript.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\nSelesai. Bahasa: {info.language}, durasi: {fmt(info.duration)}")


if __name__ == "__main__":
    main()
