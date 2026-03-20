const express = require("express");
const pool = require("../db/pool");
const auth = require("../middleware/auth");

// ── KULLANICILAR ─────────────────────────────────────────────
const kullaniciRouter = express.Router();

kullaniciRouter.get("/:id", async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT k.id, k.ad, k.soyad, k.email, k.unvan, k.sehir, k.biyografi,
             k.dogrulandi, k.rozet, k.puan, k.tip, k.olusturma,
             COALESCE(json_agg(ky.yetenek) FILTER (WHERE ky.yetenek IS NOT NULL), '[]') AS yetenekler,
             (SELECT COUNT(*) FROM referanslar WHERE araci_id=k.id AND durum='tamamlandi') AS tamamlanan_referans,
             (SELECT COUNT(*) FROM ilanlar WHERE kullanici_id=k.id AND durum='aktif') AS aktif_ilan,
             (SELECT ROUND(AVG(puan),1) FROM degerlendirmeler WHERE hedef_id=k.id) AS ortalama_puan
      FROM kullanicilar k
      LEFT JOIN kullanici_yetenekler ky ON k.id=ky.kullanici_id
      WHERE k.id=$1 AND k.aktif=TRUE GROUP BY k.id
    `, [req.params.id]);
    if (sonuc.rows.length === 0) return res.status(404).json({ basarili: false, mesaj: "Kullanıcı bulunamadı." });
    res.json({ basarili: true, kullanici: sonuc.rows[0] });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

kullaniciRouter.put("/profil", auth, async (req, res) => {
  const { ad, soyad, unvan, sehir, biyografi, yetenekler } = req.body;
  try {
    await pool.query(`
      UPDATE kullanicilar SET ad=$1, soyad=$2, unvan=$3, sehir=$4, biyografi=$5, guncelleme=NOW() WHERE id=$6
    `, [ad, soyad, unvan, sehir, biyografi, req.kullanici.id]);
    if (yetenekler && Array.isArray(yetenekler)) {
      await pool.query("DELETE FROM kullanici_yetenekler WHERE kullanici_id=$1", [req.kullanici.id]);
      for (const y of yetenekler) {
        await pool.query("INSERT INTO kullanici_yetenekler (kullanici_id, yetenek) VALUES ($1,$2)", [req.kullanici.id, y]);
      }
    }
    res.json({ basarili: true, mesaj: "Profil güncellendi." });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// ── CÜZDAN ───────────────────────────────────────────────────
const cuzdanRouter = express.Router();

cuzdanRouter.get("/bakiye", auth, async (req, res) => {
  try {
    const sonuc = await pool.query("SELECT bakiye, bekleyen_bakiye FROM kullanicilar WHERE id=$1", [req.kullanici.id]);
    res.json({ basarili: true, ...sonuc.rows[0] });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

cuzdanRouter.get("/islemler", auth, async (req, res) => {
  try {
    const sonuc = await pool.query("SELECT * FROM islemler WHERE kullanici_id=$1 ORDER BY olusturma DESC LIMIT 50", [req.kullanici.id]);
    res.json({ basarili: true, islemler: sonuc.rows });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

cuzdanRouter.post("/para-cek", auth, async (req, res) => {
  const { miktar, iban } = req.body;
  if (!miktar || !iban) return res.status(400).json({ basarili: false, mesaj: "Miktar ve IBAN zorunludur." });
  try {
    const k = await pool.query("SELECT bakiye FROM kullanicilar WHERE id=$1", [req.kullanici.id]);
    if (parseFloat(k.rows[0].bakiye) < parseFloat(miktar)) return res.status(400).json({ basarili: false, mesaj: "Yetersiz bakiye." });
    await pool.query("UPDATE kullanicilar SET bakiye=bakiye-$1 WHERE id=$2", [miktar, req.kullanici.id]);
    await pool.query("INSERT INTO islemler (kullanici_id, tur, tutar, aciklama, iban, durum) VALUES ($1,'para_cekimi',$2,'IBAN para çekimi',$3,'beklemede')", [req.kullanici.id, -miktar, iban]);
    res.json({ basarili: true, mesaj: `${miktar} TL para çekme talebi alındı.` });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// ── DEĞERLENDİRMELER ─────────────────────────────────────────
const degerlendirmeRouter = express.Router();

degerlendirmeRouter.get("/kullanici/:id", async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT d.*, k.ad||' '||k.soyad AS degerlendiren_ad, k.rozet
      FROM degerlendirmeler d JOIN kullanicilar k ON d.degerlendiren_id=k.id
      WHERE d.hedef_id=$1 ORDER BY d.olusturma DESC
    `, [req.params.id]);
    res.json({ basarili: true, degerlendirmeler: sonuc.rows });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

