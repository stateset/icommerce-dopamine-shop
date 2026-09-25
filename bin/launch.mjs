#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadShop, openDatabase, printReceipt, runLoop } from '../lib/shop.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shopsDir = join(root, 'shops');

function listShops() {
  return readdirSync(shopsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(join(shopsDir, e.name, 'shop.json')))
    .map((e) => e.name);
}

const args = process.argv.slice(2);
if (args.includes('--list') || args.includes('-l')) {
  console.log(listShops().join('\n'));
  process.exit(0);
}

const name = args.find((a) => !a.startsWith('--'));
if (!name) {
  console.error('Usage: node bin/launch.mjs <shop> [--db <path>] [--email <address>] [--list]');
  console.error(`Available shops: ${listShops().join(', ')}`);
  process.exit(1);
}

const configPath = join(shopsDir, name, 'shop.json');
if (!existsSync(configPath)) {
  console.error(`Unknown shop "${name}". Available shops: ${listShops().join(', ')}`);
  process.exit(1);
}

function flagValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

const shop = loadShop(JSON.parse(readFileSync(configPath, 'utf8')));
const email = flagValue('--email');
if (email) {
  shop.customer = { ...shop.customer, email };
  if (shop.shipping) shop.shipping = { ...shop.shipping, email };
}
const dbPath = resolve(flagValue('--db') ?? join(process.cwd(), `${name}.db`));
if (existsSync(dbPath)) {
  console.error(`${dbPath} already exists. Remove it or pass --db <fresh-path> for a clean launch.`);
  process.exit(1);
}
mkdirSync(dirname(dbPath), { recursive: true });

const commerce = openDatabase(dbPath);
const receipt = await runLoop(commerce, shop);
printReceipt(receipt, shop);
console.log(`Database: ${dbPath}`);
