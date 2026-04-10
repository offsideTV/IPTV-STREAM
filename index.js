import express from "express";
import fetch from "node-fetch";

const app = express();

// 🔥 URL base dinámica (funciona en Render)
const BASE_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

// ── CORS ──
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// 🔥 Endpoint ping (para evitar sleep)
app.get("/ping", (req, res) => {
  res.send("pong");
});

// 🔥 Proxy
app.get("/proxy", async (req, res) => {
  const url = req.query.url;

  if (!url) return res.status(400).send("Falta URL");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": url,
      }
    });

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", contentType);

    // 🔥 Reescribir m3u8
    if (url.includes(".m3u8")) {
      const text = await response.text();
      const base = url.substring(0, url.lastIndexOf("/") + 1);

      const modified = text.replace(/^(?!#)(.*\.ts|.*\.m3u8)/gm, (match) => {
        let absolute = match.startsWith("http") ? match : base + match;
        return `${BASE_URL}/proxy?url=${encodeURIComponent(absolute)}`;
      });

      return res.send(modified);
    }

    // 🔥 Segmentos (.ts)
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Error en proxy");
  }
});

app.listen(3000, () => console.log("Proxy corriendo 🚀"));
