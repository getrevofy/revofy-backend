import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || '100', 10);
const MONTHLY_LIMIT = parseInt(process.env.MONTHLY_LIMIT || '1000', 10);

export const router = Router();

async function resetCountersIfNeeded(userId) {
  // daily reset
  await query(`
    update usage_counters
    set daily_count = case when daily_reset_at < current_date then 0 else daily_count end,
        daily_reset_at = case when daily_reset_at < current_date then current_date else daily_reset_at end,
        monthly_count = case when date_trunc('month', monthly_reset_at) < date_trunc('month', now()) then 0 else monthly_count end,
        monthly_reset_at = case when date_trunc('month', monthly_reset_at) < date_trunc('month', now()) then now() else monthly_reset_at end
    where user_id=$1
  `, [userId]);
}

router.post('/', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  // Check subscription status
  const s = await query(`select status from subscriptions where user_id=$1`, [userId]);
  const status = s.rows[0]?.status || 'none';
  const allowed = ['active', 'on_trial']; // extend as needed
  if (!allowed.includes(status)) {
    return res.status(402).json({ error: 'subscription_inactive' });
  }

  await resetCountersIfNeeded(userId);

  // Atomically increment if under limits
  const inc = await query(`
    update usage_counters
    set daily_count = daily_count + 1, monthly_count = monthly_count + 1
    where user_id=$1 and daily_count < $2 and monthly_count < $3
    returning daily_count, monthly_count
  `, [userId, DAILY_LIMIT, MONTHLY_LIMIT]);
  if (inc.rowCount === 0) {
    return res.status(429).json({ error: 'quota_exceeded' });
  }

  // Call OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });
    res.json({ reply: completion.choices[0].message });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'ai_error' });
  }
});
