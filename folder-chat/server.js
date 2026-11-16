require("dotenv").config();
const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const db = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "dapurmelty", waitForConnections: true, connectionLimit: 10
});
const secret = process.env.JWT_SECRET || "development-only-change-this-to-a-long-secret";
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
}) : null;
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tokenFor = user => jwt.sign({ id: user.id, role: user.role, name: user.name }, secret, { expiresIn: "8h" });
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Silakan masuk terlebih dahulu." });
  try { req.user = jwt.verify(token, secret); next(); } catch { res.status(401).json({ message: "Sesi tidak valid atau telah berakhir." }); }
}
const allow = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Anda tidak memiliki akses." });
const userFields = "id,name,email,role,phone,address,created_at";
const clean = value => typeof value === "string" ? value.trim() : "";
const hashCode = value => crypto.createHash("sha256").update(value).digest("hex");
async function issueVerificationLink(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const link = `${process.env.APP_URL || "http://localhost:3000"}/?verify=${token}&email=${encodeURIComponent(user.email)}`;
  await db.execute("DELETE FROM email_verification_tokens WHERE user_id=?", [user.id]);
  await db.execute("INSERT INTO email_verification_tokens (user_id,code_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 24 HOUR))", [user.id, hashCode(token)]);
  if (mailer) {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || "DapurMelty <no-reply@dapurmelty.local>",
      to: user.email, subject: "Kode verifikasi akun DapurMelty",
      text: `Halo ${user.name}, klik tautan ini untuk mengonfirmasi email dan mengaktifkan akun DapurMelty Anda: ${link}\n\nTautan berlaku selama 24 jam.`
    });
  } else console.log(`[DEV] Tautan konfirmasi untuk ${user.email}: ${link} (berlaku 24 jam)`);
}

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase(), password = String(req.body.password || "");
  const [rows] = await db.execute("SELECT * FROM users WHERE email=? AND is_active=1", [email]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ message: "Email atau kata sandi salah." });
  const user = rows[0];
  if (!user.email_verified_at) return res.status(403).json({ code: "EMAIL_NOT_VERIFIED", email: user.email, message: "Email belum diverifikasi." });
  res.json({ token: tokenFor(user), user: Object.fromEntries(userFields.split(",").map(k => [k, user[k]])) });
}));
app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = String(req.body.password || "");
  if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(422).json({ message: "Nama minimal 3 karakter, email valid, dan kata sandi minimal 8 karakter." });
  try {
    const [result] = await db.execute("INSERT INTO users (name,email,password_hash,role,phone,address) VALUES (?,?,?,'buyer',?,?)", [name, email, await bcrypt.hash(password, 12), clean(req.body.phone), clean(req.body.address)]);
    const user = { id: result.insertId, name, email, role: "buyer", phone: clean(req.body.phone), address: clean(req.body.address) };
    await issueVerificationLink(user);
    res.status(201).json({ message: "Akun dibuat. Periksa email Anda untuk tautan konfirmasi.", email });
  } catch (err) { if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Email sudah terdaftar." }); throw err; }
}));
app.post("/api/auth/verify-email", asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase(), token = clean(req.body.token);
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(422).json({ message: "Tautan konfirmasi tidak valid." });
  const [users] = await db.execute("SELECT * FROM users WHERE email=?", [email]);
  const user = users[0];
  if (!user) return res.status(404).json({ message: "Akun tidak ditemukan." });
  if (user.email_verified_at) return res.status(409).json({ message: "Email ini telah terverifikasi." });
  const [tokens] = await db.execute("SELECT * FROM email_verification_tokens WHERE user_id=? AND code_hash=? AND used_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1", [user.id, hashCode(token)]);
  if (!tokens[0]) return res.status(422).json({ message: "Tautan tidak valid atau sudah kedaluwarsa." });
  await db.execute("UPDATE email_verification_tokens SET used_at=NOW() WHERE id=?", [tokens[0].id]);
  await db.execute("UPDATE users SET email_verified_at=NOW() WHERE id=?", [user.id]);
  res.json({ message: "Email berhasil diverifikasi. Silakan masuk." });
}));
app.post("/api/auth/resend-verification", rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const [users] = await db.execute("SELECT id,name,email,email_verified_at FROM users WHERE email=?", [email]);
  if (users[0] && !users[0].email_verified_at) await issueVerificationLink(users[0]);
  res.json({ message: "Jika akun belum terverifikasi, tautan baru telah dikirim." });
}));
app.get("/api/auth/me", auth, asyncRoute(async (req, res) => {
  const [rows] = await db.execute(`SELECT ${userFields} FROM users WHERE id=?`, [req.user.id]); res.json(rows[0]);
}));

