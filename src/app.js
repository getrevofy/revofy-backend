// CommonJS kullanıyoruz (package.json'da "type" yok veya "commonjs")
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// JSON body parser (GENEL kullanımlar için)
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Basit ana sayfa
app.get("/", (req, res) => {
  res.send("🚀 Revofy backend is running!");
});

/**
 * Lemon Squeezy Webhook
 * ÖNEMLİ: Webhook'ta RAW body gerekir; o yüzden bu route için express.raw kullanıyoruz.
 * Render'da env'e LEMON_SQUEEZY_WEBHOOK_SECRET koyduğunu varsayıyorum.
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

      // İmzayı doğrula
      const digest = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
      const a = Buffer.from(digest, "utf8");
      const b = Buffer.from(signature, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn("Invalid webhook signature");
        return res.status(400).send("Invalid signature");
      }

      // Etkinliği oku
      const event = JSON.parse(req.body.toString());
      const name = event?.meta?.event_name || "unknown";
      console.log("✅ LS webhook:", name);

      // TODO: burada "subscription_created / updated / payment_success" gibi
      // event adlarına göre veritabanında kullanıcıyı güncelleyeceğiz.

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