degerlendirmeRouter.post("/", auth, async (req, res) => {
  const { referans_id, hedef_id, puan, yorum, etiketler } = req.body;
  if (!hedef_id || !puan) return res.status(400).json({ basarili: false, mesaj: "Hedef ve puan zorunludur." });
  try {
    const sonuc = await pool.query(`
      INSERT INTO degerlendirmeler (referans_id, degerlendiren_id, hedef_id, puan, yorum, etiketler)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [referans_id, req.kullanici.id, hedef_id, puan, yorum, etiketler]);
    await pool.query("INSERT INTO bildirimler (kullanici_id, tur, baslik, mesaj) VALUES ($1,'degerlendirme','Yeni Değerlendirme ⭐',$2)", [hedef_id, `${puan} yıldız aldınız!`]);
    res.status(201).json({ basarili: true, degerlendirme: sonuc.rows[0] });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

degerlendirmeRouter.put("/:id/yanit", auth, async (req, res) => {
  const { yanit } = req.body;
  try {
    await pool.query("UPDATE degerlendirmeler SET yanit=$1 WHERE id=$2 AND hedef_id=$3", [yanit, req.params.id, req.kullanici.id]);
    res.json({ basarili: true, mesaj: "Yanıt eklendi." });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// ── BİLDİRİMLER ──────────────────────────────────────────────
const bildirimRouter = express.Router();

bildirimRouter.get("/", auth, async (req, res) => {
  try {
    const sonuc = await pool.query("SELECT * FROM bildirimler WHERE kullanici_id=$1 ORDER BY olusturma DESC LIMIT 50", [req.kullanici.id]);
    res.json({ basarili: true, bildirimler: sonuc.rows, okunmamis: sonuc.rows.filter(b => !b.okundu).length });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

bildirimRouter.put("/tumu-oku", auth, async (req, res) => {
  try {
    await pool.query("UPDATE bildirimler SET okundu=TRUE WHERE kullanici_id=$1", [req.kullanici.id]);
    res.json({ basarili: true, mesaj: "Tüm bildirimler okundu." });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

bildirimRouter.put("/:id/oku", auth, async (req, res) => {
  try {
    await pool.query("UPDATE bildirimler SET okundu=TRUE WHERE id=$1 AND kullanici_id=$2", [req.params.id, req.kullanici.id]);
    res.json({ basarili: true });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

bildirimRouter.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM bildirimler WHERE id=$1 AND kullanici_id=$2", [req.params.id, req.kullanici.id]);
    res.json({ basarili: true });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

// ── MESAJLAR ─────────────────────────────────────────────────
const mesajRouter = express.Router();

mesajRouter.get("/konusmalar", auth, async (req, res) => {
  try {
    const sonuc = await pool.query(`
      SELECT k.id, k.ilan_id,
        (SELECT icerik FROM mesajlar WHERE konusma_id=k.id ORDER BY olusturma DESC LIMIT 1) AS son_mesaj,
        (SELECT olusturma FROM mesajlar WHERE konusma_id=k.id ORDER BY olusturma DESC LIMIT 1) AS son_tarih,
        (SELECT COUNT(*) FROM mesajlar WHERE konusma_id=k.id AND okundu=FALSE AND gonderen_id!=$1) AS okunmamis,
        (SELECT json_agg(json_build_object('id',ku.id,'ad',ku.ad||' '||ku.soyad))
         FROM konusma_katilimcilar kk JOIN kullanicilar ku ON kk.kullanici_id=ku.id
         WHERE kk.konusma_id=k.id AND ku.id!=$1) AS diger_kullanicilar
      FROM konusmalar k JOIN konusma_katilimcilar kk ON k.id=kk.konusma_id
      WHERE kk.kullanici_id=$1 ORDER BY son_tarih DESC NULLS LAST
    `, [req.kullanici.id]);
    res.json({ basarili: true, konusmalar: sonuc.rows });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

mesajRouter.get("/:konusma_id", auth, async (req, res) => {
  try {
    await pool.query("UPDATE mesajlar SET okundu=TRUE WHERE konusma_id=$1 AND gonderen_id!=$2", [req.params.konusma_id, req.kullanici.id]);
    const sonuc = await pool.query(`
      SELECT m.*, k.ad||' '||k.soyad AS gonderen_ad
      FROM mesajlar m JOIN kullanicilar k ON m.gonderen_id=k.id
      WHERE m.konusma_id=$1 ORDER BY m.olusturma ASC
    `, [req.params.konusma_id]);
    res.json({ basarili: true, mesajlar: sonuc.rows });
  } catch (err) {
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  }
});

mesajRouter.post("/baslat", auth, async (req, res) => {
  const { hedef_id, ilan_id, ilk_mesaj } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const k = await client.query("INSERT INTO konusmalar (ilan_id) VALUES ($1) RETURNING id", [ilan_id]);
    const kid = k.rows[0].id;
    await client.query("INSERT INTO konusma_katilimcilar VALUES ($1,$2),($1,$3)", [kid, req.kullanici.id, hedef_id]);
    if (ilk_mesaj) await client.query("INSERT INTO mesajlar (konusma_id, gonderen_id, icerik) VALUES ($1,$2,$3)", [kid, req.kullanici.id, ilk_mesaj]);
    await client.query("COMMIT");
    res.status(201).json({ basarili: true, konusma_id: kid });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ basarili: false, mesaj: "Sunucu hatası." });
  } finally {
    client.release();
  }
});

module.exports = { kullaniciRouter, cuzdanRouter, degerlendirmeRouter, bildirimRouter, mesajRouter };
