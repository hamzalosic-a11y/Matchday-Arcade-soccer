const crypto=require('crypto');
const {send,requireUser,serviceHeaders,SUPABASE_URL,SERVICE_KEY}=require('../lib/auth');
const RARITIES=[{name:'Bronze',lo:55,hi:64,index:0},{name:'Silver',lo:65,hi:74,index:1},{name:'Gold',lo:75,hi:84,index:2},{name:'Elite',lo:85,hi:91,index:3},{name:'Legend',lo:92,hi:97,index:4}];
const CHANCES={
 starter:[{rarity:'COMMON',weight:80},{rarity:'RARE',weight:18},{rarity:'LEGEND',weight:2}],
 pro:[{rarity:'COMMON',weight:45},{rarity:'RARE',weight:45},{rarity:'LEGEND',weight:10}],
 legend:[{rarity:'COMMON',weight:15},{rarity:'RARE',weight:45},{rarity:'LEGEND',weight:40}]
};
const FIRST='Luca,Mateo,Noah,Kofi,Hiro,Andre,Viktor,Sami,Rafa,Dario,Emil,Tariq,Jonas,Mehdi,Ivan,Felix,Yusuf,Nico,Oskar,Bruno,Amir,Leon,Tomas,Idris,Kenji,Marek,Pablo,Theo,Zane,Adrian,Axel,Diego,Elias,Enzo,Farid,Gabriel,Isak,Karim,Leo,Malik,Nabil,Oliver,Rayan,Samir,Thiago,Victor,Anders,Cem,Jamal,Kian,Milan,Oscar,Zlatan'.split(',');
const LAST='Almeida,Brandt,Castro,Demir,Eriksen,Fofana,Garcia,Hassan,Ito,Jovanovic,Kovac,Lindqvist,Mbaye,Novak,Okafor,Petrov,Rossi,Santos,Tanaka,Vargas,Weber,Xavier,Yilmaz,Zielinski,Andersson,Bello,Berg,Costa,Diaz,Elmas,Fischer,Haddad,Ibrahim,Jensen,Kamara,Larsson,Moreno,Olsson,Popov,Reyes,Sato,Thompson,Uddin,Walker,Young,Zoric'.split(',');
const pick=a=>a[Math.floor(Math.random()*a.length)];
function roll(id){
 const chances=CHANCES[id==='icon'?'legend':id]||CHANCES.starter,total=chances.reduce((n,x)=>n+x.weight,0);let v=Math.random()*total;
 const bucket=(chances.find(x=>(v-=x.weight)<0)||chances[0]).rarity;
 const ri=bucket==='LEGEND'?4:bucket==='RARE'?(Math.random()<.75?2:3):(Math.random()<.8?0:1),rarity=RARITIES[ri];
 const ovr=rarity.lo+Math.floor(Math.random()*(rarity.hi-rarity.lo+1)),pos=pick(['GK','DF','DF','DF','MF','MF','MF','FW','FW']);
 const base={GK:[ovr-25,ovr-30,ovr-25,ovr-30],DF:[ovr-4,ovr-20,ovr-8,ovr+2],MF:[ovr-4,ovr-6,ovr+3,ovr-8],FW:[ovr+3,ovr+3,ovr-6,ovr-30]}[pos];
 const stat=n=>Math.max(30,Math.min(99,Math.round(n+Math.random()*12-6))),name=pick(FIRST)+' '+pick(LAST);
 return{id:crypto.randomUUID(),nm:name,pos,ovr,pac:stat(base[0]),sht:stat(base[1]),pas:stat(base[2]),def:stat(base[3]),gk:pos==='GK'?ovr:0,rar:ri,nat:'World XI',name,rating:ovr,rarity:rarity.name};
}
module.exports=async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed'});}
 const user=await requireUser(req,res);if(!user)return;
 const purchaseId=req.body&&req.body.purchaseId;
 if(!/^\d+$/.test(String(purchaseId||'')))return send(res,400,{error:'Valid purchase ID required.'});
 if(!SUPABASE_URL||!SERVICE_KEY)return send(res,503,{error:'Inventory database is not configured.'});
 const base=SUPABASE_URL.replace(/\/$/,'');
 try{
  const find=await fetch(base+'/rest/v1/purchases?id=eq.'+encodeURIComponent(String(purchaseId))+'&uid=eq.'+encodeURIComponent(user.id)+'&payment_status=eq.paid&select=id,product_id,opened,reward',{headers:serviceHeaders()});
  if(!find.ok)throw new Error('Could not verify purchase: '+find.status);
  const rows=await find.json();if(!rows.length)return send(res,404,{error:'Paid pack not found for this account.'});
  if(rows[0].opened)return send(res,200,{alreadyOpened:true,reward:rows[0].reward});
  const reward=roll(rows[0].product_id);
  const claim=await fetch(base+'/rest/v1/rpc/claim_matchday_pack',{method:'POST',headers:serviceHeaders(),body:JSON.stringify({p_uid:user.id,p_purchase_id:Number(purchaseId),p_reward:reward})});
  if(!claim.ok)throw new Error('Pack claim failed: '+(await claim.text()).slice(0,250));
  const saved=await claim.json();return send(res,200,{alreadyOpened:false,reward:saved||reward});
 }catch(e){console.error('Pack opening failed:',e.message);return send(res,500,{error:'Could not open this pack right now. Please retry.'});}
};