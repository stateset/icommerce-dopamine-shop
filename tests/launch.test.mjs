import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Commerce } from '@stateset/embedded';
import { checkin, loadShop, runLoop } from '../lib/shop.mjs';
import { reveal, trackingTheater } from '../lib/theater.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shopsDir = join(root, 'shops');
const presets = ['food', 'travel', 'mall', 'gift', 'fit'];

function readShop(name) {
  return loadShop(JSON.parse(readFileSync(join(shopsDir, name, 'shop.json'), 'utf8')));
}

test('template config is valid and every preset loads', () => {
  readShop('_template');
  for (const name of presets) {
    const shop = readShop(name);
    assert.equal(shop.currency, 'USD');
  }
});

test('loadShop rejects configs missing required keys', () => {
  assert.throws(() => loadShop({}), /missing required key/);
  assert.throws(() => loadShop({ ...readShop('food'), deal: {} }), /deal is missing/);
  assert.throws(() => loadShop({ ...readShop('food'), deal: { code: 'X', name: 'X', coupon: 'X', promotionType: 'bogus' } }), /promotionType/);
  assert.throws(() => loadShop({ ...readShop('food'), deal: { code: 'X', name: 'X', coupon: 'X', promotionType: 'fixed_amount_off' } }), /fixedOff/);
});

test('gift shop: fixed-amount deal and reward redemption', async () => {
  const shop = readShop('gift');
  const commerce = new Commerce(':memory:');
  const receipt = await runLoop(commerce, shop, { revealSeed: 2 });
  assert.equal(receipt.dealType, 'fixed_amount_off');
  assert.equal(receipt.discount, '5');
  assert.equal(receipt.total, '19.00');
  assert.deepEqual(receipt.redeemed, { name: 'Gift Wrap', cost: 150 });
  assert.equal(receipt.loyaltyBalance, receipt.loyaltyEarned - 150);
  const txs = await commerce.loyalty.getTransactions(
    (await commerce.loyalty.getAccountByCustomer(
      (await commerce.customers.getByEmail(shop.customer.email)).id,
      (await commerce.loyalty.listPrograms()).find((p) => p.name === shop.loyalty.program).id,
    )).id,
    10,
  );
  assert.ok(txs.some((t) => t.transactionType === 'redeem' && t.points === -150));
});

for (const name of [...presets, '_template']) {
  test(`${name}: full dopamine loop balances`, async () => {
    const shop = readShop(name);
    const commerce = new Commerce(':memory:');
    const receipt = await runLoop(commerce, shop, { revealSeed: 1 });
    assert.equal(receipt.shop, shop.name);
    assert.equal(receipt.coupon, shop.deal.coupon);
    assert.equal(receipt.currency, 'USD');
    // Exact-money math: total == subtotal - discount.
    const [sub, disc, tot] = [receipt.subtotal, receipt.discount, receipt.total].map(Number);
    assert.ok(sub > 0 && disc > 0 && tot > 0);
    assert.equal((sub - disc).toFixed(2), tot.toFixed(2));
    assert.equal(receipt.loyaltyBalance, receipt.loyaltyEarned - (receipt.redeemed?.cost ?? 0));
    assert.ok(receipt.loyaltyEarned > 0);
    assert.ok(receipt.orderId);
    assert.equal(await commerce.orders.count(), 1);
    if (shop.mysteryBox) {
      assert.ok(shop.mysteryBox.pool.includes(receipt.mysteryReveal));
    }
    assert.equal(receipt.tracking.length, 3);
  });
}

test('theater helpers are deterministic and pure', () => {
  assert.equal(reveal(['a', 'b', 'c'], 4), 'b');
  assert.equal(reveal(['a', 'b', 'c'], 4), reveal(['a', 'b', 'c'], 4));
  const lines = trackingTheater({ theater: { lines: ['Order {id} bye'] } }, { id: 'abcdef12-0000' });
  assert.deepEqual(lines, ['Order abcdef12 bye']);
});

