import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';

export const router = Router();

// Create a hosted checkout URL using a pre-configured LS link, append custom data
router.post('/checkout', requireAuth, async (req, res) => {
  const { userId, email } = req.user;
  const baseUrl = process.env.LEMON_SQUEEZY_CHECKOUT_URL; // get from LS product/variant
  if (!baseUrl) return res.status(500).json({ error: 'missing_checkout_url' });
  const url = new URL(baseUrl);
  url.searchParams.set('checkout[custom][user_id]', userId);
  if (email) url.searchParams.set('checkout[email]', email);
  return res.json({ url: url.toString() });
});

export async function webhookHandler(req, res) {
  try {
    const signature = req.get('X-Signature') || '';
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    const digest = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).send('Invalid signature');
    }
    const event = JSON.parse(req.body.toString());
    const eventName = event?.meta?.event_name;
    const sub = event?.data?.attributes;
    const lsId = event?.data?.id;
    const custom = event?.meta?.custom_data || {};
    let { user_id: userId } = custom;

    // Fallback: if no custom data, try by email
    if (!userId) {
      const email = sub?.user_email || sub?.customer_email;
      if (email) {
        const r = await query(`select id from users where email=$1`, [email]);
        userId = r.rows[0]?.id;
      }
    }
    if (!userId) return res.status(200).send('No user context');

    const status = sub?.status || 'none';
    const renews_at = sub?.renews_at ? new Date(sub.renews_at) : null;
    const ends_at = sub?.ends_at ? new Date(sub.ends_at) : null;
    const variant_id = String(sub?.variant_id || '');

    if (eventName?.startsWith('subscription_')) {
      await query(`
        insert into subscriptions (user_id, ls_subscription_id, status, renews_at, ends_at, variant_id)
        values ($1,$2,$3,$4,$5,$6)
        on conflict (ls_subscription_id) do update set
          status=excluded.status,
          renews_at=excluded.renews_at,
          ends_at=excluded.ends_at,
          variant_id=excluded.variant_id,
          updated_at=now()
      `, [userId, lsId, status, renews_at, ends_at, variant_id]);
    }

    if (eventName === 'subscription_payment_success') {
      // Optionally reset monthly_count at renewal boundary
      await query(`update usage_counters set monthly_count=0 where user_id=$1`, [userId]);
    }

    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error', e);
    return res.status(500).send('Webhook error');
  }
}
