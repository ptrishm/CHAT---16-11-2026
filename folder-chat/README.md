# DapurMelty

Marketplace UMKM makanan/minuman berbasis **Node.js, Express, dan MySQL** dengan tiga peran:

- **Admin**: melihat metrik marketplace, seluruh produk, dan pengguna; mengelola produk.
- **Seller**: menambah/mengubah/menonaktifkan produknya sendiri, melihat pesanan yang memuat produknya, serta memperbarui status.
- **Pembeli**: daftar akun, mencari produk, memasukkan keranjang, checkout, dan melihat riwayat pesanan.

## Menjalankan aplikasi

1. Salin `.env.example` menjadi `.env`, lalu sesuaikan kredensial MySQL.
2. Buat struktur database:
   ```bash
   mysql -u root -p < database/schema.sql
   ```
   Jika database sudah pernah dibuat sebelum fitur verifikasi email ditambahkan, jalankan juga:
   ```bash
   mysql -u root -p < database/migration-email-verification.sql
   ```
3. Instal dependensi dan masukkan data contoh:
   ```bash
   npm install
   npm run seed
   ```
4. Jalankan:
   ```bash
   npm start
   ```
5. Buka `http://localhost:3000`.

## Akun dummy

Semua akun menggunakan kata sandi `password123`.

| Peran | Email |
|---|---|
| Admin | `admin@dapurmelty.test` |
| Seller | `seller@dapurmelty.test` |
| Seller kedua | `seller2@dapurmelty.test` |
| Pembeli | `buyer@dapurmelty.test` |

## Konfirmasi email

Akun pembeli baru harus dikonfirmasi melalui tautan unik yang berlaku selama 24 jam. Konfigurasikan `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, dan `APP_URL` pada `.env` agar tautan dikirim ke email. Tanpa konfigurasi SMTP, tautan konfirmasi ditampilkan di terminal server untuk pengujian lokal.

## Catatan produksi

- Ganti `JWT_SECRET` dengan nilai rahasia panjang dan unik.
- Gunakan user MySQL khusus aplikasi (bukan `root`) serta koneksi TLS pada deployment.
- Aplikasi menyediakan header keamanan Helmet, pembatasan request endpoint autentikasi, hash password bcrypt, validasi data, dan otorisasi berbasis peran.
