const Stripe = require('stripe');

module.exports.config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function savePurchase(session) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server credentials are missing');
  const productId = session.metadata && session.metadata.productId;
  const playerId = session.metadata && session.metadata.playerId;
  if (!['starter', 'pro', 'legend'].includes(productId) || !playerId) {
    throw new Error('Checkout metadata is invalid');
  }

  const response = await fetch(url.replace(/\/$/, '') + '/rest/v1/purchases?on_conflict=checkout_session_id', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify([{
      player_id: playerId,
      checkout_session_id: session.id,
      product_id: productId,
      amount_total: session.amount_total,
      currency: session.currency,
      payment_status: session.payment_status,
      opened: false
    }])
  });
  if (!response.ok) throw new Error('Supabase insert failed: ' + response.status + ' ' + (await response.text()).slice(0, 300));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method not allowed');
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).end('Webhook not configured');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    const body = await rawBody(req);
    event = stripe.webhooks.constructEvent(body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send('Invalid webhook signature');
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid') await savePurchase(session);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe webhook fulfillment failed:', err.message);
    return res.status(500).send('Fulfillment failed; Stripe can retry this event');
  }
};
