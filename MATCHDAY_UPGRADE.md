# Matchday secure systems upgrade

This additive upgrade preserves the existing game, Supabase username/password accounts, ranked mode, Player Career, Manager Career and Dream Team.

## Database
Apply `supabase/matchday-secure-systems.sql` through Supabase SQL Editor. It adds:
- account-owned wallets and coin transaction history;
- account-owned player-card inventory;
- Stripe webhook idempotency records;
- expiring private room codes;
- service-role-only SQL functions for payment fulfillment, pack opening and duplicate-card management.

## Vercel environment
Set these server environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never expose or commit)
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` (verify logged-in Supabase sessions)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SITE_URL` (production HTTPS origin)

## Stripe
Configure `/api/stripe-webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The server validates the raw Stripe signature, account owner, product, currency and exact price. The webhook calls an idempotent service-role-only SQL function. The browser success redirect never grants an item.

Pack IDs/prices: Starter 990 SEK, Pro 2,990 SEK, Icon 4,990 SEK. Icon maps to the existing database product key `legend`.

## Legacy purchases
If `matchday_guest_player_id` still exists in the same browser, the shop links those old paid rows to the signed-in account once. If browser data was already cleared before linking, the random old ID cannot be reconstructed; the game owner must review the Stripe receipt/session ID manually.

## Economy
Burning a Bronze common card grants 25 coins. Training consumes three duplicate Bronze cards of the same player and adds +1 to OVR/PAC/SHO/PAS/DEF, capped at 99.

## Multiplayer
Private six-character codes expire after 30 minutes. The room API reserves a host and one guest; gameplay can use the existing Supabase Realtime host-authoritative simulation.

## 3D and performance
The current game uses a procedural WebGL renderer, not external GLB models. Keep it lightweight. If GLB assets are added later, compress geometry with Meshopt/Draco, textures with KTX2, and lazy-load stadium/cosmetic assets after the first menu is interactive.
