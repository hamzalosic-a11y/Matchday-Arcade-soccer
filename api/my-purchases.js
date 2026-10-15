function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }
  const { playerId } = req.query || {};
  if (typeof playerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId)) {
    return json(res, 400, { error: 'Valid player ID required.' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(res, 503, { error: 'Inventory database is not configured yet.' });
  try {
    const endpoint = url.replace(/\/$/, '') + '/rest/v1/purchases?player_id=eq.' + encodeURIComponent(playerId) + '&payment_status=eq.paid&select=id,product_id,opened,reward,created_at&order=created_at.desc';
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    if (!response.ok) throw new Error('Inventory lookup failed: ' + response.status);
    return json(res, 200, { purchases: await response.json() });
  } catch (err) {
    console.error('Inventory lookup failed:', err.message);
    return json(res, 500, { error: 'Could not load your purchases.' });
  }
};
