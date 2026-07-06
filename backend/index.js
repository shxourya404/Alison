// Simple Express backend providing paywall scaffolding with Stripe + admin token
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const Stripe = require('stripe');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory stores for demo purposes. Replace with DB in production.
const freeEmails = new Set();
const freeTokens = new Map(); // token -> {expiresAt: timestamp}

const ADMIN_ACCESS_TOKEN = process.env.ADMIN_ACCESS_TOKEN || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const stripe = STRIPE_SECRET_KEY ? Stripe(STRIPE_SECRET_KEY) : null;

app.use(bodyParser.json());
app.use(cookieParser());

function isAdmin(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) {
    const token = h.slice(7);
    return token === ADMIN_ACCESS_TOKEN;
  }
  return false;
}

function checkAccessMiddleware(req, res, next) {
  // Admin bypass
  if (isAdmin(req)) return next();

  // Token-based access via Authorization: Bearer <token>
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) {
    const token = h.slice(7);
    const entry = freeTokens.get(token);
    if (entry && entry.expiresAt > Date.now()) {
      return next();
    }
  }

  // Email-based access via custom header x-user-email (demo only)
  const email = req.headers['x-user-email'];
  if (email && freeEmails.has(email)) return next();

  return res.status(402).json({error: 'Payment required. Access denied.'});
}

// Public endpoint to create a Stripe Checkout session
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(500).json({error: 'Stripe not configured.'});
  const {email} = req.body;
  if (!email) return res.status(400).json({error: 'email required in body'});

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      mode: 'subscription',
      line_items: [
        {price_data: {currency: 'usd', product_data: {name: 'Alison (Orion) subscription'}, unit_amount: 500, recurring: {interval: 'month'}}, quantity: 1}
      ],
      success_url: `${req.protocol}://${req.get('host')}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel.html`
    });
    res.json({url: session.url});
  } catch (err) {
    console.error(err);
    res.status(500).json({error: 'failed to create session'});
  }
});

// Stripe webhook to mark paid emails as active (demo)
app.post('/api/webhook', bodyParser.raw({type: 'application/json'}), (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details && session.customer_details.email;
    if (email) {
      freeEmails.add(email);
      console.log('Added paid email to freeEmails:', email);
    }
  }

  res.json({received: true});
});

// Admin endpoints
app.post('/admin/grant-free', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({error: 'unauthorized'});
  const {email} = req.body;
  if (!email) return res.status(400).json({error: 'email required'});
  freeEmails.add(email);
  res.json({ok: true, email});
});

app.post('/admin/revoke-free', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({error: 'unauthorized'});
  const {email} = req.body;
  if (!email) return res.status(400).json({error: 'email required'});
  freeEmails.delete(email);
  res.json({ok: true, email});
});

app.post('/admin/generate-token', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({error: 'unauthorized'});
  const {ttl = 3600} = req.body; // seconds
  const token = Math.random().toString(36).slice(2, 12);
  freeTokens.set(token, {expiresAt: Date.now() + ttl * 1000});
  res.json({token, expiresAt: Date.now() + ttl * 1000});
});

// Protected API route that would call Anthropic (demo stub)
app.post('/api/claude', checkAccessMiddleware, async (req, res) => {
  const prompt = req.body.prompt || 'Hello from Alison (Orion)';
  // In production: call Anthropic here with ANTHROPIC_API_KEY
  // Example: fetch('https://api.anthropic.com/v1/complete', {headers: {Authorization: `Bearer ${ANTHROPIC_API_KEY}`}, ...})
  res.json({response: `stubbed response for prompt: ${prompt}`});
});

app.get('/admin/status', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({error: 'unauthorized'});
  res.json({freeEmails: Array.from(freeEmails), freeTokens: Array.from(freeTokens.keys())});
});

app.use(express.static('../frontend'));

app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
