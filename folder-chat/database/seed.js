require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

async function seed() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "dapurmelty", multipleStatements: true
  });
  const password = await bcrypt.hash("password123", 12);
  await db.query("SET FOREIGN_KEY_CHECKS=0; TRUNCATE email_verification_tokens; TRUNCATE order_items; TRUNCATE orders; TRUNCATE products; TRUNCATE categories; TRUNCATE users; SET FOREIGN_KEY_CHECKS=1");
  const users = [
    ["Admin DapurMelty", "admin@dapurmelty.test", "admin", "081200000001"],
    ["Dapur Nusa", "seller@dapurmelty.test", "seller", "081200000002"],
    ["Rasa Ibu", "seller2@dapurmelty.test", "seller", "081200000003"],
    ["Ayu Pembeli", "buyer@dapurmelty.test", "buyer", "081200000004"]
  ];
  for (const [name, email, role, phone] of users) await db.execute("INSERT INTO users (name,email,password_hash,role,phone,address,email_verified_at) VALUES (?,?,?,?,?,?,NOW())", [name, email, password, role, phone, "Jl. Melati No. 12, Jakarta"]);
  const cats = [["Makanan Ringan","🍘"],["Kue & Roti","🍡"],["Minuman","🍵"],["Bumbu & Saus","🌶️"]];
  for (const cat of cats) await db.execute("INSERT INTO categories (name,icon) VALUES (?,?)", cat);
  const products = [
    [2,1,"Keripik Pisang Madu","Keripik pisang renyah dengan lapisan madu tipis.",18000,40,1],
    [2,2,"Brownies Kukus Cokelat","Brownies kukus lembut dengan cokelat pekat.",35000,12,1],
    [2,3,"Es Teh Lemon Melty","Teh dingin segar dengan perasan lemon.",12000,60,0],
    [3,4,"Sambal Bawang Botol","Sambal bawang pedas gurih, botol 150 ml.",25000,25,0],
    [3,3,"Kopi Susu Gula Aren","Kopi susu manis alami gula aren.",20000,30,1],
    [2,1,"Risoles Ayam Sayur","Risoles isi ayam dan sayur, siap goreng.",15000,0,0],
    [3,2,"Cookies Oat Kismis","Cookies oat panggang dengan kismis.",28000,18,0],
    [3,3,"Jus Jeruk Segar","Jus jeruk peras tanpa pemanis tambahan.",16000,22,0]
  ];
  for (const p of products) await db.execute("INSERT INTO products (seller_id,category_id,name,description,price,stock,is_featured) VALUES (?,?,?,?,?,?,?)", p);
  await db.end();
  console.log("Data dummy berhasil dibuat. Semua akun memakai password: password123");
}
seed().catch(err => { console.error(err.message); process.exit(1); });
