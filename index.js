import express from "express";
import fetch from "node-fetch";

const app = express();

// ── CORS — permite que cualquier origen consuma el proxy ──
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/proxy", async (req, res) => {
  const url = req.query.url;

  if (!url) return res.status(400).send("Falta URL");

  try {
    const response = await fetch(url, {
      headers: {
        // Algunos servidores IPTV exigen un User-Agent de navegador
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": url,
      }
    });

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", contentType);

    // 🔥 Reescribir m3u8
    if (url.includes(".m3u8")) {
      const text = await response.text();
      const base = url.substring(0, url.lastIndexOf("/") + 1);

      const modified = text.replace(/(.*\.ts|.*\.m3u8)/g, (match) => {
        // Ignorar líneas que son comentarios o directivas (#EXT...)
        if (match.startsWith("#")) return match;
        let absolute = match.startsWith("http") ? match : base + match;
        return `/proxy?url=${encodeURIComponent(absolute)}`;
      });

      return res.send(modified);
    }

    // 🔥 Segmentos de video (.ts)
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Error en proxy");
  }
});

app.listen(3000, () => console.log("Proxy corriendo en http://localhost:3000"));