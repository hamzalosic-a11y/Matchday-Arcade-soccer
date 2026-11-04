const { send, requireUser, serviceHeaders, SUPABASE_URL, SERVICE_KEY } = require('../lib/auth');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res,405,{error:'Method not allowed'}); }
  const user=await requireUser(req,res); if(!user)return;
  if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Inventory database is not configured.'});
  try {
    const r=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/player_cards?user_id=eq.'+encodeURIComponent(user.id)+'&select=id,card_key,rarity,card,level,created_at&order=created_at.desc',{headers:serviceHeaders()});
    if(!r.ok)throw new Error('Card lookup failed: '+r.status);
    return send(res,200,{cards:await r.json()});
  } catch(e){console.error('Card lookup failed:',e.message);return send(res,500,{error:'Could not load your card collection.'});}
};