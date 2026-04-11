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

app.get("/", (req, res) => {
  res.send(readFileSync("index.html", "utf8"));
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Falta URL");

  // URL base para resolver rutas relativas
  const base = url.substring(0, url.lastIndexOf("/") + 1);

  // Convierte cualquier URL (absoluta o relativa) en URL proxeada
  function proxify(rawUrl) {
    const abs = rawUrl.startsWith("http") ? rawUrl : base + rawUrl;
    return `${BASE_URL}/proxy?url=${encodeURIComponent(abs)}`;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":    base,
        "Origin":     new URL(url).origin,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return res.status(response.status).send(`Upstream error: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const isM3U8 = url.includes(".m3u8") || contentType.includes("mpegurl");

    if (isM3U8) {
      const text = await response.text();

      const modified = text
        .split("\n")
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line; // línea vacía → sin cambios

          // Líneas de segmento (no empiezan con #)
          if (!trimmed.startsWith("#")) {
            return proxify(trimmed);
          }

          // #EXT-X-KEY URI="..."
          if (trimmed.startsWith("#EXT-X-KEY")) {
            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => `URI="${proxify(uri)}"`);
          }

          // #EXT-X-MAP URI="..."
          if (trimmed.startsWith("#EXT-X-MAP")) {
            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => `URI="${proxify(uri)}"`);
          }

          // #EXT-X-MEDIA con URI
          if (trimmed.startsWith("#EXT-X-MEDIA") && trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => `URI="${proxify(uri)}"`);
          }

          return line; // resto de tags → sin cambios
        })
        .join("\n");

      res.set("Content-Type", "application/vnd.apple.mpegurl");
      res.set("Cache-Control", "no-cache");
      return res.send(modified);
    }

    // Binario — TS, AAC, MP4, claves, etc.
    const buffer = await response.arrayBuffer();
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "no-cache");
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error("[proxy error]", url, err.message);
    res.status(500).send("Error en proxy");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Proxy corriendo 🚀"));