app.get("/api/categories", asyncRoute(async (_, res) => {
  const [rows] = await db.query("SELECT c.id,c.name,c.icon,c.created_at,COUNT(p.id) product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.is_active=1 GROUP BY c.id,c.name,c.icon,c.created_at ORDER BY c.name");
  res.json(rows);
}));
app.get("/api/products", asyncRoute(async (req, res) => {
  const params = [], conditions = ["p.is_active=1"];
  if (req.query.q) { conditions.push("(p.name LIKE ? OR p.description LIKE ?)"); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.category) { conditions.push("p.category_id=?"); params.push(Number(req.query.category)); }
  const sort = { name: "p.name ASC", price_asc: "p.price ASC", price_desc: "p.price DESC", stock: "p.stock DESC" }[req.query.sort] || "p.is_featured DESC,p.created_at DESC";
  const [rows] = await db.execute(`SELECT p.*,c.name category_name,c.icon category_icon,u.name seller_name FROM products p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.seller_id WHERE ${conditions.join(" AND ")} ORDER BY ${sort}`, params);
  res.json(rows);
}));

app.get("/api/dashboard", auth, asyncRoute(async (req, res) => {
  if (req.user.role === "admin") {
    const [[counts]] = await db.query("SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM products WHERE is_active=1) products,(SELECT COUNT(*) FROM orders) orders,(SELECT COALESCE(SUM(total),0) FROM orders WHERE status NOT IN ('cancelled')) revenue");
    return res.json({ ...counts, scope: "Semua marketplace" });
  }
  if (req.user.role === "seller") {
    const [[counts]] = await db.execute("SELECT (SELECT COUNT(*) FROM products WHERE seller_id=? AND is_active=1) products,(SELECT COALESCE(SUM(stock),0) FROM products WHERE seller_id=? AND is_active=1) stock,(SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.seller_id=? AND o.status NOT IN ('cancelled')) orders,(SELECT COALESCE(SUM(oi.subtotal),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.seller_id=? AND o.status NOT IN ('cancelled')) revenue", [req.user.id, req.user.id, req.user.id, req.user.id]);
    return res.json({ ...counts, scope: "Toko Anda" });
  }
  const [[counts]] = await db.execute("SELECT COUNT(*) orders,COALESCE(SUM(total),0) spend FROM orders WHERE buyer_id=?", [req.user.id]);
  res.json({ ...counts, scope: "Belanja Anda" });
}));
app.get("/api/products/mine", auth, allow("seller", "admin"), asyncRoute(async (req, res) => {
  const where = req.user.role === "admin" ? "" : "WHERE p.seller_id=?";
  const [rows] = await db.execute(`SELECT p.*,c.name category_name,c.icon category_icon,u.name seller_name FROM products p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.seller_id ${where} ORDER BY p.created_at DESC`, req.user.role === "admin" ? [] : [req.user.id]); res.json(rows);
}));
app.post("/api/products", auth, allow("seller", "admin"), asyncRoute(async (req, res) => {
  const { category_id, name, description = "", price, stock, image_url = "", is_featured = false } = req.body;
  if (!clean(name) || !Number.isFinite(Number(price)) || Number(price) < 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0 || !Number(category_id)) return res.status(422).json({ message: "Data produk belum valid." });
  const sellerId = req.user.role === "admin" && Number(req.body.seller_id) ? Number(req.body.seller_id) : req.user.id;
  const [result] = await db.execute("INSERT INTO products (seller_id,category_id,name,description,price,stock,image_url,is_featured) VALUES (?,?,?,?,?,?,?,?)", [sellerId, Number(category_id), clean(name), clean(description), Number(price), Number(stock), clean(image_url), Boolean(is_featured)]);
  res.status(201).json({ id: result.insertId, message: "Produk berhasil dibuat." });
}));
app.put("/api/products/:id", auth, allow("seller", "admin"), asyncRoute(async (req, res) => {
  const id = Number(req.params.id), [existing] = await db.execute("SELECT seller_id FROM products WHERE id=?", [id]);
  if (!existing[0]) return res.status(404).json({ message: "Produk tidak ditemukan." });
  if (req.user.role !== "admin" && existing[0].seller_id !== req.user.id) return res.status(403).json({ message: "Produk ini bukan milik Anda." });
  const { category_id, name, description = "", price, stock, image_url = "", is_featured = false, is_active = true } = req.body;
  await db.execute("UPDATE products SET category_id=?,name=?,description=?,price=?,stock=?,image_url=?,is_featured=?,is_active=? WHERE id=?", [Number(category_id), clean(name), clean(description), Number(price), Number(stock), clean(image_url), Boolean(is_featured), Boolean(is_active), id]);
  res.json({ message: "Produk berhasil diperbarui." });
}));
app.delete("/api/products/:id", auth, allow("seller", "admin"), asyncRoute(async (req, res) => {
  const [rows] = await db.execute("SELECT seller_id FROM products WHERE id=?", [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ message: "Produk tidak ditemukan." });
  if (req.user.role !== "admin" && rows[0].seller_id !== req.user.id) return res.status(403).json({ message: "Produk ini bukan milik Anda." });
  await db.execute("UPDATE products SET is_active=0 WHERE id=?", [Number(req.params.id)]); res.json({ message: "Produk dinonaktifkan." });
}));

