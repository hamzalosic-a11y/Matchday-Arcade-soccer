# Matchday Stripe setup

The original game remains in `index.html`. This adds server-side Stripe Checkout, verified webhooks, and paid-pack inventory. **It is not live until the deployment and secrets below are configured.**

## What is sold
- Starter Player Pack — SEK 9.90
- Pro Player Pack — SEK 29.90
- Legend Player Pack — SEK 49.90

The backend defines prices. The browser cannot set a price. A pack is recorded only after a Stripe-signed webhook reports a paid Checkout Session. Pack opening is handled server-side and saved once in Supabase.

## 1. Deploy on Vercel
GitHub Pages cannot run these `api/*.js` server functions. Import this repository into Vercel and deploy it there. Set `SITE_URL` to the exact HTTPS production URL Vercel gives you (no trailing slash).

## 2. Set up Supabase
Create a Supabase project, open SQL Editor, and run `supabase/schema.sql`.
From Project Settings → API, copy the project URL and the **service_role** key. Add them to Vercel environment variables as:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the service-role key private. Never paste it into `index.html), commit it, or share it in chat.

## 3. Set up Stripe
Create a Stripe account and complete any identity/business checks Stripe requires. Start in test mode first.
In Stripe Developers → API keys, add the secret test key to Vercel as `STRIPE_SECRET_KEY`.
Create a webhook endpoint at `https://YOUR-VERCEL-DOMAIN/api/stripe-webhook`. Subscribe to:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Copy the webhook signing secret (starts with `whsec_`) into Vercel as `STRIPE_WEBHOOK_SECRET`.
Set `SITE_URL` to your deployed HTTPS origin.

## 4. Redeploy and test
Redeploy after setting all environment variables. Test with Stripe test mode and Stripe's test card number `4242 4242 4242 4242`, a future expiry, any CVC, and any test postal code. Do not use real cards until the test flow works end to end. Then complete Stripe's activation requirements and switch both API and webhook secrets to live mode.

## Important
- The game creates a random guest player ID in this browser. Clearing site data or changing browser/device can make that guest inventory inaccessible. This prototype does not yet have account sign-in or cross-device recovery.
- Real-money purchases can have legal, tax, refund, consumer-rights, and age requirements. If you are under 18, ask a parent/guardian to own and configure the payment account and approve selling digital items.
- Never trust the success redirect as proof of payment; the webhook and server-side database are the source of truth.
