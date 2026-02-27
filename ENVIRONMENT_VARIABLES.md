# Environment Variables - Repsarq

Complete reference for all environment variables required and optional for Repsarq.

---

## Required Variables

These variables **must** be set for the app to function.

### DATABASE_URL

**Description:** Database connection string

**Required:** Yes

**Default:** `file:./prisma/dev.db` (development)

**Development:**
```env
DATABASE_URL="file:./prisma/dev.db"
```

**Production (PostgreSQL):**
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require&connection_limit=10"
```

**Production (MySQL):**
```env
DATABASE_URL="mysql://user:password@host:3306/dbname"
```

---

### SHOPIFY_API_KEY

**Description:** Shopify App API key (from Partner Dashboard)

**Required:** Yes

**Where to find:**
1. Shopify Partner Dashboard
2. Apps → Your App → App settings
3. Copy "Client ID"

**Format:**
```env
SHOPIFY_API_KEY="1234567890abcdef"
```

---

### SHOPIFY_API_SECRET

**Description:** Shopify App API secret

**Required:** Yes

**Where to find:**
1. Shopify Partner Dashboard
2. Apps → Your App → App settings
3. Click "Show" next to "Client secret"

**Format:**
```env
SHOPIFY_API_SECRET="shpss_REPLACE_WITH_YOUR_SECRET_KEY_HERE"
```

**Security:** Never commit this to Git! Add `.env` to `.gitignore`.

---

### SHOPIFY_APP_URL

**Description:** Your app's public URL

**Required:** Yes (production), No (development, Shopify CLI handles this)

**Development:**
```env
# Shopify CLI creates ngrok tunnel automatically
# No need to set this
```

**Production:**
```env
SHOPIFY_APP_URL="https://your-app.herokuapp.com"
```

or
```env
SHOPIFY_APP_URL="https://your-domain.com"
```

---

### SCOPES

**Description:** Shopify API permissions your app needs

**Required:** Yes

**Default (recommended):**
```env
SCOPES="read_products,write_discounts,read_orders,read_customers,read_script_tags,write_script_tags"
```

**Permissions breakdown:**
- `read_products` - View products (for cart value detection)
- `write_discounts` - Create discount codes
- `read_orders` - Track conversions
- `read_customers` - Customer analytics
- `read_script_tags` - Check installed scripts
- `write_script_tags` - Install modal JavaScript (legacy, not currently used)

---

## Optional Variables

These variables are optional but recommended for production.

### NODE_ENV

**Description:** Deployment environment

**Required:** No

**Default:** `development`

**Values:**
- `development` - Local development
- `production` - Production deployment

**Effect:**
- In production: Hides dev plan switcher
- In production: Enables performance optimizations
- In production: Disables verbose logging

**Production:**
```env
NODE_ENV="production"
```

---

### SENTRY_DSN

**Description:** Sentry error tracking DSN

**Required:** No (but recommended for production)

**Where to get:**
1. Create account at [sentry.io](https://sentry.io)
2. Create new project
3. Copy DSN from project settings

**Format:**
```env
SENTRY_DSN="https://abc123@o123456.ingest.sentry.io/123456"
```

**Effect:** Enables error tracking and session replay in production.

---

### CRON_SECRET

**Description:** Secret key for authenticating cron job requests

**Required:** No (but recommended for production)

**Generate:**
```bash
openssl rand -base64 32
```

**Format:**
```env
CRON_SECRET="your-random-secret-key-here"
```

**Usage:** Protects cron endpoints from unauthorized access:
```
GET /api/cron/social-proof?secret=your-random-secret-key-here
```

---

### PORT

**Description:** Server port

**Required:** No

**Default:** `3000` (React Router default)

**Production (Railway, Heroku):**
```env
PORT="8080"
```

Usually set automatically by hosting platform.

---

### LOG_LEVEL

**Description:** Logging verbosity

**Required:** No

**Default:** `info`

**Values:**
- `debug` - All logs (verbose)
- `info` - Info and above (recommended)
- `warn` - Warnings and errors only
- `error` - Errors only

**Development:**
```env
LOG_LEVEL="debug"
```

**Production:**
```env
LOG_LEVEL="warn"
```

---

## Platform-Specific Variables

### Heroku

Heroku automatically sets:
- `DATABASE_URL` (when Postgres add-on attached)
- `PORT`

You need to manually set:
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `NODE_ENV="production"`

**Set variables:**
```bash
heroku config:set SHOPIFY_API_KEY="1234567890abcdef"
heroku config:set SHOPIFY_API_SECRET="shpss_..."
heroku config:set SHOPIFY_APP_URL="https://your-app.herokuapp.com"
heroku config:set SCOPES="read_products,write_discounts,..."
heroku config:set NODE_ENV="production"
```

---

### Railway

Railway automatically sets:
- `DATABASE_URL` (when database attached)
- `PORT`

You need to manually set same variables as Heroku.

**Set variables:**
1. Railway Dashboard → Your Project
2. Variables tab
3. Add each variable

---

### Vercel

Vercel requires all variables manually set:
- `DATABASE_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `NODE_ENV`

