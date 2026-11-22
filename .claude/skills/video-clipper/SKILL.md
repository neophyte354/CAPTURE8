---
name: video-clipper
description: Gunakan saat user ingin membuat klip pendek (TikTok, Instagram Reels, YouTube Shorts) dari video panjang seperti podcast, livestream, wawancara, ceramah, atau vlog — termasuk "potong video", "bikin klip", "cari momen viral", "jadikan vertikal", "tambah subtitle", "clipper", "highlight", atau saat user memberi file/link video untuk dijadikan konten pendek.
---

# Video Clipper

Mengubah satu video panjang menjadi beberapa klip vertikal 9:16 yang siap upload,
dengan subtitle "kata menyala" dan teks hook. User adalah pemula: jelaskan
dengan bahasa sederhana, jangan pakai istilah teknis tanpa penjelasan.

## Alat

- `ffmpeg` (sudah terpasang) untuk potong, ubah ukuran, dan bakar subtitle.
- `pip install yt-dlp faster-whisper` bila belum ada.
- `scripts/transcribe.py` — ubah suara jadi teks bertimestamp per kata.
- `scripts/make_clip.py` — buat satu klip jadi (potong + 9:16 + subtitle + hook).

## Alur kerja

1. **Ambil video sumber**
   - File di repo / diunggah user: pakai langsung.
   - Link: `yt-dlp -f "bv*[height<=1080]+ba/b" --merge-output-format mp4 -o work/source.mp4 "URL"`
   - Ingatkan user: hanya clip video yang boleh dipakai (milik sendiri, izin
     kreator, atau program clipper resmi). Cantumkan kredit sumber.
   - Taruh semua bahan kerja di `work/` (sudah di-.gitignore, jangan commit video).

2. **Transkrip**
   `python3 .claude/skills/video-clipper/scripts/transcribe.py work/source.mp4 work --lang id`
   Model `small` cukup untuk bahasa Indonesia; `medium` lebih akurat tapi lambat.

3. **Cari momen terbaik** — baca `work/transcript.txt`, pilih 3–5 kandidat. Kriteria:
   - **Hook di 3 detik pertama**: pernyataan mengejutkan, pertanyaan, angka, konflik, lucu.
   - **Utuh sendiri**: bisa dipahami tanpa menonton video aslinya.
   - **Ada payoff**: punchline, jawaban, kesimpulan, atau emosi puncak.
   - Durasi 20–60 detik (ideal 30–45). Mulai tepat di kalimat hook, buang basa-basi.
   - Akhiri setelah kalimat selesai, jangan terpotong di tengah kata.
   Sajikan ke user sebagai tabel: No, Waktu, Durasi, Hook (teks atas), Alasan menarik.
   Minta user memilih sebelum render.

4. **Render klip**
   ```
   python3 .claude/skills/video-clipper/scripts/make_clip.py work/source.mp4 \
     --start 12:04 --end 12:41 --transcript work/transcript.json \
     --hook "Teks hook singkat" --layout blur -o output/klip-01.mp4
   ```
   Pilihan layout:
   - `blur` (default) — video utuh di tengah, latar blur. Aman untuk semua video.
   - `crop` — penuh layar, potong sisi kiri-kanan. Bagus bila pembicara di tengah;
     geser dengan `--crop-x` (0 kiri, 0.5 tengah, 1 kanan).
   - `fit` — video utuh, latar hitam.
   Opsi lain: `--words-per-line`, `--color RRGGBB` (warna kata menyala), `--font`.

5. **Cek hasil** — ambil 2–3 frame (`ffmpeg -ss 2 -i klip.mp4 -frames:v 1 cek.png`),
   lihat gambarnya: subtitle terbaca, wajah tidak terpotong, hook tidak menutupi wajah.
   Periksa ejaan subtitle; bila Whisper salah dengar, perbaiki kata di
   `transcript.json` lalu render ulang.

6. **Serahkan** — kirim file klip ke user (SendUserFile) beserta saran caption,
   3–5 hashtag, dan judul untuk tiap platform. Hook teks maksimal ±8 kata.

## Catatan

- Jaringan cloud: model Whisper diunduh dari `huggingface.co` dan diarahkan ke
  `us.aws.cdn.hf.co` (keduanya sudah diizinkan di environment CAPTURE8).
  YouTube butuh akses ke banyak alamat `*.googlevideo.com` yang tidak bisa
  di-allowlist satu per satu, dan YouTube sering memblokir server cloud. Jika
  link gagal, minta user mengunggah file videonya.

- Audio otomatis dinormalkan ke -14 LUFS (standar volume TikTok/Reels/Shorts).
- Output: MP4 H.264 1080x1920 30fps — diterima semua platform.
- Jangan commit file video ke git; hanya script dan catatan.
