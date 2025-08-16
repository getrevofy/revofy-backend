// src/app.js
// ================================
// Revofy minimal backend (Render)
// - GET /health  -> { ok: true }
// - GET /        -> text
// - POST /webhook/lemonsqueezy -> LS webhook (HMAC doğrulama)
// - GET/POST /admin/init?key=... -> DB şemasını kurar (INIT_SECRET ile korunur)
// ================================

const express = require("express");
const crypto  = require("crypto");
const db      = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000;

/**
 * DİKKAT: Webhook için RAW body gerekir.
 * Bu yüzden webhook route'unu, json parser'dan ÖNCE tanımlıyoruz.
 */
app.post(
  "/webhook/lemonsqueezy",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const signature = req.get("X-Signature") || "";
      const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
      if (!secret) {
        console.error("Missing LEMON_SQUEEZY_WEBHOOK_SECRET");
        return res.status(500).send("Missing secret");
      }

      // HMAC-SHA256 ile imza doğrula (raw body üzerinden)
      const digest = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
      const a = Buffer.from(digest, "utf8");
      const b = Buffer.from(signature, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn("Invalid webhook signature");
        return res.status(400).send("Invalid signature");
      }

      // Event yükünü parse et
      const event = JSON.parse(req.body.toString());
      const name  = event?.meta?.event_name || "unknown";
      console.log("✅ LS webhook:", name);

      // TODO: Burada event'e göre DB güncellemesi yapabilirsin.
      // Örn: subscription_created / subscription_updated / subscription_expired / payment_success

      return res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error", err);
      return res.status(500).send("Webhook error");
    }
  }
);

// Genel istekler için JSON parser (webhook'tan SONRA)
app.use(express.json({ limit: "1mb" }));

// Health & Root
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) => res.send("🚀 Revofy backend is running!"));

// --- Kurulum endpoint'i ---
// Hem GET hem POST kabul etsin; gizli INIT_SECRET ile korunur.
app.all("/admin/init", async (req, res) => {
  try {
    const key = (req.query.key || req.headers["x-init-key"]);
    if (!process.env.INIT_SECRET || key !== process.env.INIT_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Tabloları kuran SQL (çok satırlı template string)
    const sql = `
      -- UUID üretimi için eklenti
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      -- Kullanıcılar
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Abonelik durumu
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'none', -- none | active | on_trial | past_due | canceled | expired
        current_period_end TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Kota sayaçları
      CREATE TABLE IF NOT EXISTS usage_counters (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        day DATE NOT NULL DEFAULT CURRENT_DATE,
        month TEXT NOT NULL DEFAULT TO_CHAR(now(), 'YYYY-MM'),
        daily_count INT NOT NULL DEFAULT 0,
        monthly_count INT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `;

    await db.query(sql);
    return res.json({ ok: true, message: "schema installed" });
  } catch (e) {
    console.error("INIT ERROR", e);
    return res.status(500).json({ ok: false, error: "init_failed" });
  }
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
