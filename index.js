import express from "express";
import fetch from "node-fetch";
import { readFileSync } from "fs";

const app = express();

const BASE_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;

// CORS
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ──────── LA MAGIA PARA LOS ARCHIVOS ESTÁTICOS ────────
// Esto le dice a Express que la carpeta actual (process.cwd()) 
// funciona como un directorio público. Así podrá encontrar 'cast.js'.
app.use(express.static(process.cwd()));
// ──────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.send(readFileSync("index.html", "utf8"));
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Falta URL");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": url,
        "Origin": url
      }
    });

    const contentType = response.headers.get("content-type") || "application/octet-stream";

    // M3U8
    if (url.includes(".m3u8")) {
      const text = await response.text();
      const base = url.substring(0, url.lastIndexOf("/") + 1);

      const modified = text.replace(/^(?!#)(.+)$/gm, (match) => {
        let absolute = match.startsWith("http") ? match : base + match;
        return `${BASE_URL}/proxy?url=${encodeURIComponent(absolute)}`;
      });

      res.set("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(modified);
    }

    // TS u otros
    const buffer = await response.arrayBuffer();
    res.set("Content-Type", contentType);
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error(err);
    res.status(500).send("Error en proxy");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Proxy corriendo 🚀"));
