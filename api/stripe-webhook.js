const Stripe=require('stripe');
module.exports.config={api:{bodyParser:false}};
async function rawBody(req){const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks);}
module.exports=async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end('Method not allowed');}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!process.env.STRIPE_SECRET_KEY||!process.env.STRIPE_WEBHOOK_SECRET||!url||!key)return res.status(503).end('Webhook not configured');
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);let event;
 try{event=stripe.webhooks.constructEvent(await rawBody(req),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
 catch(e){console.error('Stripe signature verification failed:',e.message);return res.status(400).send('Invalid webhook signature');}
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return res.status(200).json({received:true,ignored:true});
 const s=event.data.object;if(s.payment_status!=='paid')return res.status(200).json({received:true,pending:true});
 const productId=s.metadata&&s.metadata.productId,userId=s.metadata&&s.metadata.userId;
 const products={starter:{amount:990,db:'starter'},pro:{amount:2990,db:'pro'},icon:{amount:4990,db:'legend'}},product=products[productId];
 if(!product||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId||'')||s.client_reference_id!==userId||s.mode!=='payment'||s.currency!=='sek'||s.amount_total!==product.amount){
  console.error('Rejected paid session with invalid product, owner, or amount:',s.id);return res.status(400).send('Invalid Checkout Session metadata or amount');
 }
 try{
  const r=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/fulfill_matchday_checkout',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_event_id:event.id,p_event_type:event.type,p_session_id:s.id,p_uid:userId,p_product_id:product.db,p_amount_total:s.amount_total,p_currency:s.currency})});
  if(!r.ok)throw new Error('Supabase fulfillment failed: '+r.status+' '+(await r.text()).slice(0,300));
  return res.status(200).json({received:true});
 }catch(e){console.error('Stripe fulfillment failed:',e.message);return res.status(500).send('Fulfillment failed; Stripe can retry this event');}
};