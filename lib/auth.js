const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_uqlUv4qNOSXqK5n-jIHduA_fK8DEk9-'; // Public client key; never a service credential.

function send(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !SUPABASE_URL || !PUBLIC_KEY) {
    send(res, 401, { error: 'Please log in to your Matchday account.' });
    return null;
  }
  try {
    const response = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: PUBLIC_KEY, Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      send(res, 401, { error: 'Your session expired. Please log in again.' });
      return null;
    }
    const user = await response.json();
    if (!user || !user.id) {
      send(res, 401, { error: 'Invalid account session.' });
      return null;
    }
    return user;
  } catch (_) {
    send(res, 503, { error: 'Account service is temporarily unavailable.' });
    return null;
  }
}

function serviceHeaders(extra) {
  return {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
    ...(extra || {})
  };
}

module.exports = { send, requireUser, serviceHeaders, SUPABASE_URL, SERVICE_KEY };
