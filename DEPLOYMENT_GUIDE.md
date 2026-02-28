# Repsarq Deployment Guide - Fly.io

This document covers the complete deployment process for Repsarq on Fly.io with PostgreSQL. Use this as a reference for troubleshooting or future deployments.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Configuration Files](#configuration-files)
4. [Database Setup](#database-setup)
5. [Deployment Process](#deployment-process)
6. [Troubleshooting](#troubleshooting)
7. [Common Issues & Solutions](#common-issues--solutions)
8. [Useful Commands](#useful-commands)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Fly.io Platform                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐             │
│  │   Machine 1     │    │   Machine 2     │             │
│  │ (7847552c4d0418)│    │ (d8d9237a741768)│             │
│  │                 │    │                 │             │
│  │  Node.js App    │    │  Node.js App    │             │
│  │  Port 3000      │    │  Port 3000      │             │
│  └────────┬────────┘    └────────┬────────┘             │
│           │                      │                       │
│           └──────────┬───────────┘                       │
│                      │                                   │
│           ┌──────────▼──────────┐                        │
│           │  Fly Managed        │                        │
│           │  PostgreSQL         │                        │
│           │  (pgbouncer)        │                        │
│           └─────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

**App Details:**
- **App Name:** resparq
- **Region:** iad (Virginia)
- **Hostname:** resparq.fly.dev
- **Machines:** 2 (auto-scaling enabled)

**Database:**
- **Provider:** Fly Managed PostgreSQL
- **Connection:** Via PgBouncer at `pgbouncer.gjpkdonm7j40yln4.flympg.net`
- **Database Name:** fly-db

---

## Prerequisites

### Local Tools Required

```bash
# Install Fly CLI
brew install flyctl

# Install PostgreSQL client (for direct DB access)
brew install libpq
brew link --force libpq

# Verify installations
flyctl version
psql --version
```

### Fly.io Authentication

```bash
flyctl auth login
```

---

## Configuration Files

### 1. fly.toml

Location: `/fly.toml`

```toml
app = 'resparq'
primary_region = 'iad'

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 1
  processes = ['app']

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1

[env]
  NODE_ENV = 'production'
  PORT = '3000'
```

**Key Settings:**
- `auto_stop_machines = 'stop'` - Machines stop when idle (cost saving)
- `auto_start_machines = true` - Machines start on incoming requests
- `min_machines_running = 1` - Always keep at least 1 machine running
- `internal_port = 3000` - App listens on port 3000

### 2. Dockerfile

Location: `/Dockerfile`

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
```

**Critical Notes:**
- `--legacy-peer-deps` is required due to react-router version conflicts
- `openssl` is required for Prisma to connect to PostgreSQL
- Build happens at Docker build time, not runtime

### 3. Prisma Schema

Location: `/prisma/schema.prisma`

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Important:** The schema uses `env("DATABASE_URL")` which is automatically set by Fly.io when you attach a Managed PostgreSQL database.

### 4. Migration Lock

Location: `/prisma/migrations/migration_lock.toml`

```toml
provider = "postgresql"
```

**Note:** This must match the provider in schema.prisma.

### 5. Package.json Scripts

```json
{
  "scripts": {
    "start": "react-router-serve ./build/server/index.js",
    "docker-start": "npm run setup && npm run start",
    "setup": "prisma generate && prisma db push"
  }
}
```

**Critical:** We use `prisma db push` instead of `prisma migrate deploy` because:
- The original migrations were created for SQLite
- SQLite migrations use `DATETIME` type which doesn't exist in PostgreSQL
- `db push` creates the schema directly from schema.prisma without using migration history

---

## Database Setup

### Creating Managed PostgreSQL

```bash
# Create a new Managed PostgreSQL cluster
flyctl mpg create --name resparq --region iad

# Attach it to your app (auto-sets DATABASE_URL)
flyctl mpg attach resparq -a resparq
```

### Connecting to Database

```bash
# Interactive connection
flyctl mpg connect

# Select:
# - Cluster: resparq [gjpkdonm7j40yln4]
# - User: fly-user [schema_admin]
# - Database: fly-db
```

### Common Database Operations

```sql
-- List all tables
\dt

-- Check Prisma migrations table
SELECT * FROM _prisma_migrations;

-- Delete failed migration record (if needed)
DELETE FROM _prisma_migrations WHERE migration_name = 'MIGRATION_NAME';

-- Drop migrations table (nuclear option)
DROP TABLE _prisma_migrations;

-- Exit psql
\q
```

---

## Deployment Process

### Initial Deployment

```bash
# 1. Login to Fly
flyctl auth login

# 2. Create the app (if not exists)
flyctl apps create resparq

# 3. Set secrets
flyctl secrets set \
  SHOPIFY_API_KEY="your_api_key" \
  SHOPIFY_API_SECRET="your_api_secret" \
  SHOPIFY_APP_URL="https://resparq.fly.dev" \
  SCOPES="write_products,write_discounts,read_orders,write_gift_cards" \
  CRON_SECRET="your_cron_secret" \
  -a resparq

# 4. Create and attach PostgreSQL
flyctl mpg create --name resparq --region iad
flyctl mpg attach resparq -a resparq

# 5. Deploy
flyctl deploy -a resparq
```

### Subsequent Deployments

```bash
# Standard deploy (rebuilds and deploys)
flyctl deploy -a resparq

# Deploy with verbose output
flyctl deploy -a resparq --verbose
```

### Verifying Deployment

```bash
# Check app status
flyctl status -a resparq

# Check logs
flyctl logs -a resparq

# Test HTTP response
curl -I https://resparq.fly.dev/
```

---

## Shopify Partner Dashboard Configuration

After deploying to Fly.io, configure the Shopify Partner Dashboard to point to your production URL.

### 1. Access App Configuration

1. Go to https://partners.shopify.com
2. Navigate to **App distribution** → **All apps**
3. Click **View on Dev Dashboard** next to your app
4. Click **Settings** in the left sidebar

### 2. Update URLs

Set the following URLs in **Configuration**:

| Setting | Value |
|---------|-------|
| **App URL** | `https://resparq.fly.dev` |
| **Allowed redirection URL(s)** | `https://resparq.fly.dev/auth/callback` |
| **App proxy URL** | `https://resparq.fly.dev/apps/exit-intent` |

### 3. Verify Scopes

Ensure scopes match what's set in Fly.io secrets:
```
write_discounts,write_gift_cards,read_orders,write_products
```

---

## Installing the App on a Store

### For Development Stores

1. Go to Dev Dashboard → **Dev stores**
2. Click **Log in** next to your dev store
3. Use the OAuth install URL:
   ```
   https://admin.shopify.com/store/YOUR-STORE-NAME/oauth/install?client_id=YOUR_CLIENT_ID
   ```

### Important: Switching from Development to Production

If the app was previously installed using a local dev server (Cloudflare tunnel), you must:

1. **Uninstall** the app from the store:
   - Go to **Settings** → **Apps** in store admin
   - Click **...** next to the app → **Uninstall**

2. **Reinstall** using the production OAuth URL:
   ```
   https://admin.shopify.com/store/YOUR-STORE-NAME/oauth/install?client_id=YOUR_CLIENT_ID
   ```

This ensures the app connects to your Fly.io deployment instead of the old tunnel URL.

### OAuth Errors

If you see "Oops, something went wrong" or "Unauthorized Access":

1. Verify `SHOPIFY_APP_URL` secret matches exactly: `https://resparq.fly.dev`
2. Verify `SHOPIFY_API_SECRET` matches Partner Dashboard (no extra whitespace)
3. Verify redirect URL in Partner Dashboard: `https://resparq.fly.dev/auth/callback`
4. Restart machines after updating secrets: `flyctl machine restart -a resparq`

---

## Troubleshooting

### Issue: Migration Failed (P3009)

**Error:**
```
Error: P3009
migrate found failed migrations in the target database
```

**Solution:**
1. Connect to database:
   ```bash
   flyctl mpg connect
   ```

2. Delete failed migration record:
   ```sql
   DELETE FROM _prisma_migrations WHERE migration_name = 'MIGRATION_NAME';
   ```

3. If migrations keep failing, drop the table:
   ```sql
   DROP TABLE _prisma_migrations;
   ```

4. Restart machines:
   ```bash
   flyctl machine restart -a resparq
   ```

### Issue: Type "datetime" does not exist (P3018)

**Error:**
```
ERROR: type "datetime" does not exist
```

**Cause:** SQLite migrations being applied to PostgreSQL.

**Solution:** Use `prisma db push` instead of `prisma migrate deploy`:

```json
// package.json
"setup": "prisma generate && prisma db push"
```

### Issue: Server-only module referenced by client

**Error:**
```
[commonjs--resolver] Server-only module referenced by client
'../utils/billing.server' imported by route 'app/routes/app.upgrade.jsx'
```

**Solution:** Use dynamic imports inside loader/action functions:

```javascript
// WRONG - top-level import
import { createSubscription } from "../utils/billing.server";

// CORRECT - dynamic import inside function
export async function loader({ request }) {
  const { createSubscription } = await import("../utils/billing.server");
  // ...
}
```

### Issue: Dependency conflicts (ERESOLVE)

**Error:**
```
npm error ERESOLVE could not resolve
```

**Solution:** Add `--legacy-peer-deps` to npm ci in Dockerfile:

```dockerfile
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
```

### Issue: Machines not starting / Stopped

**Cause:** Auto-stop is enabled. Machines start on incoming traffic.

**Solution:** Just send a request:
```bash
curl https://resparq.fly.dev/
```

### Issue: SSH fails - "no started VMs"

**Error:**
```
Error: app resparq has no started VMs
```

**Solution:** Start a machine first:
```bash
curl https://resparq.fly.dev/ &
sleep 10
flyctl ssh console -a resparq
```

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| P3009 - Failed migration | Old failed migration record | Delete from `_prisma_migrations` table |
| P3018 - Type doesn't exist | SQLite migrations on PostgreSQL | Use `prisma db push` |
| Server-only module error | Top-level import of .server file | Use dynamic import |
| ERESOLVE dependency error | Version conflicts | Add `--legacy-peer-deps` |
| Machines stopped | Auto-stop enabled | Send HTTP request to wake |
| SSH connection failed | No running machines | Start machine first |
| Build timeout | Large context transfer | Check `.dockerignore` |

---

## Useful Commands

### App Management

```bash
# Status
flyctl status -a resparq

# Logs (live)
flyctl logs -a resparq

# Logs (specific machine)
flyctl logs -a resparq -i MACHINE_ID

# List machines
flyctl machine list -a resparq

# Restart all machines
flyctl machine restart -a resparq

# Restart specific machine
flyctl machine restart MACHINE_ID -a resparq
```

### Secrets Management

```bash
# List secrets (shows names only, not values)
flyctl secrets list -a resparq

# Set a secret
flyctl secrets set KEY="value" -a resparq

# Remove a secret
flyctl secrets unset KEY -a resparq
```

### Database Management

```bash
# List Managed PostgreSQL clusters
flyctl mpg list

# Connect to database
flyctl mpg connect

# Get connection string (for external tools)
flyctl mpg connection-string resparq
```

### SSH Access

```bash
# Interactive SSH
flyctl ssh console -a resparq

# Run command via SSH
flyctl ssh console -a resparq -C "command here"

# Select specific machine
flyctl ssh console -a resparq -s
```

### Scaling

```bash
# Scale to more machines
flyctl scale count 3 -a resparq

# Scale machine size
flyctl scale vm shared-cpu-2x -a resparq
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Auto-set by Fly |
| `SHOPIFY_API_KEY` | Shopify app API key | From Partner Dashboard |
| `SHOPIFY_API_SECRET` | Shopify app secret | From Partner Dashboard |
| `SHOPIFY_APP_URL` | Public app URL | https://resparq.fly.dev |
| `SCOPES` | Shopify API scopes | write_products,read_orders |
| `CRON_SECRET` | Secret for cron endpoints | Random string |
| `NODE_ENV` | Environment | production |
| `PORT` | Server port | 3000 |

---

## Deployment Checklist

Before deploying, verify:

- [ ] `fly.toml` exists with correct app name
- [ ] `Dockerfile` has `--legacy-peer-deps` flag
- [ ] `prisma/schema.prisma` has `provider = "postgresql"`
- [ ] `prisma/migrations/migration_lock.toml` has `provider = "postgresql"`
- [ ] `package.json` setup script uses `prisma db push`
- [ ] All `.server` files are dynamically imported in routes
- [ ] Secrets are set (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL)
- [ ] PostgreSQL is attached (DATABASE_URL auto-set)

---

## Recovery Procedures

### Complete Database Reset

If the database is corrupted or needs a fresh start:

```bash
# 1. Connect to database
flyctl mpg connect

# 2. Drop all tables
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

# 3. Exit
\q

# 4. Redeploy (will recreate schema)
flyctl deploy -a resparq
```

### Rollback Deployment

```bash
# List recent deployments
flyctl releases -a resparq

# Rollback to previous version
flyctl deploy -a resparq --image registry.fly.io/resparq:PREVIOUS_TAG
```

### Force Restart All Machines

```bash
flyctl machine restart -a resparq --force
```

---

## Contact & Resources

- **Fly.io Documentation:** https://fly.io/docs
- **Prisma Documentation:** https://www.prisma.io/docs
- **Shopify App Development:** https://shopify.dev/docs/apps

---

*Last updated: January 30, 2026*
*Deployment completed successfully after resolving SQLite-to-PostgreSQL migration issues.*
