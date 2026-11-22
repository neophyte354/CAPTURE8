#!/usr/bin/env python3
"""Buat satu klip pendek siap upload (TikTok / Reels / Shorts).

Langkah: potong START-END -> ubah ke vertikal 9:16 -> bakar subtitle gaya
"kata menyala" (karaoke) dari transcript.json -> opsional judul/hook di atas.

Pakai:
  python3 make_clip.py INPUT.mp4 --start 01:23 --end 02:05 -o clips/klip1.mp4 \
      [--transcript work/transcript.json] [--layout blur|crop|fit] \
      [--hook "Teks hook di atas"] [--words-per-line 3] [--color FFFF00]

Waktu boleh ditulis detik (83.5), mm:ss (01:23) atau hh:mm:ss (00:01:23).
"""
import argparse
import json
import os
import subprocess
import tempfile

W, H = 1080, 1920


def parse_time(s):
    parts = [float(p) for p in str(s).split(":")]
    t = 0.0
    for p in parts:
        t = t * 60 + p
    return t


def ass_time(t):
    t = max(t, 0)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def ass_escape(text):
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(words, start, end, out_path, per_line, color, hook, font):
    # color dalam RRGGBB -> ASS pakai &HBBGGRR&
    rr, gg, bb = color[0:2], color[2:4], color[4:6]
    hl = f"&H00{bb}{gg}{rr}&"
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,60,60,560,1
Style: Hook,{font},72,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0000000,1,0,0,0,100,100,0,0,3,18,0,8,70,70,170,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    if hook:
        ev.append(f"Dialogue: 1,{ass_time(0)},{ass_time(end - start)},Hook,,0,0,0,,{ass_escape(hook)}")

    ws = [w for w in words if w["end"] > start and w["start"] < end and w["word"]]
    for i in range(0, len(ws), per_line):
        group = ws[i : i + per_line]
        g_end = ws[i + per_line]["start"] if i + per_line < len(ws) else group[-1]["end"]
        for j, w in enumerate(group):
            ws_t = w["start"] - start
            we_t = (group[j + 1]["start"] if j + 1 < len(group) else g_end) - start
            if we_t <= ws_t:
                we_t = ws_t + 0.05
            parts = []
            for k, x in enumerate(group):
                txt = ass_escape(x["word"]).upper()
                parts.append(f"{{\\c{hl}\\fscx110\\fscy110}}{txt}{{\\r}}" if k == j else txt)
            ev.append(f"Dialogue: 0,{ass_time(ws_t)},{ass_time(we_t)},Cap,,0,0,0,,{' '.join(parts)}")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(header + "\n".join(ev) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--transcript", help="transcript.json dari transcribe.py (untuk subtitle)")
    ap.add_argument("--layout", default="blur", choices=["blur", "crop", "fit"],
                    help="blur=video utuh + latar blur, crop=potong tengah penuh layar, fit=latar hitam")
    ap.add_argument("--crop-x", type=float, default=0.5,
                    help="posisi horizontal crop 0=kiri 0.5=tengah 1=kanan (layout crop)")
    ap.add_argument("--hook", default="", help="teks judul/hook di bagian atas")
    ap.add_argument("--words-per-line", type=int, default=3)
    ap.add_argument("--color", default="FFE600", help="warna kata yang menyala, RRGGBB")
    ap.add_argument("--font", default="DejaVu Sans")
    a = ap.parse_args()

    start, end = parse_time(a.start), parse_time(a.end)
    assert end > start, "--end harus lebih besar dari --start"
    os.makedirs(os.path.dirname(os.path.abspath(a.output)), exist_ok=True)

    if a.layout == "blur":
        vf = (f"[0:v]split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,"
              f"crop={W}:{H},boxblur=25:5,eq=brightness=-0.08[bg];"
              f"[b]scale={W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2")
    elif a.layout == "crop":
        vf = (f"[0:v]scale=-2:{H},crop={W}:{H}:(iw-{W})*{a.crop_x}:0")
    else:
        vf = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
              f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black")
    vf += ",setsar=1"

    tmp = tempfile.mkdtemp()
    if a.transcript or a.hook:
        words = []
        if a.transcript:
            with open(a.transcript, encoding="utf-8") as f:
                data = json.load(f)
            words = [w for s in data["segments"] for w in s.get("words", [])]
        ass = os.path.join(tmp, "subs.ass")
        build_ass(words, start, end, ass, a.words_per_line, a.color.lstrip("#"), a.hook, a.font)
        vf += f",ass={ass}"
    vf += "[v]"

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-stats",
           "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", a.input,
           "-filter_complex", vf, "-map", "[v]", "-map", "0:a?",
           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
           "-r", "30", "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
           "-movflags", "+faststart", a.output]
    subprocess.run(cmd, check=True)
    print(f"Klip jadi: {a.output} ({end - start:.1f} detik)")


if __name__ == "__main__":
    main()
