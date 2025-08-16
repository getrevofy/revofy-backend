// src/limits.js
const db = require("./db");

// Ücretsiz kullanıcı limitleri (ENV ile özelleştirilebilir)
const DAILY_LIMIT   = parseInt(process.env.DAILY_LIMIT   || "100", 10);
const MONTHLY_LIMIT = parseInt(process.env.MONTHLY_LIMIT || "1000", 10);

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

async function readSubscription(userId) {
  const r = await db.query(
    `SELECT status, current_period_end FROM subscriptions WHERE user_id=$1`,
    [userId]
  );
  return r.rows[0] || { status: "none" };
}

async function readCounters(userId) {
  const today = await db.query(
    `SELECT daily_count
       FROM usage_counters
      WHERE user_id=$1 AND day=CURRENT_DATE`,
    [userId]
  );

  const month = await db.query(
    `SELECT COALESCE(SUM(daily_count),0) AS m
       FROM usage_counters
      WHERE user_id=$1 AND month=$2`,
    [userId, monthKey()]
  );

  return {
    daily: today.rows[0]?.daily_count || 0,
    monthly: month.rows[0]?.m || 0,
  };
}

async function incrementToday(userId) {
  await db.query(
    `INSERT INTO usage_counters (user_id, day, month, daily_count, monthly_count)
       VALUES ($1, CURRENT_DATE, TO_CHAR(now(),'YYYY-MM'), 1, 1)
       ON CONFLICT (user_id, day)
       DO UPDATE SET daily_count = usage_counters.daily_count + 1,
                     monthly_count = usage_counters.monthly_count + 1`,
    [userId]
  );
}

// Middleware: aboneliği olmayan kullanıcıya limiti uygula
function enforceLimit() {
  return async (req, res, next) => {
    try {
      const uid = req.user?.uid;
      if (!uid) return res.status(401).json({ error: "no_user" });

      const sub = await readSubscription(uid);
      if (sub.status === "active") {
        // Aboneler için limit uygulanmıyor (istersen ENV ile farklı limit ekleyebilirsin)
        return next();
      }

      const { daily, monthly } = await readCounters(uid);

      if (daily >= DAILY_LIMIT) {
        return res.status(429).json({ error: "daily_limit_reached", limit: DAILY_LIMIT });
      }
      if (monthly >= MONTHLY_LIMIT) {
        return res.status(429).json({ error: "monthly_limit_reached", limit: MONTHLY_LIMIT });
      }

      // İstek başarıyla tamamlanınca sayaç +1
      res.once("finish", async () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          try { await incrementToday(uid); } catch (e) { console.error("increment error", e); }
        }
      });

      next();
    } catch (e) {
      console.error("limit middleware error", e);
      return res.status(500).json({ error: "limit_middleware_failed" });
    }
  };
}

module.exports = { enforceLimit, readCounters, readSubscription };
