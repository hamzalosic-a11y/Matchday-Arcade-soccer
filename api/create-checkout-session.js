const Stripe=require('stripe');
const {send,requireUser}=require('../lib/auth');
const PRODUCTS={
 starter:{name:'Starter Player Pack',amount:990,description:'One Starter player-card pack.'},
 pro:{name:'Pro Player Pack',amount:2990,description:'One Pro player-card pack.'},
 icon:{name:'Icon Player Pack',amount:4990,description:'One Icon player-card pack.'}
};
module.exports=async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed'});}
 if(!process.env.STRIPE_SECRET_KEY||!process.env.SITE_URL)return send(res,503,{error:'Payments are not configured yet.'});
 const user=await requireUser(req,res);if(!user)return;
 try{
  const productId=req.body&&req.body.productId;
  if(!Object.prototype.hasOwnProperty.call(PRODUCTS,productId))return send(res,400,{error:'Unknown pack.'});
  const product=PRODUCTS[productId],stripe=new Stripe(process.env.STRIPE_SECRET_KEY),base=process.env.SITE_URL.replace(/\/$/,'');
  const session=await stripe.checkout.sessions.create({
   mode:'payment',
   line_items:[{quantity:1,price_data:{currency:'sek',unit_amount:product.amount,product_data:{name:product.name,description:product.description}}}],
   metadata:{userId:user.id,productId,version:'2'},client_reference_id:user.id,customer_email:user.email||undefined,
   success_url:base+'/?purchase=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:base+'/?purchase=cancelled',billing_address_collection:'auto'
  });
  return send(res,200,{url:session.url});
 }catch(e){console.error('Checkout creation failed:',e.message);return send(res,500,{error:'Could not start checkout. Please try again later.'});}
};