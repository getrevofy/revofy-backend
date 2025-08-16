// src/auth.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "change_me";

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

async function signup(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email_password_required" });

    const { rows: existing } = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.length) return res.status(409).json({ error: "email_exists" });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      "INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email",
      [email, hash]
    );

    // kullanıcıya boş abonelik kaydı aç (kolaylık)
    await db.query(
      "INSERT INTO subscriptions (user_id, status) VALUES ($1, 'none') ON CONFLICT (user_id) DO NOTHING",
      [rows[0].id]
    );

    const token = signToken(rows[0]);
    res.json({ token });
  } catch (e) {
    console.error("signup error", e);
    res.status(500).json({ error: "signup_failed" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email_password_required" });

    const { rows } = await db.query(
      "SELECT id, email, password_hash FROM users WHERE email=$1",
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: "invalid_credentials" });

    const ok = await bcrypt.compare(password, rows[0].password_hash || "");
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    const token = signToken(rows[0]);
    res.json({ token });
  } catch (e) {
    console.error("login error", e);
    res.status(500).json({ error: "login_failed" });
  }
}

function authMiddleware(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "no_token" });
    req.user = jwt.verify(token, JWT_SECRET); // { uid, email }
    next();
  } catch {
    return res.status(401).json({ error: "bad_token" });
  }
}

async function me(req, res) {
  try {
    // abonelik + kullanım bilgisini basitçe döndür
    const { rows: sub } = await db.query(
      "SELECT status, current_period_end, updated_at FROM subscriptions WHERE user_id=$1",
      [req.user.uid]
    );
    // günlük/aylık kalanları şimdilik '-' tutuyoruz; limit logic'i sonra
    res.json({
      email: req.user.email,
      subscription: sub[0] || { status: "none" },
      usage: { daily_remaining: "-", monthly_remaining: "-" }
    });
  } catch (e) {
    console.error("me error", e);
    res.status(500).json({ error: "me_failed" });
  }
}

module.exports = { signup, login, me, authMiddleware };
