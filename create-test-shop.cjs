/**
 * Create a test shop for screenshot data
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'prisma', 'dev.sqlite'));

// Check if a shop already exists
const existingShop = db.prepare('SELECT * FROM Shop LIMIT 1').get();

if (existingShop) {
  console.log('Shop already exists:', existingShop.shopifyDomain);
  db.close();
  process.exit(0);
}

// Create a test shop
const shopId = crypto.randomUUID();
const now = new Date().toISOString();

db.prepare(`
  INSERT INTO Shop (
    id, shopifyDomain, mode, plan, aiGoal, aggression,
    createdAt, updatedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  shopId,
  'demo-store.myshopify.com',
  'manual',
  'starter',
  'revenue',
  5,
  now,
  now
);

console.log('Created test shop: demo-store.myshopify.com');
console.log('Shop ID:', shopId);

// Also create a session for the shop
const sessionId = `offline_demo-store.myshopify.com`;
db.prepare(`
  INSERT INTO Session (
    id, shop, state, isOnline, accessToken
  ) VALUES (?, ?, ?, ?, ?)
`).run(
  sessionId,
  'demo-store.myshopify.com',
  'demo',
  0,
  'demo_access_token'
);

console.log('Created session for shop');

db.close();
