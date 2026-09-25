// Pure app-level theater: countdowns, riders, gates and reveals live here,
// never in the commerce engine. Everything is deterministic and instant so
// tests stay fast. No timers, no network, no randomness unless seeded.

export function reveal(pool, seed = Date.now()) {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error('mysteryBox.pool must be a non-empty array');
  }
  return pool[Math.abs(Number(seed)) % pool.length];
}

export function trackingTheater(shop, order) {
  const short = order.id.slice(0, 8);
  const lines = shop.theater?.lines;
  if (Array.isArray(lines) && lines.length > 0) {
    return lines.map((line) => String(line).replaceAll('{id}', short));
  }
  return [
    `🛵 Order ${short} confirmed — warming up the kitchen`,
    `🛵 Order ${short} is on its way (it is not)`,
    `✨ Order ${short} delivered — to your imagination`,
  ];
}
