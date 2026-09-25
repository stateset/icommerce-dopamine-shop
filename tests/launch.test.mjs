import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Commerce } from '@stateset/embedded';
import { loadShop, runLoop } from '../lib/shop.mjs';
import { reveal, trackingTheater } from '../lib/theater.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shopsDir = join(root, 'shops');
const presets = ['food', 'travel', 'mall', 'gift'];

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

test('--list names every launchable shop', () => {
  const result = spawnSync(process.execPath, [join(root, 'bin', 'launch.mjs'), '--list'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['food', 'travel', 'mall', 'gift']) {
    assert.match(result.stdout, new RegExp(`^${name}$`, 'm'));
  }
});
