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
  const prices = { starter: 990, pro: 2990, legend: 4990 };
  if (!Object.prototype.hasOwnProperty.call(prices, productId) ||
      typeof playerId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId)) {
    throw new Error('Checkout metadata is invalid');
  }
  if (session.payment_status !== 'paid' || session.currency !== 'sek' || session.amount_total !== prices[productId]) {
    throw new Error('Checkout payment amount or status is invalid');
  }

  const endpoint = url.replace(/\/$/, '') + '/rest/v1/purchases?on_conflict=checkout_session_id';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify([{
      session_id: session.id,
      checkout_session_id: session.id,
      player_id: playerId,
      product_id: productId,
      kind: 'player_pack',
      qty: 1,
      amount_total: session.amount_total,
      currency: session.currency,
      payment_status: session.payment_status,
      status: 'paid',
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
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
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
