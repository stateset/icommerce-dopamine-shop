# icommerce-dopamine-shop

A one-button framework for launching **dopamine shops** — novelty storefronts
in the spirit of [dopamine-shop.com](https://dopamine-shop.com) and
[foodnevercomes.com](https://foodnevercomes.com): browse, cart, coupon,
checkout, loyalty, tracking theater. Real local commerce records on the
StateSet embedded engine (`@stateset/embedded` 1.35.1). Zero charges.

```bash
npm ci
node bin/launch.mjs food
```

That prints a receipt: items, `HALFOFF` deal math, loyalty earned, a mystery
reveal, and rider tracking — plus a `food.db` you can inspect. `node
bin/launch.mjs --list` shows every shop.

## Shop gallery

| Shop | Vibe | Deal | Loyalty |
| --- | --- | --- | --- |
| `food` — CraveNeverPays | Fake food delivery | 50% off, `HALFOFF` | Craving Club |
| `travel` — TripNeverLeaves | Book the trip, skip the airport | 20% off, `WINDOWSEAT` | Wander Miles |
| `mall` — ShopEverything | Shop everything, buy nothing | 50% off, `DOPAMINE50` | Vibes Club |
| `gift` — GiftNeverArrives | Gifts that never ship | $5 off, `GIFT5` | Thoughtfulness Club + Gift Wrap redeem |
| `fit` — FitNeverSweats | Gear drops, zero workouts | 30% off, `SWEAT30` | Streak Club, really ships (locally) |

## Build your own

Each shop is one `shop.json` — no engine code. Follow
[GUIDE.md](GUIDE.md): copy `shops/_template`, edit five sections, launch.

```
shops/<yours>/shop.json   catalog, basket, deal, loyalty, theater
lib/shop.mjs              the framework: seed → cart → coupon → checkout → loyalty
lib/theater.mjs           pure countdown/rider/reveal text (no engine calls)
bin/launch.mjs            the one button: <shop> [--db <path>] [--email <addr>]
tests/launch.test.mjs     every preset's loop balances; CLI works; negatives fail
```

## What's real vs theater

Engine-grade: products, stock, percentage-off promotions, coupon validation,
cart totals as exact strings, checkout orders, loyalty points and rewards,
promotion usage records. App-level theater: countdowns, riders, gates,
mystery reveals, and all copy. Payments are **local records only** — no card
is charged and no provider is called. Say so to your users.

## Develop

```bash
npm ci
npm test
node bin/launch.mjs mall --db /tmp/mall.db
node bin/launch.mjs checkin mall --db /tmp/mall.db
```
