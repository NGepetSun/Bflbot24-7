# 📡 StreamPulse Bot — Deploy ke Railway

Bot YouTube Live → Discord Notifier yang berjalan **24/7 di cloud**.

---

## 🚀 Cara Deploy ke Railway (Langkah demi Langkah)

### Langkah 1 — Buat akun GitHub & upload kode

1. Buka **https://github.com** → daftar/login
2. Klik **New repository** → beri nama `streampulse-bot` → klik **Create**
3. Upload semua file ini ke repository tersebut:
   - `index.js`
   - `package.json`
   - `railway.toml`
   - `.gitignore`

---

### Langkah 2 — Buat akun Railway

1. Buka **https://railway.app**
2. Klik **Login with GitHub** → izinkan akses
3. Kamu mendapat **$5 credit gratis** per bulan (cukup untuk bot kecil)

---

### Langkah 3 — Deploy dari GitHub

1. Di Railway, klik **New Project**
2. Pilih **Deploy from GitHub repo**
3. Pilih repository `streampulse-bot`
4. Railway otomatis detect Node.js dan mulai build

---

### Langkah 4 — Set Environment Variables ⚠️ PENTING

Di Railway dashboard, buka project → tab **Variables** → tambahkan:

| Variable | Value | Keterangan |
|---|---|---|
| `YOUTUBE_API_KEY` | `AIzaSyCkq70-Sh0bAxVr_Vvonq6uWeZaP9QnGUQ` | API Key YouTube kamu |
| `DISCORD_WEBHOOK` | `https://discord.com/api/webhooks/...` | Webhook Discord kamu |
| `CHANNEL_IDS` | `UCIyBeSbK8L2XL8-72p8N3qQ,UCabc123` | Channel ID dipisah koma |
| `CHECK_INTERVAL` | `60` | Cek setiap 60 detik |
| `MENTION` | `@everyone` | Mention saat notif |
| `BOT_NAME` | `StreamPulse` | Nama bot di Discord |

Setelah isi semua variable → Railway otomatis **redeploy**.

---

### Langkah 5 — Tambah Channel Baru

Untuk tambah channel baru yang ingin dipantau:

1. Buka Railway → tab **Variables**
2. Edit `CHANNEL_IDS`, tambahkan Channel ID baru dipisah koma:
   ```
   UCIyBeSbK8L2XL8-72p8N3qQ,UCchannel2,UCchannel3
   ```
3. Klik **Save** → bot otomatis restart dan langsung pantau channel baru

---

### Langkah 6 — Cek Status Bot

Railway akan memberi kamu **URL publik** (misal: `streampulse-bot.up.railway.app`).

Buka URL tersebut di browser → kamu akan melihat dashboard:
- ✅ Status bot (online/offline)
- ⏱ Uptime berapa lama
- 📊 Total pengecekan & notif terkirim
- 🔴 Channel yang sedang live sekarang

---

## 📋 Cara Dapat Channel ID YouTube

### Cara 1 — Dari URL Channel
```
https://youtube.com/channel/UCIyBeSbK8L2XL8-72p8N3qQ
                              ^^^^^^^^^^^^^^^^^^^^^^^^
                              Ini Channel ID-nya
```

### Cara 2 — Dari website
1. Buka channel YouTube yang ingin dipantau
2. Klik kanan halaman → **View Page Source**
3. Ctrl+F cari: `"channelId"`
4. Salin value-nya (format `UC...`)

### Cara 3 — Pakai website ini
Buka: **https://commentpicker.com/youtube-channel-id.php**
Paste URL channel → dapat Channel ID langsung

---

## ⚙️ Environment Variables Lengkap

```env
# Wajib
YOUTUBE_API_KEY=AIzaSy...
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
CHANNEL_IDS=UCaaa,UCbbb,UCccc

# Opsional
CHECK_INTERVAL=60       # detik (default: 60)
MENTION=@everyone       # atau @here atau kosong
BOT_NAME=StreamPulse    # nama bot di Discord
BOT_AVATAR=             # URL avatar bot (opsional)
```

---

## 💡 Tips

- **Gratis di Railway**: $5 credit/bulan cukup untuk 1 bot kecil (~500 jam)
- **Quota YouTube API**: Gratis 10.000 unit/hari. Cek 60 channel = 1 unit. Jadi bisa cek ~10.000 kali/hari
- **Anti-spam**: Bot tidak kirim notif ulang selama channel masih live
- **Auto-restart**: Jika bot crash, Railway otomatis restart (`restartPolicyType = "always"`)

---

## 🐛 Troubleshooting

| Masalah | Solusi |
|---|---|
| Bot tidak kirim notif | Cek `DISCORD_WEBHOOK` sudah benar |
| `quotaExceeded` error | Tunggu 24 jam atau buat API Key baru |
| Channel tidak terdeteksi | Pastikan Channel ID format `UC...` benar |
| Bot offline di Railway | Cek logs di Railway dashboard → tab Deployments |
