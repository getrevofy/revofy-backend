import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { router as authRouter } from './routes/auth.js';
import { router as chatRouter } from './routes/chat.js';
import { router as meRouter } from './routes/me.js';
import { router as billingRouter, webhookHandler } from './routes/billing.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true, credentials: true }));

// For most routes, use JSON body parser
app.use(bodyParser.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/chat', chatRouter);
app.use('/me', meRouter);
app.use('/billing', billingRouter);

// Webhook MUST use raw body and be mounted before any fallback
app.post('/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.listen(PORT, () => {
  console.log(`API running on :${PORT}`);
});
