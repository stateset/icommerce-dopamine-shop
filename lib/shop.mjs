import { Commerce } from '@stateset/embedded';
import { reveal, trackingTheater } from './theater.mjs';

const REQUIRED_TOP = ['name', 'currency', 'customer', 'catalog', 'basket', 'deal', 'loyalty'];
const REQUIRED_DEAL = ['code', 'name', 'percentOff', 'coupon'];
const REQUIRED_LOYALTY = ['program', 'pointsPerDollar'];

export function loadShop(def) {
  for (const key of REQUIRED_TOP) {
    if (def[key] === undefined) throw new Error(`shop.json: missing required key "${key}"`);
  }
  for (const key of REQUIRED_DEAL) {
    if (def.deal[key] === undefined) throw new Error(`shop.json: deal is missing "${key}"`);
  }
  for (const key of REQUIRED_LOYALTY) {
    if (def.loyalty[key] === undefined) throw new Error(`shop.json: loyalty is missing "${key}"`);
  }
  if (!Array.isArray(def.catalog) || def.catalog.length === 0) {
    throw new Error('shop.json: catalog must be a non-empty array');
  }
  if (!Array.isArray(def.basket) || def.basket.length === 0) {
    throw new Error('shop.json: basket must be a non-empty array of {sku, qty}');
  }
  return def;
}

export function openDatabase(path) {
  return new Commerce(path);
}

export async function seed(commerce, shop) {
  const customer = await commerce.customers.findOrCreate({
    email: shop.customer.email,
    firstName: shop.customer.firstName,
    lastName: shop.customer.lastName,
  });
  for (const item of shop.catalog) {
    try {
      await commerce.inventory.createItem({
        sku: item.sku, name: item.name, initialQuantity: item.quantity,
      });
    } catch (error) {
      if (error?.code !== 'CONFLICT') throw error;
    }
  }
  const promo = await commerce.promotions.create({
    code: shop.deal.code,
    name: shop.deal.name,
    promotionType: 'percentage_off',
    trigger: 'coupon_code',
    target: 'order',
    percentageOff: shop.deal.percentOff,
    currency: shop.currency,
  });
  await commerce.promotions.activate(promo.id);
  const coupon = await commerce.promotions.createCoupon({
    promotionId: promo.id, code: shop.deal.coupon,
  });
  const program = await commerce.loyalty.createProgram({
    name: shop.loyalty.program, pointsPerDollar: shop.loyalty.pointsPerDollar,
  });
  const account = await commerce.loyalty.enroll({ customerId: customer.id, programId: program.id });
  return { customer, promo, coupon, program, account };
}

function priceOf(shop, sku) {
  const item = shop.catalog.find((i) => i.sku === sku);
  if (!item) throw new Error(`Basket references unknown SKU "${sku}"`);
  return item;
}

export async function runLoop(commerce, shop, options = {}) {
  const { customer, program, account } = await seed(commerce, shop);

  const cart = await commerce.carts.create({ customerId: customer.id, currency: shop.currency });
  for (const line of shop.basket) {
    const item = priceOf(shop, line.sku);
    await commerce.carts.addItemExact(cart.id, {
      sku: item.sku, name: item.name, quantity: line.qty, unitPrice: item.price,
    });
  }

  const validated = await commerce.promotions.validateCoupon(shop.deal.coupon);
  if (!validated) throw new Error(`Coupon ${shop.deal.coupon} did not validate`);
  const priced = await commerce.carts.applyDiscount(cart.id, shop.deal.coupon);

  const address = shop.shipping ?? {
    firstName: customer.firstName ?? 'Friend',
    lastName: customer.lastName ?? 'Of Dopamine',
    line1: '123 Imagination Lane', city: 'Portland', state: 'OR',
    postalCode: '97205', country: 'US', email: customer.email,
  };
  await commerce.carts.setShippingAddress(cart.id, address);
  await commerce.carts.setShipping(cart.id, {
    shippingAddress: address, shippingMethod: 'instant-imaginary',
    shippingCarrier: 'other', shippingAmountExact: '0.00',
  });
  await commerce.carts.setPayment(cart.id, { paymentMethod: 'card' });
  await commerce.carts.markReadyForPayment(cart.id);
  await commerce.carts.beginCheckout(cart.id);
  const checkout = await commerce.carts.complete(cart.id);
  const order = await commerce.orders.get(checkout.orderId);

  const couponRec = await commerce.promotions.getCouponByCode(shop.deal.coupon);
  await commerce.promotions.recordUsage(
    couponRec.promotionId, couponRec.id, customer.id,
    order.id, cart.id, Number(priced.discountAmountExact), shop.currency,
  );

  const earned = Math.floor(Number(checkout.totalChargedExact) * shop.loyalty.pointsPerDollar);
  await commerce.loyalty.adjustPoints({
    accountId: account.id, points: earned, transactionType: 'earn',
    referenceId: order.id, description: `${shop.name} order`,
  });
  const balance = (await commerce.loyalty.getAccount(account.id)).pointsBalance;

  const mysteryReveal = shop.mysteryBox
    ? reveal(shop.mysteryBox.pool, options.revealSeed ?? Date.now())
    : null;

  return {
    shop: shop.name,
    orderId: order.id,
    orderStatus: order.status,
    items: shop.basket.map((line) => ({ ...line, name: priceOf(shop, line.sku).name })),
    subtotal: priced.subtotalExact,
    discount: priced.discountAmountExact,
    total: checkout.totalChargedExact,
    currency: shop.currency,
    coupon: shop.deal.coupon,
    loyaltyEarned: earned,
    loyaltyBalance: balance,
    mysteryReveal,
    tracking: trackingTheater(shop, order),
  };
}

export function printReceipt(receipt, shop) {
  const lines = [
    `${shop.emoji ?? '✨'} ${receipt.shop} — order ${receipt.orderId.slice(0, 8)}`,
    ...receipt.items.map((i) => `  ${i.qty}× ${i.name}`),
    `  Subtotal: ${receipt.subtotal} ${receipt.currency}`,
    `  ${receipt.coupon}: -${receipt.discount} ${receipt.currency}`,
    `  Total charged (imaginary): ${receipt.total} ${receipt.currency}`,
    `  Loyalty: +${receipt.loyaltyEarned} pts (balance ${receipt.loyaltyBalance})`,
  ];
  if (receipt.mysteryReveal) lines.push(`  🎁 Mystery reveal: ${receipt.mysteryReveal}`);
  for (const step of receipt.tracking) lines.push(`  ${step}`);
  lines.push(`  0 spent. Dopamine delivered.`);
  console.log(lines.join('\n'));
  return lines;
}
