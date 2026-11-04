const { send, requireUser, serviceHeaders, SUPABASE_URL, SERVICE_KEY } = require('../lib/auth');
module.exports=async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed'});}
  const user=await requireUser(req,res);if(!user)return;
  const guestId=req.body&&req.body.guestId;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guestId||''))return send(res,400,{error:'Legacy guest ID is invalid.'});
  if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Inventory database is not configured.'});
  try{
    const r=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/purchases?player_id=eq.'+encodeURIComponent(guestId)+'&uid=is.null&payment_status=eq.paid',{method:'PATCH',headers:serviceHeaders({Prefer:'return=representation'}),body:JSON.stringify({uid:user.id})});
    if(!r.ok)throw new Error('Legacy purchase linking failed: '+r.status);
    return send(res,200,{linked:(await r.json()).length});
  }catch(e){console.error('Legacy purchase linking failed:',e.message);return send(res,500,{error:'Could not link previous purchases.'});}
};