const crypto = require('crypto');

const RARITIES = [
  { name: 'Bronze', lo: 55, hi: 64, index: 0 },
  { name: 'Silver', lo: 65, hi: 74, index: 1 },
  { name: 'Gold', lo: 75, hi: 84, index: 2 },
  { name: 'Elite', lo: 85, hi: 91, index: 3 },
  { name: 'Legend', lo: 92, hi: 97, index: 4 }
];
const CHANCES = {
  starter: [{ rarity: 'COMMON', weight: 80 }, { rarity: 'RARE', weight: 18 }, { rarity: 'LEGEND', weight: 2 }],
  pro: [{ rarity: 'COMMON', weight: 45 }, { rarity: 'RARE', weight: 45 }, { rarity: 'LEGEND', weight: 10 }],
  legend: [{ rarity: 'COMMON', weight: 15 }, { rarity: 'RARE', weight: 45 }, { rarity: 'LEGEND', weight: 40 }]
};
const FIRST = 'Luca,Mateo,Noah,Kofi,Hiro,Andre,Viktor,Sami,Rafa,Dario,Emil,Tariq,Jonas,Mehdi,Ivan,Felix,Yusuf,Nico,Oskar,Bruno,Amir,Leon,Tomas,Idris,Kenji,Marek,Pablo,Theo,Zane,Adrian,Axel,Diego,Elias,Enzo,Farid,Gabriel,Isak,Karim,Leo,Malik,Nabil,Oliver,Rayan,Samir,Thiago,Victor,Anders,Cem,Jamal,Kian,Milan,Oscar,Zlatan'.split(',');
const LAST = 'Almeida,Brandt,Castro,Demir,Eriksen,Fofana,Garcia,Hassan,Ito,Jovanovic,Kovac,Lindqvist,Mbaye,Novak,Okafor,Petrov,Rossi,Santos,Tanaka,Vargas,Weber,Xavier,Yilmaz,Zielinski,Andersson,Bello,Berg,Costa,Diaz,Elmas,Fischer,Haddad,Ibrahim,Jensen,Kamara,Larsson,Moreno,Olsson,Popov,Reyes,Sato,Thompson,Uddin,Walker,Young,Zoric'.split(',');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function roll(productId) {
  const chances = CHANCES[productId] || CHANCES.starter;
  const total = chances.reduce((n, x) => n + x.weight, 0);
  let value = Math.random() * total;
  const bucket = (chances.find(x => (value -= x.weight) < 0) || chances[0]).rarity;
  const rarityIndex = bucket === 'LEGEND' ? 4 : bucket === 'RARE' ? (Math.random() < 0.75 ? 2 : 3) : (Math.random() < 0.8 ? 0 : 1);
  const rarity = RARITIES[rarityIndex];
  const ovr = rarity.lo + Math.floor(Math.random() * (rarity.hi - rarity.lo + 1));
  const pos = pick(['GK','DF','DF','DF','MF','MF','MF','FW','FW']);
  const base = {
    GK: [ovr - 25, ovr - 30, ovr - 25, ovr - 30],
    DF: [ovr - 4, ovr - 20, ovr - 8, ovr + 2],
    MF: [ovr - 4, ovr - 6, ovr + 3, ovr - 8],
    FW: [ovr + 3, ovr + 3, ovr - 6, ovr - 30]
  }[pos];
  const stat = n => Math.max(30, Math.min(99, Math.round(n + (Math.random() * 12 - 6))));
  const name = pick(FIRST) + ' ' + pick(LAST);
  return {
    id: crypto.randomUUID(), nm: name, pos, ovr,
    pac: stat(base[0]), sht: stat(base[1]), pas: stat(base[2]), def: stat(base[3]),
    gk: pos === 'GK' ? ovr : 0, rar: rarityIndex, nat: 'World XI',
    name, rating: ovr, rarity: rarity.name
  };
}
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
