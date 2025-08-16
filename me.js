import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';

export const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const { userId } = req.user;
  const usageQ = await query(`select daily_count, monthly_count, daily_reset_at, monthly_reset_at from usage_counters where user_id=$1`, [userId]);
  const subQ = await query(`select status, renews_at, ends_at from subscriptions where user_id=$1`, [userId]);
  const dailyLimit = parseInt(process.env.DAILY_LIMIT || '100', 10);
  const monthlyLimit = parseInt(process.env.MONTHLY_LIMIT || '1000', 10);
  const usage = usageQ.rows[0] || {};
  const sub = subQ.rows[0] || { status: 'none' };
  res.json({
    subscription: sub,
    usage: { 
      daily_used: usage.daily_count || 0, 
      daily_remaining: Math.max(0, dailyLimit - (usage.daily_count || 0)),
      monthly_used: usage.monthly_count || 0,
      monthly_remaining: Math.max(0, monthlyLimit - (usage.monthly_count || 0))
    }
  });
});
