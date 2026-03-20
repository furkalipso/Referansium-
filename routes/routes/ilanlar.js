const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const auth = require("../middleware/auth");

// TÜM İLANLAR
router.get("/", async (req, res) => {
  const { kategori, sehir, butceMin, butceMax, sure, arama, siralama, sayfa = 1, limit = 10 } = req.query;
  const offset = (sayfa - 1) * limit;
  let sartlar = ["i.durum = 'aktif'"];
  let params = [];
  let p = 1;

  if (kategori && kategori !== "tumu") { sartlar.push(`i.kategori=$${p++}`); params.push(kategori); }
  if (sehir && sehir !== "Tümü") {
    if (sehir === "Uzaktan") sartlar.push(`i.uzaktan=TRUE`);
    else { sartlar.push(`i.sehir=$${p++}`); params.push(sehir); }
  }
  if (butceMin) { sartlar.push(`i.butce>=$${p++}`); params.push(butceMin); }
  if (butceMax) { sartlar.push(`i.butce<=$${p++}`); params.push(butceMax); }
  if (sure) { sartlar.push(`i.sure=$${p++}`); params.push(sure); }
  if (arama) { sartlar.push(`(i.baslik ILIKE $${p} OR i.aciklama ILIKE $${p})`); params.push(`%${arama}%`); p++; }

  const siralamaSQL = { yeni:"i.olusturma DESC", butce:"i.butce DESC NULLS LAST", populer:"i.etkilesim DESC" }[siralama] || "i.olusturma DESC";

  try {
    const sorgu = `
      SELECT i.*, k.ad||' '||k.soyad AS kullanici_ad, k.rozet, k.dogrulandi,
             COUNT(*) OVER() AS toplam_sayi
      FROM ilanlar i JOIN kullanicilar k ON i.kullanici_id=k.id
      WHERE ${sartlar.join(" AND ")}
      ORDER BY ${siralamaSQL} LIMIT $${p} OFFSET $${p+1}
    `;
    params.push(limit, offset);
    const sonuc = await pool.query(sorgu, params);
    const toplam = sonuc.rows[0]?.toplam_sayi || 0;
    res.json({ basarili: true, ilanlar: sonuc.rows, sayfalama: { toplam: parseInt(toplam), sayfa: parseInt(sayfa), limit: parseInt(limit) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// TEK İLAN
router.get("/:id", async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT i.*, k.ad||' '||k.soyad AS kullanici_ad, k.rozet, k.dogrulandi, k.puan AS kullanici_puan
      FROM ilanlar i JOIN kullanicilar k ON i.kullanici_id=k.id
      WHERE i.id=$1
    `, [req.params.id]);
    if (sonuc.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "İlan bulunamadı." });
    await pool.query("UPDATE ilanlar SET etkilesim=etkilesim+1 WHERE id=$1", [req.params.id]);
    res.json({ basarili: true, ilan: sonuc.rows[0] });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// İLAN OLUŞTUR
router.post("/", auth, async (req, res) => {
  const { baslik, aciklama, kategori, sehir, uzaktan, butce, muzakere, sure, gizlilik } = req.body;
  if (!baslik || !aciklama || !kategori) return res.status(400).json({ basarili: false, mesaj: "Başlık, açıklama ve kategori zorunludur." });
  try {
    const bitis = new Date();
    bitis.setDate(bitis.getDate() + (sure || 15));
    const sonuc = await pool.query(`
      INSERT INTO ilanlar (kullanici_id, baslik, aciklama, kategori, sehir, uzaktan, butce, muzakere, sure, gizlilik, bitis)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [req.kullanici.id, baslik, aciklama, kategori, sehir, uzaktan, butce, muzakere, sure||15, gizlilik||"herkese", bitis]);
    await pool.query("UPDATE kullanicilar SET puan=puan+10 WHERE id=$1", [req.kullanici.id]);
    res.status(201).json({ basarili: true, mesaj: "İlan yayınlandı.", ilan: sonuc.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// İLAN GÜNCELLE
router.put("/:id", auth, async (req, res) => {
  const { baslik, aciklama, kategori, sehir, uzaktan, butce, muzakere, sure, durum } = req.body;
  try {
    const kontrol = await pool.query("SELECT kullanici_id FROM ilanlar WHERE id=$1", [req.params.id]);
    if (kontrol.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "İlan bulunamadı." });
    if (kontrol.rows[0].kullanici_id !== req.kullanici.id) return res.status(403).json({ basarili: false, mesaj: "Yetkiniz yok." });
    const sonuc = await pool.query(`
      UPDATE ilanlar SET baslik=$1, aciklama=$2, kategori=$3, sehir=$4, uzaktan=$5,
      butce=$6, muzakere=$7, sure=$8, durum=COALESCE($9,durum), guncelleme=NOW()
      WHERE id=$10 RETURNING *
    `, [baslik, aciklama, kategori, sehir, uzaktan, butce, muzakere, sure, durum, req.params.id]);
    res.json({ basarili: true, ilan: sonuc.rows[0] });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// İLAN SİL
router.delete("/:id", auth, async (req, res) => {
  try {
    const kontrol = await pool.query("SELECT kullanici_id FROM ilanlar WHERE id=$1", [req.params.id]);
    if (kontrol.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "İlan bulunamadı." });
    if (kontrol.rows[0].kullanici_id !== req.kullanici.id) return res.status(403).json({ basarili: false, mesaj: "Yetkiniz yok." });
    await pool.query("UPDATE ilanlar SET durum='silindi' WHERE id=$1", [req.params.id]);
    res.json({ basarili: true, mesaj: "İlan silindi." });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// KENDİ İLANLARIM
router.get("/benim/liste", auth, async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT *, (SELECT COUNT(*) FROM referanslar WHERE ilan_id=ilanlar.id) AS referans_sayisi
      FROM ilanlar WHERE kullanici_id=$1 AND durum!='silindi' ORDER BY olusturma DESC
    `, [req.kullanici.id]);
    res.json({ basarili: true, ilanlar: sonuc.rows });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

module.exports = router;
