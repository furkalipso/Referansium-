require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const ilanRoutes = require("./routes/ilanlar");
const referansRoutes = require("./routes/referanslar");
const { kullaniciRouter, cuzdanRouter, degerlendirmeRouter, bildirimRouter, mesajRouter } = require("./routes/diger_routelar");
const socketHandler = require("./socket/socketHandler");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "*", methods: ["GET", "POST"] }
});
socketHandler(io);

app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/ilanlar", ilanRoutes);
app.use("/api/referanslar", referansRoutes);
app.use("/api/kullanicilar", kullaniciRouter);
app.use("/api/cuzdan", cuzdanRouter);
app.use("/api/degerlendirmeler", degerlendirmeRouter);
app.use("/api/bildirimler", bildirimRouter);
app.use("/api/mesajlar", mesajRouter);

app.get("/", (req, res) => {
  res.json({
    basarili: true,
    mesaj: "REFERANSİUM API çalışıyor 🤝",
    versiyon: "1.0.0",
    zaman: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ basarili: false, mesaj: err.message || "Sunucu hatası" });
});

app.use((req, res) => {
  res.status(404).json({ basarili: false, mesaj: "Endpoint bulunamadı" });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 REFERANSİUM çalışıyor: http://localhost:${PORT}`);
});
