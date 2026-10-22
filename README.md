# 🌟 Gemini 3.8 Flash Multi-Account Pool & Smart Router

Gateway proxy cerdas yang menghubungkan **banyak akun Google / Gmail (Gemini API Key)** ke dalam satu pool terpadu dengan fitur **Auto-Failover / Rotasi Otomatis**, **Tracking Sisa Token/Kuota**, **Tampilan Chatbot UI Interaktif**, dan **Endpoint Kompatibel OpenAI (`/v1/chat/completions`)** yang dapat langsung dipasang ke **9router**, Claude Code, Cursor, atau tools AI lainnya di VPS Anda.

---

## ⚡ Fitur Utama

1. **🔄 Multi-Account Key Pool & Auto-Failover**:
   - Masukkan puluhan akun Google AI Studio / Gemini API Key.
   - Jika **Akun 1** terkena *Rate Limit (429)* atau *Kuota Habis (Resource Exhausted)*, router akan **seketika beralih ke Akun 2, Akun 3, dst.** tanpa membatalkan proses prompt Anda.
   - Akun yang rate limited otomatis masuk masa pendinginan (*cooling down*) dan pulih kembali secara otomatis.
2. **💬 Chatbot UI Interaktif (Modern Cyber-Celestial Glassmorphism)**:
   - Antarmuka web modern dengan dark mode, visualisasi glowing Gemini, rendering Markdown dan blok kode dengan tombol copy 1-klik.
   - Indikator live transparan pada setiap jawaban AI: menampilkan **nama akun Gmail yang melayani request**, jumlah token, latency, dan histori perpindahan akun.
3. **📊 Kuota & Token Tracker Real-Time**:
   - Menghitung konsumsi token per akun (Input / Output / Total).
   - Menampilkan visual progress bar kuota dan sisa estimasi token.
   - Pilihan metode rotasi: *Sequential Priority (Failover)*, *Round Robin*, atau *Least Tokens Used*.
4. **🔌 OpenAI-Compatible API Gateway (`/v1/chat/completions`)**:
   - Berfungsi sebagai reverse proxy standar OpenAI.
   - Sangat mudah dihubungkan ke **9router**, Cursor, Claude Code, LibreChat, atau OpenWebUI.

---

## 🚀 Cara Menghubungkan ke 9router di VPS

Di server VPS Anda, `9router` berjalan di port `20128`. Agar 9router menggunakan model **Gemini 3.8 Flash** dari multi-akun Anda, cukup arahkan upstream OpenAI-nya ke service ini:

1. **Base URL Provider**:
   ```text
   http://localhost:3003/v1
   ```
2. **Nama Model**:
   ```text
   gemini-3.8-flash
   ```
3. **API Key di 9router**:
   ```text
   gemini-pool-token
   ```
   *(Bisa diisi teks apa saja, karena manajemen validasi dan auto-switch akun dilakukan sepenuhnya oleh router ini).*

---

## 💻 Menjalankan Secara Lokal

```bash
# 1. Pindah ke direktori project
cd d:/Hermes/GeminiMultiRouter

# 2. Pasang dependensi
npm install

# 3. Jalankan server
npm start
```
Buka browser Anda di **`http://localhost:3003`**.

---

## ☁️ Deploy ke VPS Hermes (43.156.17.135)

Jalankan script deploy otomatis yang telah disediakan:
```bash
node scripts/deploy-vps.js
```
Script ini akan:
1. Terhubung via SSH ke VPS `43.156.17.135`.
2. Mengunggah seluruh file source code ke `/home/ubuntu/GeminiMultiRouter`.
3. Memasang dependensi Node.js di VPS.
4. Menjalankan daemon PM2 `gemini-multi-router` di port 3003 dan menyimpan status PM2 (`pm2 save`).

---

## 📁 Struktur Monorepo

```text
GeminiMultiRouter/
├── server.js                 # Express server & API routes
├── package.json              # Konfigurasi dependensi
├── data/
│   ├── config.json           # Pengaturan port, model default, cooldown
│   └── keys.json             # Database akun dan tracking token
├── services/
│   ├── geminiClient.js       # Komunikasi langsung ke Google Generative AI REST API
│   ├── keyPoolManager.js     # Logika rotasi akun, failover, cooldown, dan kuota
│   └── openAiAdapter.js      # Konverter protokol OpenAI <-> Gemini
├── public/
│   ├── index.html            # UI Chatbot, Manajemen Akun, & Analitik
│   ├── styles.css            # Desain antarmuka Cyber-Celestial Glassmorphism
│   └── app.js                # Logika interaktif frontend
└── scripts/
    └── deploy-vps.js         # Script 1-klik deploy ke VPS Hermes
```

---

## 📄 Lisensi
MIT License © M-Sulton
