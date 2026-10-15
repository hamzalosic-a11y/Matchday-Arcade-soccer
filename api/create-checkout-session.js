const Stripe = require('stripe');

const PRODUCTS = {
  starter: { name: 'Starter Player Pack', amount: 990, currency: 'sek', description: 'One Starter pack with one fictional player card.' },
  pro: { name: 'Pro Player Pack', amount: 2990, currency: 'sek', description: 'One Pro pack with one fictional player card.' },
  legend: { name: 'Legend Player Pack', amount: 4990, currency: 'sek', description: 'One Legend pack with one fictional player card.' }
};

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SITE_URL) {
    return json(res, 503, { error: 'Payments are not configured yet. Add STRIPE_SECRET_KEY and SITE_URL in the hosting environment.' });
  }
  try {
    const { productId, playerId } = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(PRODUCTS, productId)) {
      return json(res, 400, { error: 'Unknown product.' });
    }
    if (typeof playerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId)) {
      return json(res, 400, { error: 'A valid player ID is required.' });
    }

    const product = PRODUCTS[productId];
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const base = process.env.SITE_URL.replace(/\/$/, '');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: product.currency,
          unit_amount: product.amount,
          product_data: {
            name: product.name,
            description: product.description
          }
        }
      }],
      metadata: { productId, playerId },
      client_reference_id: playerId,
      success_url: base + '/?purchase=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/?purchase=cancelled',
      billing_address_collection: 'auto'
    });
    return json(res, 200, { url: session.url });
  } catch (error) {
    console.error('Stripe checkout session creation failed:', error.message);
    return json(res, 500, { error: 'Could not start checkout. Please try again later.' });
  }
};
