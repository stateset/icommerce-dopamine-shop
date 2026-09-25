# Build your own dopamine shop in 5 steps

A dopamine shop is a novelty storefront in the spirit of
[dopamine-shop.com](https://dopamine-shop.com) ("shop everything, buy nothing")
and [foodnevercomes.com](https://foodnevercomes.com) ("order the food, skip the
bill"): browse, cart, coupon, checkout, loyalty, tracking theater — all on real
local commerce records, zero charges.

This framework makes each shop **pure config**. You never touch engine code to
launch your own: copy the template, edit `shop.json`, run one command.

## Step 1 — Copy the template

```bash
cp -r shops/_template shops/mine
```

`shops/_template/shop.json` is fully commented. Every key except `emoji`,
`shipping`, `theater`, and `mysteryBox` is required.

## Step 2 — Name it and stock the catalog

```json
{
  "name": "GiftNeverArrives",
  "emoji": "🎁",
  "currency": "USD",
  "customer": { "email": "you@example.com", "firstName": "You", "lastName": "There" },
  "catalog": [
    { "sku": "HUG-001", "name": "Imaginary Hug", "price": "5.00", "quantity": 10 }
  ],
  "basket": [{ "sku": "HUG-001", "qty": 2 }]
}
```

Prices are decimal strings (`"12.50"`, never floats). `basket` is the demo
order the launcher runs: SKUs must exist in `catalog`.

## Step 3 — Stage the flash deal

```json
"deal": { "code": "DOPAMINE-DAY", "name": "50% off, forever", "percentOff": 0.5, "coupon": "HALFOFF" }
```

The launcher creates the promotion, activates it, mints the coupon,
validates it, and applies it to the cart. Two deal types: `percentage_off`
with `percentOff` as a fraction (`0.5` = 50% off), or `fixed_amount_off` with
`fixedOff` as a number (`5` = $5 off) via `"promotionType": "fixed_amount_off"`.

## Step 4 — Add loyalty and theater

```json
"loyalty": { "program": "Regulars Club", "pointsPerDollar": 10 },
"mysteryBox": { "pool": ["Imaginary Hug", "A profound sense of satisfaction"] },
"theater": { "lines": ["🎁 Gift {id} wrapped", "🎁 Gift {id} shipped (it was not)", "✨ Gift {id} arrived in spirit"] }
```

`{id}` in theater lines becomes the order's short ID. Theater is pure
app-level text: countdowns, riders, gates, and reveals live here, never in the
engine. Money, stock, and points are engine-grade.

Optional `loyalty.rewards` turns points back into perks: list
`{ name, type, cost }` (type is `discount`, `free_product`, or
`free_shipping`, cost in points) and the launcher creates each reward, then
redeems the first one the balance affords as a negative-point `redeem`
transaction. See `shops/gift` for a working example.

## Step 5 — Launch and verify

```bash
npm ci
node bin/launch.mjs mine
```

You get a printed receipt (items, discount math, loyalty earned, reveal,
tracking), plus a `mine.db` SQLite file you can inspect. Verify the math:
`total == subtotal − discount`, loyalty balance equals points earned, exactly
one order. `node bin/launch.mjs --list` shows all shops. Pass `--db <path>`
for a custom database or `--email <address>` to shop as someone else.
Re-running against an existing database is refused on purpose — remove it or
pick a fresh path for a clean launch.

## Remix gallery

Same framework, new vibes — each is one `shop.json` away:

- **TripNeverLeaves** (included): book the trip, skip the airport.
- **GigNeverPlays**: tiny-quantity inventory plus `reject_if_insufficient`
  gives real sellout mechanics; loyalty tiers as presale levels.
- **FitNeverSweats**: daily deals plus `adjustPoints` streak earns.
- **DegreeNeverEarns**: courses as products, loyalty tiers as degrees.
- **HomeNeverDecorates**: bundle promotions, room-box reveals.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `Basket references unknown SKU` | Every basket SKU must be in `catalog` |
| Coupon does not validate | `deal.percentOff` is a fraction; coupon codes are exact |
| Checkout fails | The launcher wires address, free shipping, and card payment itself; custom bypasses belong outside this flow |
| Database already exists | Remove it or pass `--db` — launches are intentionally fresh |
| `total` looks wrong | Totals are exact strings; never float-convert them |

## Honesty contract

Payments here are **local records**: the engine never charges a card or calls
a provider, which is exactly what makes a dopamine shop possible — and exactly
what you must tell your users. Nothing ships, nothing bills, all vibes.
