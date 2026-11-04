const {send,requireUser,serviceHeaders,SUPABASE_URL,SERVICE_KEY}=require('../lib/auth');
module.exports=async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{error:'Method not allowed'});}
 const user=await requireUser(req,res);if(!user)return;
 if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Wallet database is not configured.'});
 try{
  const base=SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(base+'/rest/v1/wallets?user_id=eq.'+encodeURIComponent(user.id)+'&select=balance,updated_at',{headers:serviceHeaders()});
  if(!r.ok)throw new Error('Wallet lookup failed: '+r.status);
  const rows=await r.json();return send(res,200,{balance:rows[0]?Number(rows[0].balance):0});
 }catch(e){console.error('Wallet lookup failed:',e.message);return send(res,500,{error:'Could not load wallet balance.'});}
};