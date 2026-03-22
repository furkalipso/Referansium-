const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ basarili: true, mesaj: 'İlanlar endpoint aktif', ilanlar: [] });
});

module.exports = router;

