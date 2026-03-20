const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const pool = require("../db/pool");
const authMiddleware = require("../middleware/auth");

function tokenOlustur(kullanici) {
  return jwt.sign(
    { id: kullanici.id, email: kullanici.email, tip: kullanici.tip },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// KAYIT
router.post("/kayit", [
  body("ad").trim().notEmpty().withMessage("Ad gerekli"),
  body("soyad").trim().notEmpty().withMessage("Soyad gerekli"),
  body("email").isEmail().withMessage("Geçerli e-posta girin"),
  body("sifre").isLength({ min: 6 }).withMessage("Şifre en az 6 karakter"),
  body("tip").isIn(["bireysel","kurumsal","arabulucu"]).withMessage("Geçersiz tip"),
], async (req, res) => {
  const hatalar = validationResult(req);
  if (!hatalar.isEmpty()) return res.status(400).json({ basarili: false, hatalar: hatalar.array() });

  const { ad, soyad, email, sifre, tip, telefon } = req.body;
  try {
    const mevcut = await pool.query("SELECT id FROM kullanicilar WHERE email=$1", [email]);
    if (mevcut.rows.length > 0) return res.status(409).json({ basarili: false, mesaj: "Bu e-posta zaten kayıtlı." });

    const sifreHash = await bcrypt.hash(sifre, 10);
    const sonuc = await pool.query(`
      INSERT INTO kullanicilar (ad, soyad, email, sifre_hash, tip, telefon)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, ad, soyad, email, tip, rozet, puan
    `, [ad, soyad, email, sifreHash, tip, telefon]);

    const kullanici = sonuc.rows[0];
    await pool.query("UPDATE kullanicilar SET puan=puan+50 WHERE id=$1", [kullanici.id]);
    await pool.query(`
      INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj)
      VALUES ($1,'sistem','Hoş Geldiniz! 🎉','Hesabınız oluşturuldu.')
    `, [kullanici.id]);

    const token = tokenOlustur(kullanici);
    res.status(201).json({ basarili: true, mesaj: "Hesap oluşturuldu.", token, kullanici });
  } catch (err) {
    console.error(err);
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// GİRİŞ
router.post("/giris", [
  body("email").isEmail(),
  body("sifre").notEmpty(),
], async (req, res) => {
  const hatalar = validationResult(req);
  if (!hatalar.isEmpty()) return res.status(400).json({ basarili: false, hatalar: hatalar.array() });

  const { email, sifre } = req.body;
  try {
    const sonuc = await pool.query("SELECT * FROM kullanicilar WHERE email=$1 AND aktif=TRUE", [email]);
    if (sonuc.rows.length === 0) return res.status(401).json({ basarili: false, mesaj: "E-posta veya şifre hatalı." });

    const kullanici = sonuc.rows[0];
    const eslesiyor = await bcrypt.compare(sifre, kullanici.sifre_hash);
    if (!eslesiyor) return res.status(401).json({ basarili: false, mesaj: "E-posta veya şifre hatalı." });

    delete kullanici.sifre_hash;
    const token = tokenOlustur(kullanici);
    res.json({ basarili: true, mesaj: "Giriş başarılı.", token, kullanici });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// BENİM PROFİLİM
router.get("/ben", authMiddleware, async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT k.id, k.ad, k.soyad, k.email, k.tip, k.unvan, k.sehir,
             k.biyografi, k.dogrulandi, k.rozet, k.puan, k.bakiye, k.bekleyen_bakiye,
             COALESCE(json_agg(ky.yetenek) FILTER (WHERE ky.yetenek IS NOT NULL), '[]') AS yetenekler
      FROM kullanicilar k
      LEFT JOIN kullanici_yetenekler ky ON k.id=ky.kullanici_id
      WHERE k.id=$1 GROUP BY k.id
    `, [req.kullanici.id]);

    if (sonuc.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "Kullanıcı bulunamadı." });
    res.json({ basarili: true, kullanici: sonuc.rows[0] });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

module.exports = router;
