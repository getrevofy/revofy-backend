import { Router } from 'express';
import { query } from '../db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const router = Router();

router.post('/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const password_hash = await bcrypt.hash(password, 10);
  try {
    const r = await query(
      `insert into users (email, password_hash) values ($1, $2) returning id, email`,
      [email, password_hash]
    );
    const user = r.rows[0];
    // create usage & subscription defaults
    await query(`insert into usage_counters (user_id) values ($1)`, [user.id]);
    await query(`insert into subscriptions (user_id, status) values ($1, 'none')`, [user.id]);
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '14d' });
    res.json({ token });
  } catch (e) {
    if ((e.message || '').includes('unique')) return res.status(409).json({ error: 'email already exists' });
    res.status(500).json({ error: 'signup failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const r = await query(`select id, email, password_hash from users where email=$1`, [email]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '14d' });
  res.json({ token });
});
