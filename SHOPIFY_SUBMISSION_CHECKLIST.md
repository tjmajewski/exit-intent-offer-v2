# Shopify App Store Submission Checklist

Use this checklist before submitting your app for Shopify review.

## Pre-Submission Requirements

### 1. Technical Requirements

#### Deployment
- [ ] App deployed to production (Fly.io)
- [ ] Production DATABASE_URL configured
- [ ] All environment variables set on Fly.io
- [ ] SSL certificate working (HTTPS)
- [ ] App accessible at production URL

#### Database
- [ ] PostgreSQL database created on Fly.io
- [ ] Schema migrated (`npx prisma db push`)
- [ ] Cleanup job accessible (`/api/cleanup-old-data`)

#### Webhooks (All Required)
- [x] `app/scopes_update` - Handles scope changes
- [x] `app/uninstalled` - Cleans up session data
- [x] `orders/create` - Tracks conversions
- [x] `customers/data_request` - GDPR data export
- [x] `customers/redact` - GDPR customer deletion
- [x] `shop/redact` - GDPR shop deletion

#### Cron Jobs
- [ ] Evolution cycle scheduled (every 5 minutes)
- [ ] Gene aggregation scheduled (daily)
- [ ] Seasonal tracking scheduled (weekly)
- [ ] Cleanup job scheduled (daily)

### 2. App Configuration

#### shopify.app.toml
- [ ] `application_url` set to production URL (not example.com)
- [ ] `redirect_urls` includes production auth URL
- [ ] All webhook subscriptions registered
- [ ] Correct `api_version` (2026-01 or latest stable)

#### Update Production URLs
```bash
# Update application_url in shopify.app.toml
application_url = "https://resparq.fly.dev"

# Update redirect_urls
redirect_urls = [ "https://resparq.fly.dev/api/auth" ]
```

### 3. Shopify Partner Dashboard

#### App Listing
- [ ] App name finalized
- [ ] App description (short and long)
- [ ] App icon (1024x1024 PNG)
- [ ] Screenshots (minimum 3, desktop + mobile)
- [ ] Feature list
- [ ] Category selected

#### URLs Required
- [ ] App URL (your Fly.io production URL)
- [ ] Privacy policy URL
- [ ] Terms of service URL (optional but recommended)
- [ ] Support email or URL
- [ ] FAQ or documentation URL (optional)

#### Pricing
- [ ] Pricing plans configured in Partner Dashboard
  - Starter: $29/mo
  - Pro: $79/mo
  - Enterprise: $299/mo
- [ ] Free trial period set (if offering)
- [ ] Usage charges configured (if any)

### 4. Testing Before Submission

#### Fresh Install Test
- [ ] Uninstall app from test store
- [ ] Clear all app data from database
- [ ] Reinstall app
- [ ] Verify onboarding flow works
- [ ] Verify default settings applied

#### Core Functionality
- [ ] Modal displays on exit intent
- [ ] Timer trigger works
- [ ] Cart value trigger works
- [ ] Discount codes created in Shopify
- [ ] Discount applies at checkout
- [ ] Conversion tracked when order placed

#### Plan-Specific Features
- [ ] Starter: Manual mode only, basic triggers
- [ ] Pro: AI mode works, all triggers
- [ ] Enterprise: Manual controls, promotional intelligence

#### Edge Cases
- [ ] Modal respects "shown once per session"
- [ ] Budget limits enforced
- [ ] Impression limits enforced (by plan)
- [ ] App works on mobile devices
- [ ] App works on different themes

#### GDPR Testing
- [ ] `customers/data_request` webhook responds 200
- [ ] `customers/redact` webhook deletes customer data
- [ ] `shop/redact` webhook deletes all shop data

### 5. Security Checklist

- [ ] No hardcoded API keys or secrets
- [ ] All secrets in environment variables
- [ ] Webhook authentication working
- [ ] App proxy authentication working
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] Rate limiting on public endpoints

### 6. Performance

- [ ] App loads in < 3 seconds
- [ ] Modal JavaScript < 100KB
- [ ] No console errors in browser
- [ ] Database queries optimized (indexes exist)

---

## Submission Process

### Step 1: Deploy to Production
```bash
# Deploy app
fly deploy

# Verify deployment
curl https://resparq.fly.dev/api/health

# Run database migration
fly ssh console -C "npx prisma db push"
```

### Step 2: Update App Configuration
```bash
# Push config changes to Shopify
npx shopify app config push
```

### Step 3: Deploy Theme Extension
```bash
# Deploy extension
npx shopify app deploy
```

### Step 4: Submit for Review
1. Go to [Shopify Partner Dashboard](https://partners.shopify.com)
2. Select your app
3. Go to "Distribution" → "App Store listing"
4. Complete all required fields
5. Click "Submit for review"

---

## Common Rejection Reasons

### 1. Broken Functionality
- App crashes on install
- Features don't work as described
- Buttons/links are broken

**Prevention:** Test fresh install thoroughly

### 2. GDPR Non-Compliance
- Missing mandatory webhooks
- Data not deleted on request
- No privacy policy

**Prevention:** All GDPR webhooks implemented ✓

### 3. Poor User Experience
- No onboarding guidance
- Confusing interface
- Missing error messages

**Prevention:** Test with someone unfamiliar with the app

### 4. Security Issues
- Exposed API keys
- Missing authentication
- Vulnerable to attacks

**Prevention:** Security audit before submission

### 5. Incomplete Listing
- Missing screenshots
- Vague description
- No support contact

**Prevention:** Complete all listing fields

---

## Post-Submission

### While Waiting for Review
- Monitor app for errors (Sentry/Fly.io logs)
- Don't make major changes
- Respond quickly to reviewer questions

### After Approval
- [ ] Announce launch
- [ ] Monitor first installs closely
- [ ] Set up customer support
- [ ] Track conversion metrics

### If Rejected
1. Read rejection reason carefully
2. Fix ALL mentioned issues
3. Test fixes thoroughly
4. Resubmit with notes on what was fixed

---

## Quick Commands Reference

```bash
# Deploy to Fly.io
fly deploy

# Check logs
fly logs

# SSH into server
fly ssh console

# Push Shopify config
npx shopify app config push

# Deploy theme extension
npx shopify app deploy

# Check webhook subscriptions
npx shopify app webhook list
```

---

## Support Resources

- [Shopify App Review Guidelines](https://shopify.dev/docs/apps/launch/app-review)
- [GDPR Requirements](https://shopify.dev/docs/apps/store/data-protection/gdpr)
- [App Listing Requirements](https://shopify.dev/docs/apps/store/listing)
- [Webhooks Documentation](https://shopify.dev/docs/apps/webhooks)

---

**Last Updated:** February 2026
