// src/app.js
// ================================
// Revofy minimal backend (Render)
// - GET  /health
// - GET  /
// - POST /webhook/lemonsqueezy     (RAW body + HMAC doğrulama)
// - ALL  /admin/init?key=...       (DB şemasını kurar; INIT_SECRET)
// - POST /auth/signup
// - POST /auth/login
// - GET  /me                       (JWT ile)
// - GET  /billing/checkout         (Lemon hosted checkout linki)
// ================================

const express = require("express");
const crypto  = require("crypto");
const db      = require("./db");
const auth    = require("./auth");

const app  = express();
const PORT = process.env.PORT || 3000;

/** WEBHOOK — RAW body gerekli; JSON parser’dan ÖNCE tanımla */
app.post(
  "/webhook/lemonsqueezy",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const signature = req.get("X-Signature") || "";
      const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
      if (!secret) return res.status(500).send("Missing secret");

      const digest = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
      const a = Buffer.from(digest, "utf8");
      const b = Buffer.from(signature, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(req.body.toString());
      const name  = event?.meta?.event_name || "unknown";
      console.log("✅ LS webhook:", name);

      // === SUBSCRIPTION DB GÜNCELLE ===
      (async () => {
        const data = event?.data?.attributes || {};
        // Email birden fazla isimle gelebilir, olası alanları dene:
        const email =
          data.user_email ||
          data.customer_email ||
          data.email ||
          event?.data?.relationships?.customer?.data?.email ||
          null;

        if (!email) {
          console.warn("Webhook: email bulunamadı, DB güncellenmedi");
          return;
        }

        // Kullanıcıyı bul/oluştur
        const { rows: userRows } = await db.query(
          `INSERT INTO users (email)
             VALUES ($1)
             ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
             RETURNING id, email`,
          [email]
        );
        const userId = userRows[0].id;

        // Event adına göre status belirle
        let status = "none";
        if (/subscription_created|subscription_updated|payment_success|order_created/i.test(name)) {
          status = "active";
        }
        if (/subscription_expired|subscription_cancelled|subscription_canceled|subscription_paused/i.test(name)) {
          status = "expired";
        }

        // Dönem sonu
        const periodEnd = data.renews_at || data.ends_at || data.trial_ends_at || null;

        await db.query(
          `INSERT INTO subscriptions (user_id, status, current_period_end, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (user_id)
             DO UPDATE SET status = EXCLUDED.status,
                           current_period_end = EXCLUDED.current_period_end,
                           updated_at = now()`,
          [userId, status, periodEnd]
        );

        console.log(`🔄 Subscription -> ${email}: ${status} (until ${periodEnd || "-"})`);
      })().catch(err => console.error("Webhook DB update failed:", err));

      return res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error", err);
      return res.status(500).send("Webhook error");
    }
  }
);

/** JSON parser — webhook’tan SONRA gelmeli */
app.use(express.json({ limit: "1mb" }));

/** AUTH ROUTES */
app.post("/auth/signup", auth.signup);
app.post("/auth/login",  auth.login);
app.get ("/me",          auth.authMiddleware, auth.me);

/** BILLING — hosted checkout linki döndür */
app.get("/billing/checkout", auth.authMiddleware, (req, res) => {
  const url = process.env.LEMON_SQUEEZY_CHECKOUT_URL;
  if (!url) return res.status(500).json({ error: "no_checkout_url" });
  // (opsiyonel) e-posta otomatik dolsun
  const u = new URL(url);
  u.searchParams.set("checkout[email]", req.user.email);
  res.json({ url: u.toString() });
});

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
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'none',
        current_period_end TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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
