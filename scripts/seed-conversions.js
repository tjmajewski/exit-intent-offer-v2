/**
 * Seed script to populate fake conversions for screenshots
 * Run with: node scripts/seed-conversions.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_DOMAIN = process.env.TEST_SHOP || 'quickstart-f78c9cce.myshopify.com';

async function seedConversions() {
  console.log(`Seeding conversions for shop: ${SHOP_DOMAIN}`);

  // Get or create shop
  let shop = await prisma.shop.findUnique({
    where: { shopifyDomain: SHOP_DOMAIN }
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopifyDomain: SHOP_DOMAIN,
        plan: 'enterprise'
      }
    });
    console.log('Created shop record');
  }

  // Sample product names for realistic data
  const products = [
    'Classic Leather Wallet',
    'Wireless Bluetooth Earbuds',
    'Organic Cotton T-Shirt',
    'Stainless Steel Water Bottle',
    'Minimalist Watch',
    'Canvas Backpack',
    'Running Shoes',
    'Bamboo Sunglasses',
    'Ceramic Coffee Mug',
    'Wool Beanie'
  ];

  // Generate conversions over the last 30 days
  const conversions = [];
  const now = new Date();

  for (let i = 0; i < 15; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const orderedAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const orderValue = (Math.random() * 200 + 30).toFixed(2);
    const discountAmount = (orderValue * (Math.random() * 0.15 + 0.05)).toFixed(2);

    conversions.push({
      shopId: shop.id,
      orderId: `gid://shopify/Order/${5000000000 + i}`,
      orderNumber: `#${1001 + i}`,
      orderValue: parseFloat(orderValue),
      customerEmail: `customer${i + 1}@example.com`,
      orderedAt: orderedAt,
      modalId: 'modal19',
      modalName: 'Exit Intent Offer',
      variantId: `variant_${Math.floor(Math.random() * 10) + 1}`,
      modalHadDiscount: true,
      discountCode: 'SAVE10',
      discountRedeemed: true,
      discountAmount: parseFloat(discountAmount),
      modalSnapshot: JSON.stringify({
        headline: 'Before you go!',
        body: 'Complete your purchase now and get 10% off',
        cta: 'Order Now'
      })
    });
  }

  // Clear existing test conversions for this shop
  await prisma.conversion.deleteMany({
    where: { shopId: shop.id }
  });
  console.log('Cleared existing conversions');

  // Insert new conversions
  for (const conversion of conversions) {
    await prisma.conversion.create({ data: conversion });
  }

  console.log(`Created ${conversions.length} test conversions`);

  // Also seed some impressions for realistic analytics
  const impressionCount = 430;
  const clickCount = 61;

  // Update or create analytics data via metafield-like approach
  // For now, just log what the stats would be
  const totalRevenue = conversions.reduce((sum, c) => sum + c.orderValue, 0);

  console.log('\n--- Screenshot Stats ---');
  console.log(`Revenue Saved: $${totalRevenue.toFixed(2)}`);
  console.log(`Orders Created: ${conversions.length}`);
  console.log(`Times Shown: ${impressionCount}`);
  console.log(`Success Rate: ${((conversions.length / impressionCount) * 100).toFixed(1)}%`);
  console.log(`People Clicked: ${clickCount}`);
  console.log(`Click Rate: ${((clickCount / impressionCount) * 100).toFixed(1)}%`);
  console.log(`Avg Order: $${(totalRevenue / conversions.length).toFixed(2)}`);
}

seedConversions()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error seeding conversions:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
