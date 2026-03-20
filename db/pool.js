const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Veritabanı bağlantı hatası:", err.message);
  } else {
    console.log("✅ PostgreSQL bağlantısı başarılı");
    release();
  }
});

module.exports = pool;
