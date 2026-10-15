// Supabase Edge Function: stripe-webhook
// Stripe calls this after a player pays. It checks the message really came from Stripe,
// then adds the purchased packs to that player's account. Players cannot call it themselves.
const enc = new TextEncoder();

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Stripe signs "timestamp.body" with your webhook secret. Reject bad or old (over 5 minutes) messages.
async function verify(body, header, secret, nowMs) {
  if (!header || !secret) return false;
  const items = header.split(',').map((p) => p.trim().split('='));
  const t = (items.find((x) => x[0] === 't') || [])[1];
  const sigs = items.filter((x) => x[0] === 'v1').map((x) => x[1]);
  if (!t || !sigs.length || Math.abs(nowMs / 1000 - Number(t)) > 300) return false;
  const expected = await hmacHex(secret, t + '.' + body);
  return sigs.some((s) => same(s, expected));
}

export function makeHandler(env, doFetch, clock) {
  const H = { apikey: env.key, Authorization: 'Bearer ' + env.key, 'Content-Type': 'application/json' };
  const rest = (path, opt) => doFetch(env.url + '/rest/v1/' + path, { ...(opt || {}), headers: { ...H, ...((opt && opt.headers) || {}) } });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return async function handler(req) {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    const body = await req.text();
    if (!(await verify(body, req.headers.get('stripe-signature'), env.secret, (clock || Date.now)()))) {
      return new Response('bad signature', { status: 400 });
    }
    let ev;
    try { ev = JSON.parse(body); } catch (e) { return new Response('bad json', { status: 400 }); }
    if (ev.type !== 'checkout.session.completed' && ev.type !== 'checkout.session.async_payment_succeeded') {
      return new Response('ignored', { status: 200 });
    }
    const s = (ev.data && ev.data.object) || {};
    if (s.payment_status !== 'paid') return new Response('not paid yet', { status: 200 });

    const uid = UUID.test(s.client_reference_id || '') ? s.client_reference_id : null;
    const existing = (await (await rest('purchases?session_id=eq.' + encodeURIComponent(s.id) + '&select=status')).json())[0];
    if (existing && existing.status === 'granted') return new Response('already granted', { status: 200 });

    let item = null;
    if (s.payment_link) {
      const rows = await (await rest('store_items?payment_link=eq.' + encodeURIComponent(s.payment_link) + '&select=kind,qty')).json();
      item = rows[0] || null;
    }
    if (!existing) {
      const row = { session_id: s.id, uid, payment_link: s.payment_link || null, kind: item ? item.kind : null, qty: item ? item.qty : null, amount_total: s.amount_total, currency: s.currency, status: 'received' };
      let ins = await rest('purchases', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!ins.ok && uid) { // unknown account id: keep the record for review
        ins = await rest('purchases', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...row, uid: null, status: 'needs_review' }) });
      }
    }
    if (!uid || !item) return new Response('recorded, needs review', { status: 200 });

    // claim the purchase so two deliveries of the same message can never grant twice
    const claim = await rest('purchases?session_id=eq.' + encodeURIComponent(s.id) + '&status=in.(received,failed)', {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'granting' }),
    });
    const claimed = await claim.json();
    if (!claimed.length) return new Response('already being handled', { status: 200 });

    const g = await rest('rpc/grant_pack', { method: 'POST', body: JSON.stringify({ u: uid, k: item.kind, q: item.qty }) });
    if (!g.ok) {
      await rest('purchases?session_id=eq.' + encodeURIComponent(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed' }) });
      return new Response('grant failed', { status: 500 }); // Stripe will retry
    }
    await rest('purchases?session_id=eq.' + encodeURIComponent(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'granted' }) });
    return new Response('granted', { status: 200 });
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(makeHandler(
    { url: Deno.env.get('SUPABASE_URL'), key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), secret: Deno.env.get('STRIPE_WEBHOOK_SECRET') },
    fetch,
  ));
}
