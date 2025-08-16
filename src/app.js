const express = require("express");
const crypto = require("crypto");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) => res.send("🚀 Revofy backend is running!"));

// --- Kurulum endpoint'i ---
// Hem GET hem POST kabul etsin ki tarayıcıdan çağırabilelim.
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

/** Lemon Squeezy Webhook — imza doğrulama */
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
      console.log("✅ LS webhook:", event?.meta?.event_name || "unknown");
      return res.status(200).send("OK");
    } catch (e) {
      console.error("Webhook error", e);
      return res.status(500).send("Webhook error");
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