**Set variables:**
```bash
vercel env add DATABASE_URL
vercel env add SHOPIFY_API_KEY
# ... etc
```

or via Vercel Dashboard → Settings → Environment Variables

---

### Render

Render requires all variables manually set.

**Set variables:**
1. Render Dashboard → Your Service
2. Environment tab
3. Add environment variables

---

## Example .env Files

### Development (.env.local)

```env
# Database (SQLite for local dev)
DATABASE_URL="file:./prisma/dev.db"

# Shopify App Credentials
SHOPIFY_API_KEY="1234567890abcdef"
SHOPIFY_API_SECRET="shpss_REPLACE_WITH_YOUR_SECRET_KEY_HERE"

# Scopes
SCOPES="read_products,write_discounts,read_orders,read_customers"

# Environment
NODE_ENV="development"
LOG_LEVEL="debug"
```

---

### Production (.env.production)

```env
# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"

# Shopify App Credentials
SHOPIFY_API_KEY="1234567890abcdef"
SHOPIFY_API_SECRET="shpss_REPLACE_WITH_YOUR_SECRET_KEY_HERE"

# App URL
SHOPIFY_APP_URL="https://your-app.herokuapp.com"

# Scopes
SCOPES="read_products,write_discounts,read_orders,read_customers"

# Environment
NODE_ENV="production"
LOG_LEVEL="warn"

# Error Tracking
SENTRY_DSN="https://abc123@o123456.ingest.sentry.io/123456"

# Cron Authentication
CRON_SECRET="your-random-secret-key-here"
```

---

## Security Best Practices

### Never Commit Secrets

Add to `.gitignore`:
```
.env
.env.local
.env.production
.env.*.local
```

---

### Use Environment-Specific Files

- `.env.local` - Local development (gitignored)
- `.env.production` - Production secrets (never commit)
- `.env.example` - Template (safe to commit, no real values)

**Create .env.example:**
```env
DATABASE_URL="file:./prisma/dev.db"
SHOPIFY_API_KEY="your-api-key-here"
SHOPIFY_API_SECRET="your-api-secret-here"
SCOPES="read_products,write_discounts,read_orders"
NODE_ENV="development"
```

Commit this so other developers know what variables are needed.

---

### Rotate Secrets Regularly

- Regenerate `SHOPIFY_API_SECRET` every 90 days
- Regenerate `CRON_SECRET` every 90 days
- Update in Partner Dashboard and deployment platform

---

### Use Secrets Management

**For production, consider:**
- **HashiCorp Vault** - Centralized secrets management
- **AWS Secrets Manager** - AWS-hosted secrets
- **Doppler** - Developer secrets management
- **Platform built-in** - Railway/Vercel/Heroku secrets

---

## Troubleshooting

### "Missing required environment variable"

**Error:**
```
Error: Missing SHOPIFY_API_KEY environment variable
```

**Solution:**
1. Check `.env` file exists in project root
2. Ensure variable is spelled correctly
3. Restart dev server (`npm run dev`)
4. In production, check platform environment variables

---

### "Invalid database URL"

**Error:**
```
Prisma error: Invalid DATABASE_URL
```

**Solution:**
1. Check DATABASE_URL format matches your database type
2. Ensure database server is running
3. Test connection: `npx prisma db pull`
4. Check for typos in username/password/host

---

### "Unauthorized" errors in production

**Possible cause:** `SHOPIFY_API_SECRET` mismatch

**Solution:**
1. Verify secret in Partner Dashboard matches deployed secret
2. Ensure no extra whitespace in environment variable
3. Redeploy after updating secrets

---

### Cron jobs failing with 401

**Possible cause:** `CRON_SECRET` mismatch

**Solution:**
1. Check secret in deployment platform
2. Update cron service URL with correct secret
3. Test: `curl "https://your-app.com/api/cron/social-proof?secret=YOUR_SECRET"`

---

## Validation Script

Create `scripts/validate-env.js`:

```javascript
const requiredVars = [
  'DATABASE_URL',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SCOPES'
];

const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`  - ${varName}`));
  process.exit(1);
}

console.log('✅ All required environment variables are set');
```

Run: `node scripts/validate-env.js`

---

**Last Updated:** January 2026
**Related Docs:** [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md), [DEVELOPER_ONBOARDING.md](./DEVELOPER_ONBOARDING.md)
