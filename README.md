# CAPTURE8 — Aplikasi Photobooth untuk iPad

Aplikasi photobooth yang berjalan di **Safari iPad** dan bisa dipasang di Layar Utama
seperti aplikasi biasa. Tidak perlu App Store, Mac, atau coding.

## Fitur

| Fitur | Keterangan |
|---|---|
| 📷 Kamera DSLR / mirrorless | Lewat HDMI capture card USB (atau kamera dengan mode USB webcam), pilih di Pengaturan → Kamera |
| ✨ Live Photo | Video pendek bolak-balik (boomerang) dengan frame, disimpan sebagai MP4 |
| 👋 Welcome screen | Judul, sub-judul, logo, background foto/video sendiri, atau kamera live ter-blur |
| 🖼️ Upload template | PNG dari Canva dengan lubang transparan → posisi foto dideteksi otomatis |
| 🎞️ Frame bawaan | Strip klasik 2×6 (2 strip dalam 4R), Grid 2×2, Polaroid, frame Live Photo |
| ⏱️ Hitung mundur | 3/5/10 detik, angka besar, bunyi beep, flash layar putih |
| 🎨 Filter | Normal, Hitam Putih, Vintage, Hangat, Sejuk, Pop |
| 🖨️ Cetak | AirPrint, ukuran kertas otomatis (4×6 / 2×6), batas cetak per sesi |
| 📲 AirDrop / Bagikan | Tamu langsung terima foto/video lewat AirDrop |
| 🗂️ Galeri | Semua hasil tersimpan di iPad, bisa dibagikan sekaligus setelah acara |
| 🔒 Mode kiosk | Pengaturan dikunci PIN, kembali otomatis ke welcome, layar tidak mati, bisa offline |
| 👀 Preview presisi | Tamu melihat crop yang persis sama dengan hasil foto |

## Cara memasang (sekali saja)

1. Di GitHub buka repo ini → **Settings** → **Pages**.
2. Di **Build and deployment** → Source: **Deploy from a branch**.
3. Pilih branch **`claude/photobooth-ipad-app-6shl8b`** (atau `main` setelah di-merge), folder **`/ (root)`**, lalu **Save**.
4. Tunggu 1–2 menit. Aplikasi tersedia di: **https://neophyte354.github.io/CAPTURE8/**
5. Di iPad, buka link itu di **Safari** → tombol **Bagikan** → **Tambah ke Layar Utama**.
6. Buka dari ikon **CAPTURE8**, izinkan kamera.

## Cara pakai

- **Pengaturan:** tekan & tahan **pojok kiri atas** 2 detik → PIN **1234** (segera ganti di tab Fitur).
- **Kunci iPad untuk tamu:** Pengaturan iPad → Aksesibilitas → **Akses Terpandu** → nyalakan.
  Lalu di aplikasi tekan tombol samping/Home 3x → Mulai.

### Membuat template di Canva
1. Ukuran **1200×1800 px** (cetak 4R) atau **600×1800 px** (strip).
2. Kosongkan (transparan) area tempat foto.
3. Download **PNG** + centang **Latar belakang transparan**.
4. Upload di Pengaturan → Template. Jumlah foto bisa diatur.
   Desain 2 strip kembar (kiri-kanan) dikenali otomatis, jadi foto yang sama muncul di kedua strip.

### Menyambungkan DSLR
```
Kamera DSLR ──HDMI──▶ Capture card USB (UVC) ──USB-C──▶ iPad (iPadOS 17+)
```
- Matikan info layar di output HDMI kamera ("clean HDMI") dan auto power off.
- Pakai dummy battery / adaptor daya kamera untuk acara panjang.
- Di Pengaturan → Kamera tekan **Cari kamera**, lalu pilih capture card.
- Kualitas foto = resolusi video (1080p ≈ 2 MP, 4K ≈ 8 MP). 1080p sudah cukup untuk cetak 4R/strip; pilih 4K jika capture card mendukung.

## Catatan
- Semua foto disimpan **hanya di iPad** (tidak diupload ke internet).
- Butuh internet hanya saat pertama kali membuka; setelah itu bisa offline.
- Folder `.claude/skills/ipad-photobooth` berisi skill untuk Claude Code bila nanti ingin dibuat versi aplikasi native (App Store).
