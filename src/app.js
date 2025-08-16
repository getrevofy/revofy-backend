// src/app.js
// ================================
// Revofy minimal backend (Render)
// - GET  /health                       -> { ok: true }
// - GET  /                              -> text
// - POST /webhook/lemonsqueezy         -> LS webhook (HMAC doğrulama, RAW body)
// - ALL  /admin/init?key=...           -> DB şemasını kurar (INIT_SECRET ile)
// - POST /auth/signup                  -> kayıt
// - POST /auth/login                   -> giriş
// - GET  /me (Authorization: Bearer)   -> kullanıcı & abonelik durumu
// ================================

const express = require("express");
const crypto  = require("crypto");
const db      = require("./db");
const auth    = require("./auth"); // <— auth route'ları buradan gelecek

const app  = express();
const PORT = process.env.PORT || 3000;

/** WEBHOOK: RAW body gerekir. JSON parser'dan ÖNCE tanımla. */
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

      const digest = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
      const a = Buffer.from(digest, "utf8");
      const b = Buffer.from(signature, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn("Invalid webhook signature");
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(req.body.toString());
      const name  = event?.meta?.event_name || "unknown";
      console.log("✅ LS webhook:", name);

      // TODO: event'e göre DB güncelle (subscription_created/updated/expired/payment_success)
      return res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error", err);
      return res.status(500).send("Webhook error");
    }
  }
);

/** JSON parser — webhook'tan SONRA gelmeli */
app.use(express.json({ limit: "1mb" }));

/** AUTH ROUTES */
app.post("/auth/signup", auth.signup);
app.post("/auth/login",  auth.login);
app.get ("/me",          auth.authMiddleware, auth.me);

/** Health & Root */
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) => res.send("🚀 Revofy backend is running!"));

/** Kurulum endpoint'i (INIT_SECRET ile korunur) */
app.all("/admin/init", async (req, res) => {
  try {
    const key = (req.query.key || req.headers["x-init-key"]);
    if (!process.env.INIT_SECRET || key !== process.env.INIT_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

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

/** Server */
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
