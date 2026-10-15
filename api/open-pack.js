const PLAYERS = [
  { name: 'R. Storm', rating: 74, rarity: 'COMMON' },
  { name: 'A. Silva', rating: 76, rarity: 'COMMON' },
  { name: 'M. Frost', rating: 78, rarity: 'COMMON' },
  { name: 'J. Blaze', rating: 82, rarity: 'RARE' },
  { name: 'K. Rocket', rating: 84, rarity: 'RARE' },
  { name: 'D. Viper', rating: 86, rarity: 'RARE' },
  { name: 'L. Phoenix', rating: 90, rarity: 'LEGEND' },
  { name: 'T. Shadow', rating: 93, rarity: 'LEGEND' }
];
const CHANCES = {
  starter: [{ rarity: 'COMMON', weight: 80 }, { rarity: 'RARE', weight: 18 }, { rarity: 'LEGEND', weight: 2 }],
  pro: [{ rarity: 'COMMON', weight: 45 }, { rarity: 'RARE', weight: 45 }, { rarity: 'LEGEND', weight: 10 }],
  legend: [{ rarity: 'COMMON', weight: 15 }, { rarity: 'RARE', weight: 45 }, { rarity: 'LEGEND', weight: 40 }]
};
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}
function roll(productId) {
  const chances = CHANCES[productId] || CHANCES.starter;
  const total = chances.reduce((n, x) => n + x.weight, 0);
  let value = Math.random() * total;
  const rarity = (chances.find(x => (value -= x.weight) < 0) || chances[0]).rarity;
  const eligible = PLAYERS.filter(p => p.rarity === rarity);
  return eligible[Math.floor(Math.random() * eligible.length)];
}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }
  const { playerId, purchaseId } = req.body || {};
  if (typeof playerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId) ||
      (typeof purchaseId !== 'string' && typeof purchaseId !== 'number') || !/^\d+$/.test(String(purchaseId))) {
    return json(res, 400, { error: 'Valid player and purchase IDs required.' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(res, 503, { error: 'Inventory database is not configured yet.' });
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const base = url.replace(/\/$/, '') + '/rest/v1/purchases';
  try {
    const filter = '?id=eq.' + encodeURIComponent(String(purchaseId)) + '&player_id=eq.' + encodeURIComponent(playerId) + '&payment_status=eq.paid';
    const find = await fetch(base + filter + '&select=id,product_id,opened,reward', { headers });
    if (!find.ok) throw new Error('Could not verify purchase');
    const rows = await find.json();
    if (!rows.length) return json(res, 404, { error: 'Paid pack not found for this player.' });
    const purchase = rows[0];
    if (purchase.opened) return json(res, 200, { alreadyOpened: true, reward: purchase.reward });
    const reward = roll(purchase.product_id);
    const patch = await fetch(base + filter + '&opened=eq.false', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ opened: true, reward })
    });
    if (!patch.ok) throw new Error('Could not save pack reward');
    const updated = await patch.json();
    if (updated.length) return json(res, 200, { alreadyOpened: false, reward: updated[0].reward });
    const latest = await fetch(base + filter + '&select=opened,reward', { headers });
    const latestRows = await latest.json();
    if (latestRows[0] && latestRows[0].opened) return json(res, 200, { alreadyOpened: true, reward: latestRows[0].reward });
    return json(res, 409, { error: 'Pack could not be opened. Please retry.' });
  } catch (err) {
    console.error('Pack opening failed:', err.message);
    return json(res, 500, { error: 'Could not open this pack right now.' });
  }
};
