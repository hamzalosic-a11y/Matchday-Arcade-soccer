const { send, requireUser, serviceHeaders, SUPABASE_URL, SERVICE_KEY } = require('../lib/auth');
module.exports = async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed'});}
  const user=await requireUser(req,res);if(!user)return;
  const cardId=req.body&&req.body.cardId,action=req.body&&req.body.action;
  if(!/^[0-9a-f-]{36}$/i.test(cardId||'')||!['burn','train'].includes(action))return send(res,400,{error:'Invalid card action.'});
  if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Inventory database is not configured.'});
  try{
    const r=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/manage_matchday_card',{method:'POST',headers:serviceHeaders(),body:JSON.stringify({p_uid:user.id,p_card_id:cardId,p_action:action})});
    const body=await r.json().catch(()=>null);
    if(!r.ok)return send(res,409,{error:(body&&body.message)||'Card action could not be completed.'});
    return send(res,200,{result:body});
  }catch(e){console.error('Card action failed:',e.message);return send(res,500,{error:'Could not update this card.'});}
};