const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const auth = require("../middleware/auth");

const KOMISYON_UYGULAMA = 0.10;
const KOMISYON_ARACI = 0.15;

// REFERANS VER
router.post("/", auth, async (req, res) => {
  const { ilan_id, aciklama, komisyon_teklif } = req.body;
  if (!ilan_id || !aciklama) return res.status(400).json({ basarili: false, mesaj: "İlan ID ve açıklama zorunludur." });
  try {
    const ilan = await pool.query("SELECT * FROM ilanlar WHERE id=$1 AND durum='aktif'", [ilan_id]);
    if (ilan.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "İlan bulunamadı." });
    if (ilan.rows[0].kullanici_id === req.kullanici.id) return res.status(400).json({ basarili: false, mesaj: "Kendi ilanınıza referans veremezsiniz." });

    const mevcut = await pool.query("SELECT id FROM referanslar WHERE ilan_id=$1 AND araci_id=$2 AND durum!='red'", [ilan_id, req.kullanici.id]);
    if (mevcut.rows.length > 0) return res.status(409).json({ basarili: false, mesaj: "Bu ilana zaten referans verdiniz." });

    const sonuc = await pool.query(`
      INSERT INTO referanslar (ilan_id, araci_id, ilan_veren_id, aciklama, komisyon_teklif)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [ilan_id, req.kullanici.id, ilan.rows[0].kullanici_id, aciklama, komisyon_teklif]);

    await pool.query("UPDATE kullanicilar SET puan=puan+20 WHERE id=$1", [req.kullanici.id]);
    await pool.query(`
      INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj)
      VALUES ($1,'referans','Yeni Referans Teklifi','İlanınıza yeni bir referans teklifi geldi.')
    `, [ilan.rows[0].kullanici_id]);

    res.status(201).json({ basarili: true, mesaj: "Referans teklifi gönderildi.", referans: sonuc.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// REFERANS KABUL ET
router.put("/:id/kabul", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM referanslar WHERE id=$1", [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "Referans bulunamadı." });
    if (r.rows[0].ilan_veren_id !== req.kullanici.id) return res.status(403).json({ basarili: false, mesaj: "Yetkiniz yok." });
    await pool.query("UPDATE referanslar SET durum='kabul', guncelleme=NOW() WHERE id=$1", [req.params.id]);
    res.json({ basarili: true, mesaj: "Referans kabul edildi." });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// REFERANS TAMAMLA
router.put("/:id/tamamla", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT * FROM referanslar WHERE id=$1", [req.params.id]);
    if (r.rows.length === 0) throw new Error("Referans bulunamadı.");
    if (r.rows[0].ilan_veren_id !== req.kullanici.id) throw new Error("Yetkiniz yok.");

    const ilan = await client.query("SELECT butce FROM ilanlar WHERE id=$1", [r.rows[0].ilan_id]);
    const tutar = parseFloat(ilan.rows[0].butce || r.rows[0].komisyon_teklif || 0);
    const uygulamaKom = tutar * KOMISYON_UYGULAMA;
    const araciKom = tutar * KOMISYON_ARACI;

    await client.query("UPDATE referanslar SET durum='tamamlandi', tamamlanma=NOW() WHERE id=$1", [r.rows[0].id]);
    await client.query("UPDATE kullanicilar SET bakiye=bakiye+$1 WHERE id=$2", [araciKom, r.rows[0].araci_id]);
    await client.query("UPDATE kullanicilar SET puan=puan+100 WHERE id=$1", [r.rows[0].araci_id]);
    await client.query(`
      INSERT INTO islemler (kullanici_id, referans_id, tur, tutar, aciklama, durum)
      VALUES ($1,$2,'komisyon_gelir',$3,'Referans komisyonu','tamamlandi')
    `, [r.rows[0].araci_id, r.rows[0].id, araciKom]);
    await client.query(`
      INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj)
      VALUES ($1,'odeme','Ödeme Alındı 💰',$2)
    `, [r.rows[0].araci_id, `${araciKom.toFixed(2)} TL komisyon bakiyenize eklendi.`]);

    await client.query("COMMIT");
    res.json({ basarili: true, mesaj: "Referans tamamlandı.", ozet: { tutar, uygulamaKom, araciKom } });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ basarili: false, mesaj: err.message });
  } finally {
    client.release();
  }
});

// İLANA AİT REFERANSLAR
router.get("/ilan/:ilan_id", auth, async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT r.*, k.ad||' '||k.soyad AS araci_ad, k.rozet, k.puan AS araci_puan, k.dogrulandi
      FROM referanslar r JOIN kullanicilar k ON r.araci_id=k.id
      WHERE r.ilan_id=$1 ORDER BY r.olusturma DESC
    `, [req.params.ilan_id]);
    res.json({ basarili: true, referanslar: sonuc.rows });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

module.exports = router;
