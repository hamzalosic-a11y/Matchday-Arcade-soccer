const {send,requireUser,serviceHeaders,SUPABASE_URL,SERVICE_KEY}=require('../lib/auth');
module.exports=async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{error:'Method not allowed'});}
 const user=await requireUser(req,res);if(!user)return;
 if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Inventory database is not configured.'});
 try{
  const url=SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/purchases?uid=eq.'+encodeURIComponent(user.id)+'&payment_status=eq.paid&select=id,product_id,opened,reward,created_at&order=created_at.desc';
  const r=await fetch(url,{headers:serviceHeaders()});if(!r.ok)throw new Error('Inventory lookup failed: '+r.status);
  return send(res,200,{purchases:await r.json()});
 }catch(e){console.error('Purchase lookup failed:',e.message);return send(res,500,{error:'Could not load your purchases.'});}
};