app.post("/api/orders", auth, allow("buyer"), asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length || !clean(req.body.shipping_address)) return res.status(422).json({ message: "Keranjang dan alamat pengiriman wajib diisi." });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction(); let total = 0, resolved = [];
    for (const item of items) {
      const qty = Number(item.quantity); const [products] = await conn.execute("SELECT id,seller_id,name,price,stock FROM products WHERE id=? AND is_active=1 FOR UPDATE", [Number(item.product_id)]);
      const p = products[0]; if (!p || !Number.isInteger(qty) || qty < 1 || p.stock < qty) throw new Error(`Stok produk tidak mencukupi.`);
      total += Number(p.price) * qty; resolved.push({ ...p, quantity: qty });
    }
    const code = `DM-${Date.now().toString().slice(-8)}`;
    const [order] = await conn.execute("INSERT INTO orders (order_code,buyer_id,payment_method,shipping_address,notes,total) VALUES (?,?,?,?,?,?)", [code, req.user.id, clean(req.body.payment_method) || "Transfer Bank", clean(req.body.shipping_address), clean(req.body.notes), total]);
    for (const p of resolved) {
      await conn.execute("INSERT INTO order_items (order_id,product_id,seller_id,product_name,price,quantity,subtotal) VALUES (?,?,?,?,?,?,?)", [order.insertId, p.id, p.seller_id, p.name, p.price, p.quantity, Number(p.price) * p.quantity]);
      await conn.execute("UPDATE products SET stock=stock-? WHERE id=?", [p.quantity, p.id]);
    }
    await conn.commit(); res.status(201).json({ message: "Pesanan berhasil dibuat.", order_code: code });
  } catch (err) { await conn.rollback(); res.status(422).json({ message: err.message || "Pesanan gagal dibuat." }); } finally { conn.release(); }
}));
app.get("/api/orders", auth, asyncRoute(async (req, res) => {
  let sql = "SELECT DISTINCT o.* ,u.name buyer_name FROM orders o JOIN users u ON u.id=o.buyer_id", args = [];
  if (req.user.role === "buyer") { sql += " WHERE o.buyer_id=?"; args = [req.user.id]; }
  if (req.user.role === "seller") { sql += " JOIN order_items oi ON oi.order_id=o.id WHERE oi.seller_id=?"; args = [req.user.id]; }
  sql += " ORDER BY o.created_at DESC"; const [orders] = await db.execute(sql, args);
  for (const order of orders) { const [items] = await db.execute("SELECT * FROM order_items WHERE order_id=?" + (req.user.role === "seller" ? " AND seller_id=?" : ""), req.user.role === "seller" ? [order.id, req.user.id] : [order.id]); order.items = items; }
  res.json(orders);
}));
app.patch("/api/orders/:id/status", auth, allow("admin", "seller"), asyncRoute(async (req, res) => {
  const statuses = ["pending","paid","processing","shipped","completed","cancelled"], status = req.body.status;
  if (!statuses.includes(status)) return res.status(422).json({ message: "Status tidak valid." });
  if (req.user.role === "seller") { const [items] = await db.execute("SELECT id FROM order_items WHERE order_id=? AND seller_id=?", [Number(req.params.id), req.user.id]); if (!items[0]) return res.status(403).json({ message: "Pesanan tidak ditemukan." }); }
  await db.execute("UPDATE orders SET status=? WHERE id=?", [status, Number(req.params.id)]); res.json({ message: "Status pesanan diperbarui." });
}));
app.get("/api/users", auth, allow("admin"), asyncRoute(async (_, res) => { const [rows] = await db.query(`SELECT ${userFields} FROM users ORDER BY created_at DESC`); res.json(rows); }));

app.use("/api", (_, res) => res.status(404).json({ message: "Endpoint tidak ditemukan." }));
app.use((err, _, res, __) => {
  console.error(err);
  const body = { message: "Terjadi kesalahan pada server." };
  if (process.env.NODE_ENV !== "production") body.detail = err.message;
  res.status(500).json(body);
});
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(process.env.PORT || 3000, () => console.log(`DapurMelty berjalan di http://localhost:${process.env.PORT || 3000}`));
