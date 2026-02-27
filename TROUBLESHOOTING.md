# Troubleshooting Guide - Repsarq

Common issues and their solutions for Repsarq development and deployment.

---

## Table of Contents

1. [Development Setup Issues](#development-setup-issues)
2. [Modal Not Displaying](#modal-not-displaying)
3. [Discount Code Issues](#discount-code-issues)
4. [Conversion Tracking Issues](#conversion-tracking-issues)
5. [Database Issues](#database-issues)
6. [Evolution System Issues](#evolution-system-issues)
7. [Deployment Issues](#deployment-issues)
8. [Performance Issues](#performance-issues)

---

## Development Setup Issues

### Error: "Command not found: shopify"

**Cause:** Shopify CLI not installed or not in PATH

**Solution:**
```bash
# Install Shopify CLI globally
npm install -g @shopify/cli@latest

# Verify installation
shopify version
```

---

### Error: "npm install fails with peer dependency conflicts"

**Cause:** Some packages have conflicting peer dependencies

**Solution:**
```bash
# Use legacy peer deps flag
npm install --legacy-peer-deps

# Or use npm 8+ which handles peer deps better
npm install --force
```

---

### Error: "Prisma client not generated"

**Symptoms:**
- `Cannot find module '@prisma/client'`
- TypeScript errors about Prisma types

**Solution:**
```bash
# Generate Prisma client
npx prisma generate

# If that doesn't work, try:
rm -rf node_modules/@prisma
npm install
npx prisma generate
```

---

### Error: "Database does not exist"

**Symptoms:**
- `The table 'main.Shop' does not exist`
- Prisma errors about missing tables

**Solution:**
```bash
# Run migrations
npm run setup

# Or manually:
npx prisma migrate dev
```

---

## Modal Not Displaying

### Issue: Modal never shows on storefront

**Checklist:**

1. **Is theme extension enabled?**
   - Go to Theme Customizer → App embeds
   - Verify "Exit Intent Modal" is toggled ON
   - Click Save

2. **Is app enabled in settings?**
   - Check admin dashboard
   - Ensure modal is not disabled

3. **Check browser console**
   - Open DevTools (F12)
   - Look for JavaScript errors
   - Common errors:
     - `Failed to fetch settings` - API endpoint issue
     - `sessionStorage is not defined` - Shopify preview mode (expected)

4. **Verify settings API returns data**
   ```bash
   curl "https://your-store.myshopify.com/apps/exit-intent/api/shop-settings?shop=your-store.myshopify.com"
   ```
   Should return JSON with modal settings.

5. **Check trigger conditions**
   - Exit intent: Move mouse to top of browser
   - Timer: Wait configured seconds after adding to cart
   - Cart value: Ensure cart value is within min/max range

6. **Clear sessionStorage**
   - Modal only shows once per session
   - Open Console: `sessionStorage.clear()`
   - Refresh page

---

### Issue: Modal shows but looks broken

**Symptoms:**
- Modal appears but content is missing
- Styling is off
- CTA button doesn't work

**Solutions:**

1. **Check if custom CSS is breaking layout**
   - Settings → Branding → Custom CSS
   - Temporarily remove all custom CSS
   - Test again

2. **Inspect modal in DevTools**
   - Right-click modal → Inspect
   - Check for CSS conflicts
   - Look for JavaScript errors

3. **Verify headline/body text is set**
   - Settings → Quick Setup
   - Ensure fields are not empty

---

### Issue: Modal only shows in incognito, not normal browser

**Cause:** SessionStorage flag is set from previous test

**Solution:**
```javascript
// In browser console:
sessionStorage.removeItem('exitIntentShown');

// Or clear all:
sessionStorage.clear();
```

---

## Discount Code Issues

### Issue: Discount code not created in Shopify

**Symptoms:**
- Settings save successfully
- But discount doesn't appear in Shopify Admin → Discounts

**Checklist:**

1. **Check app has `write_discounts` permission**
   - Partner Dashboard → App → API access
   - Ensure `write_discounts` scope is granted
   - If not, update SCOPES env var and reinstall app

2. **Check terminal logs**
   ```
   Creating discount code: 10OFF
   ✓ Created new discount code: 10OFF
   ```
   If you see errors, note the error message.

3. **Common errors:**
   - `Discount code already exists` - Normal, app reuses existing codes
   - `Invalid percentage` - Check discount percentage is 1-100
   - `Missing required field` - Check all discount fields are set

4. **Verify in database**
   ```bash
   npm run prisma:studio
   ```
   - Open `Shop` table
   - Check `discountCode` field has value

---

### Issue: Discount not applying at checkout

**Symptoms:**
- Modal shows discount code
- Customer clicks CTA
- Checkout doesn't show discount

**Solutions:**

1. **Verify discount code exists**
   - Shopify Admin → Discounts
   - Search for code (e.g., "10OFF")
   - Check it's active and not expired

2. **Check Cart API application**
   - Open browser console during modal click
   - Should see: `Applying discount code via Cart API: 10OFF`
   - If error, check network tab for `/cart/update.js` request

3. **Test manually**
   - Add item to cart
   - Go to `/cart`
   - Enter discount code manually
   - Click "Apply"
   - If it works manually, issue is with auto-application

4. **Modern Shopify checkout compatibility**
   - URL parameter `?discount=CODE` no longer works
   - Must use Cart API: `POST /cart/update.js`
   - Check modal JavaScript uses Cart API method

---

### Issue: "Code not valid" error at checkout

**Cause:** Discount code doesn't actually exist in Shopify

**Solution:**

1. **Check code verification logic**
   - File: `app/utils/discounts.js`
   - Ensure exact code match verification:
     ```javascript
     const codeExists = nodes.some(node =>
       node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)
     );
     ```

2. **Force re-create code**
   - Delete discount in Shopify Admin
   - Delete `discountCode` from database
   - Save settings again in app
   - Verify new code created

---

## Conversion Tracking Issues

### Issue: Orders not showing in Conversions page

**Checklist:**

1. **Is `orders/create` webhook registered?**
   ```bash
   shopify app webhooks list
   ```
   Should show `orders/create` → Your webhook URL

2. **Check webhook logs**
   - Shopify Admin → Settings → Notifications → Webhooks
   - Click on `orders/create` webhook
   - View recent deliveries
   - Look for errors

3. **Test webhook manually**
   ```bash
   shopify app webhooks trigger --topic=orders/create
   ```

4. **Check database**
   ```bash
   npm run prisma:studio
   ```
   - Open `Conversion` table
   - Check if order exists
   - Verify `shopId` matches

5. **Verify discount code was used**
   - Webhook only creates conversion if discount code matches
   - Check order in Shopify Admin
   - Look at "Discounts" section

---

### Issue: Conversion tracked but revenue is $0

**Cause:** Order value parsing issue

**Solution:**

1. **Check webhook handler**
   - File: `app/routes/webhooks.orders.create.jsx`
   - Verify: `parseFloat(order.total_price)`

2. **Check order object in logs**
   - Add console.log in webhook handler
   - Check what `order.total_price` value is

---

## Database Issues

### Issue: "Table does not exist"

**Error:**
```
The table 'main.Shop' does not exist in the current database
```

**Solution:**
```bash
# Run migrations
npx prisma migrate dev

# If that fails, reset database (dev only!)
npx prisma migrate reset

# Then run setup again
npm run setup
```

---

### Issue: "Unique constraint failed"

**Error:**
```
Unique constraint failed on the constraint: `Shop_shopifyDomain_key`
```

**Cause:** Trying to create Shop record that already exists

**Solution:**
```javascript
// Use upsert instead of create
await db.shop.upsert({
  where: { shopifyDomain: shop },
  update: { /* fields */ },
  create: { shopifyDomain: shop, /* fields */ }
});
```

---

### Issue: Database locked (SQLite only)

**Error:**
```
SQLITE_BUSY: database is locked
```

**Cause:** Multiple processes accessing SQLite

**Solution:**
1. Close Prisma Studio if open
2. Stop all dev servers
3. Restart dev server

**Long-term:** Use PostgreSQL in production (doesn't have locking issues)

---

## Evolution System Issues

### Issue: Variants not being created

**Symptoms:**
- Variants page is empty
- Evolution never runs

**Solutions:**

1. **Check if Enterprise plan**
   - Evolution requires Enterprise tier
   - Use dev plan switcher to switch to Enterprise

2. **Manually initialize variants**
   ```bash
   node -e "
     const db = require('./app/db.server').default;
     const { initializeVariants } = require('./app/utils/variant-engine');
     initializeVariants(db, 'SHOP_ID_HERE');
   "
   ```

3. **Check AI mode enabled**
   - Settings → Quick Setup → Mode = AI

---

### Issue: Evolution cycle never triggers

**Symptoms:**
- Variants created but generation never increases
- No variants being killed/bred

**Checklist:**

1. **Check impression threshold**
   - Need 100+ impressions since last cycle
   - Check `impressionsSinceEvolution` in database

2. **Check cron job is running**
   ```bash
   # Test manually
   npm run evolution
   ```

3. **Check logs for errors**
   - Look for `[Evolution]` prefix in logs
   - Common errors:
     - Database connection issues
     - Insufficient data (< 50 impressions per variant)

---

### Issue: All variants marked as "dead"

**Cause:** Selection pressure too high or fitness calculation error

**Solution:**

1. **Check selection pressure setting**
   - Settings → AI Settings → Selection Pressure
   - Reduce to 0.1 (10%) temporarily

2. **Verify fitness calculation**
   - File: `app/utils/variant-engine.js`
   - Function: `calculateFitness()`
   - Check for divide-by-zero errors

3. **Manually revive variants**
   ```sql
   UPDATE Variant SET status = 'alive' WHERE shopId = 'SHOP_ID';
   ```

---

## Deployment Issues

### Issue: App crashes on startup in production

**Check logs:**
```bash
# Heroku
heroku logs --tail

# Railway
railway logs

# Render
# View in dashboard
```

**Common causes:**

1. **Missing environment variables**
   - Check all required vars are set
   - See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)

2. **Database connection failed**
   - Verify DATABASE_URL is correct
   - Test connection: `npx prisma db pull`

3. **Port binding issue**
   - Ensure app listens on `process.env.PORT`
   - Heroku/Railway set PORT automatically

---

### Issue: Webhooks not working in production

**Symptoms:**
- Conversions not tracked
- Orders not appearing

**Solutions:**

1. **Verify webhook URLs are correct**
   - Shopify Partner Dashboard → App → Webhooks
   - Should point to production domain, not localhost

2. **Check webhook signature verification**
   - File: `app/routes/webhooks.orders.create.jsx`
   - Ensure `authenticate.webhook()` is called

3. **Test webhook delivery**
   - Shopify Admin → Settings → Notifications → Webhooks
   - Click webhook → View recent deliveries
   - Check for 2xx status codes

---

### Issue: Cron jobs not running

**Symptoms:**
- Evolution never happens
- Social proof not updating

**Solutions:**

1. **Verify cron jobs are scheduled**
   - Check platform documentation
   - Heroku: Heroku Scheduler addon
   - Render: Cron Jobs section
   - Railway: railway.json cron configuration

2. **Test cron endpoint manually**
   ```bash
   curl "https://your-app.com/api/cron/social-proof?secret=YOUR_SECRET"
   ```

3. **Check cron secret matches**
   - Environment variable: `CRON_SECRET`
   - URL parameter: `?secret=...`
   - Must be identical

---

## Performance Issues

### Issue: Slow page loads in admin

**Symptoms:**
- Dashboard takes 3+ seconds to load
- Settings page is sluggish

**Solutions:**

1. **Check database queries**
   - Use Prisma query logging
   - Look for N+1 queries

2. **Add database indexes**
   ```prisma
   @@index([shopId])
   @@index([orderedAt])
   ```

3. **Paginate large lists**
   - Conversions: 15 per page
   - Variants: 15 per page

4. **Use select to limit fields**
   ```javascript
   await db.shop.findUnique({
     where: { id },
     select: {
       id: true,
       plan: true,
       // Only fields you need
     }
   });
   ```

---

### Issue: Modal slow to load on storefront

**Symptoms:**
- Modal appears after 2+ second delay
- Customers complain about lag

**Solutions:**

1. **Check API response time**
   ```bash
   curl -w "@curl-format.txt" "https://your-store.com/apps/exit-intent/api/shop-settings?shop=..."
   ```

2. **Optimize shop-settings API**
   - Cache settings in memory
   - Use database instead of metafields
   - Minimize JSON size

3. **Reduce JavaScript bundle size**
   - Check `exit-intent-modal.js` size
   - Target: < 50KB
   - Minify in production

4. **Use CDN**
   - Host JavaScript on CDN
   - Shopify's CDN for theme assets

---

## Getting More Help

If your issue isn't covered here:

1. **Check other documentation**
   - [README.md](./README.md)
   - [API_REFERENCE.md](./API_REFERENCE.md)
   - [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
   - [DEVELOPER_ONBOARDING.md](./DEVELOPER_ONBOARDING.md)

2. **Check Shopify documentation**
   - [Shopify App Development](https://shopify.dev/docs/apps)
   - [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)

3. **Search GitHub Issues**
   - Check if others had the same problem
   - Look for solutions in closed issues

4. **Enable debug logging**
   ```env
   LOG_LEVEL="debug"
   ```

5. **Contact support**
   - Include: Error message, steps to reproduce, screenshots
   - Attach: Logs, network requests, database state

---

**Last Updated:** January 2026
**Maintained by:** Repsarq Development Team