test('CLI launches a shop with one command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dopamine-cli-'));
  try {
    const db = join(dir, 'food.db');
    const result = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), 'food', '--db', db], {
      encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CraveNeverPays/);
    assert.match(result.stdout, /0 spent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects unknown shops and existing databases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dopamine-cli-neg-'));
  try {
    const unknown = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), 'nope', '--db', join(dir, 'x.db')], { encoding: 'utf8' });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown shop/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --email shops as someone else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dopamine-cli-email-'));
  try {
    const db = join(dir, 'food.db');
    const result = spawnSync(
      process.execPath,
      [join(root, 'bin', 'launch.mjs'), 'food', '--db', db, '--email', 'critic@example.com'],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CraveNeverPays/);
    const commerce = new Commerce(db);
    const customer = await commerce.customers.getByEmail('critic@example.com');
    assert.ok(customer, 'override email must own the order');
    assert.equal(await commerce.orders.count(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI launches a copied template shop (GUIDE flow)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dopamine-cli-custom-'));
  const shopDir = join(root, 'shops', 'tmp-custom-shop');
  try {
    cpSync(join(root, 'shops', '_template'), shopDir, { recursive: true });
    const result = spawnSync(
      process.execPath,
      [join(root, 'bin', 'launch.mjs'), 'tmp-custom-shop', '--db', join(dir, 'custom.db')],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /My Dopamine Shop/);
    assert.match(result.stdout, /0 spent/);
  } finally {
    rmSync(shopDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI refuses to relaunch into an existing database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dopamine-cli-rerun-'));
  try {
    const db = join(dir, 'food.db');
    const first = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), 'food', '--db', db], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), 'food', '--db', db], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fulfill ships the order for real (locally)', async () => {
  const fit = await runLoop(new Commerce(':memory:'), readShop('fit'), { revealSeed: 3 });
  assert.equal(fit.orderStatus, 'shipped');
  assert.equal(fit.shipmentStatus, 'shipped');
  assert.equal(fit.trackingNumber, 'GAINS-OUTBOUND-001');

  const food = await runLoop(new Commerce(':memory:'), readShop('food'), { revealSeed: 3 });
  assert.equal(food.orderStatus, 'confirmed');
  assert.equal(food.shipmentStatus, null);
  assert.equal(food.trackingNumber, null);
});

test('fulfill without a tracking string fails fast', async () => {
  const bad = { ...readShop('fit'), fulfill: {} };
  await assert.rejects(runLoop(new Commerce(':memory:'), bad), /"tracking"/);
});

test('daily check-ins build a streak with growing awards', async () => {
  const shop = readShop('food');
  const { points, streakBonus } = shop.loyalty.checkin;
  const commerce = new Commerce(':memory:');
  await runLoop(commerce, shop, { revealSeed: 7 });
  const d1 = await checkin(commerce, shop, { date: '2026-01-05' });
  assert.deepEqual(
    { streak: d1.streak, awarded: d1.awarded, alreadyCheckedIn: d1.alreadyCheckedIn },
    { streak: 1, awarded: points, alreadyCheckedIn: false },
  );
  const d2 = await checkin(commerce, shop, { date: '2026-01-06' });
  assert.equal(d2.streak, 2);
  assert.equal(d2.awarded, points + streakBonus);
  const d3 = await checkin(commerce, shop, { date: '2026-01-07' });
  assert.equal(d3.streak, 3);
  assert.equal(d3.awarded, points + 2 * streakBonus);
});

test('same-day check-in pays nothing; a missed day resets the streak', async () => {
  const shop = readShop('food');
  const commerce = new Commerce(':memory:');
  await runLoop(commerce, shop, { revealSeed: 7 });
  await checkin(commerce, shop, { date: '2026-02-02' });
  const before = (await checkin(commerce, shop, { date: '2026-02-02' }));
  assert.equal(before.alreadyCheckedIn, true);
  assert.equal(before.awarded, 0);
  assert.equal(before.streak, 1);
  const afterGap = await checkin(commerce, shop, { date: '2026-02-04' });
  assert.equal(afterGap.alreadyCheckedIn, false);
  assert.equal(afterGap.streak, 1);
});

test('order earns are not check-ins; unknown databases fail fast', async () => {
  const shop = readShop('food');
  const commerce = new Commerce(':memory:');
  const receipt = await runLoop(commerce, shop, { revealSeed: 7 });
  assert.ok(receipt.loyaltyEarned > 0);
  const first = await checkin(commerce, shop, { date: '2026-03-10' });
  assert.equal(first.streak, 1);
  await assert.rejects(
    checkin(new Commerce(':memory:'), shop, { date: '2026-03-10' }),
    /Launch the shop first/,
  );
  await assert.rejects(
    checkin(commerce, shop, { date: 'not-a-date' }),
    /YYYY-MM-DD/,
  );
});

test('CLI checkin walks a streak across simulated days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dopamine-cli-checkin-'));
  try {
    const db = join(dir, 'food.db');
    const launch = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), 'food', '--db', db], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(launch.status, 0, launch.stderr);
    const run = (date) => spawnSync(
      process.execPath,
      [join(root, 'bin', 'launch.mjs'), 'checkin', 'food', '--db', db, '--date', date],
      { encoding: 'utf8', timeout: 60_000 },
    );
    const d1 = run('2026-04-01');
    assert.equal(d1.status, 0, d1.stderr);
    assert.match(d1.stdout, /Day 1 streak/);
    const again = run('2026-04-01');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Already checked in/);
    const d2 = run('2026-04-02');
    assert.equal(d2.status, 0, d2.stderr);
    assert.match(d2.stdout, /Day 2 streak/);
    const missing = spawnSync(
      process.execPath,
      [join(root, 'bin', 'launch.mjs'), 'checkin', 'food', '--db', join(dir, 'missing.db')],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Launch the shop first/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--list names every launchable shop', () => {
  const result = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), '--list'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['food', 'travel', 'mall', 'gift', 'fit']) {
    assert.match(result.stdout, new RegExp(`^${name}$`, 'm'));
  }
});
