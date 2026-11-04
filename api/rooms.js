const crypto=require('crypto');
const {send,requireUser,serviceHeaders,SUPABASE_URL,SERVICE_KEY}=require('../lib/auth');
const CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code(){return Array.from(crypto.randomBytes(6),b=>CHARS[b%CHARS.length]).join('');}
module.exports=async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed'});}
  const user=await requireUser(req,res);if(!user)return;
  if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Room service is not configured.'});
  const base=SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/matchday_rooms';
  try{
    const action=req.body&&req.body.action;
    if(action==='create'){
      for(let i=0;i<4;i++){
        const roomCode=code();
        const r=await fetch(base,{method:'POST',headers:serviceHeaders({Prefer:'return=representation'}),body:JSON.stringify({room_code:roomCode,host_user_id:user.id,status:'open',expires_at:new Date(Date.now()+1800000).toISOString()})});
        if(r.ok){const rows=await r.json();return send(res,200,{room:rows[0],code:roomCode});}
        if(r.status!==409)throw new Error('Room creation failed: '+r.status);
      }
      return send(res,503,{error:'Could not generate a room code. Try again.'});
    }
    if(action==='join'){
      const roomCode=String(req.body&&req.body.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode))return send(res,400,{error:'Enter a valid six-character room code.'});
      const url=base+'?room_code=eq.'+encodeURIComponent(roomCode)+'&status=eq.open&guest_user_id=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&host_user_id=neq.'+encodeURIComponent(user.id);
      const r=await fetch(url,{method:'PATCH',headers:serviceHeaders({Prefer:'return=representation'}),body:JSON.stringify({guest_user_id:user.id,status:'full'})});
      if(!r.ok)throw new Error('Room join failed: '+r.status);
      const rows=await r.json();if(!rows.length)return send(res,404,{error:'Room not found, expired, or already full.'});
      return send(res,200,{room:rows[0],code:roomCode});
    }
    return send(res,400,{error:'Unknown room action.'});
  }catch(e){console.error('Room request failed:',e.message);return send(res,500,{error:'Room service could not complete that request.'});}
};