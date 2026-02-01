# Database Maintenance

This guide covers monitoring database size and cleaning up old data to manage storage costs.

## Overview

The app generates data on every modal impression:

| Table | Size/Row | When Created |
|-------|----------|--------------|
| `StarterImpression` | ~800 bytes | Starter tier modal shown |
| `VariantImpression` | ~250 bytes | Pro/Enterprise modal shown |
| `AIDecision` | ~600 bytes | Pro/Enterprise AI decision |
| `DiscountOffer` | ~150 bytes | Discount code generated |

**Estimated growth:** ~30MB per 100 merchants per month

## Monitoring Endpoints

### Check Database Stats

```bash
# Local
curl http://localhost:3000/api/cleanup-old-data

# Production
curl https://your-app.fly.dev/api/cleanup-old-data
```

Returns:
```json
{
  "tables": {
    "shops": 45,
    "starterImpressions": 12500,
    "variantImpressions": 8200,
    "aiDecisions": 8200,
    "discountOffers": 3400,
    "variants": 450,
    "conversions": 890,
    "metaInsights": 120
  },
  "totalRows": 25640,
  "estimatedStorageMB": 18.5,
  "oldestData": {
    "starterImpression": "2025-11-15T10:30:00.000Z",
    "variantImpression": "2025-11-15T10:30:00.000Z",
    "aiDecision": "2025-11-15T10:30:00.000Z"
  },
  "recommendations": []
}
```

### When to Worry

| Metric | Safe | Monitor | Action Needed |
|--------|------|---------|---------------|
| Estimated MB | <100 | 100-500 | >500 |
| StarterImpressions | <50k | 50-100k | >100k |
| Total Rows | <100k | 100-500k | >500k |

The endpoint automatically adds recommendations when thresholds are exceeded.

## Cleanup Endpoints

### Preview Cleanup (Dry Run)

```bash
# See what would be deleted (90 days default)
curl -X POST "https://your-app.fly.dev/api/cleanup-old-data?dryRun=true"

# Custom retention period
curl -X POST "https://your-app.fly.dev/api/cleanup-old-data?dryRun=true&days=60"
```

### Run Cleanup

```bash
# Delete data older than 90 days
curl -X POST https://your-app.fly.dev/api/cleanup-old-data

# Delete data older than 60 days
curl -X POST "https://your-app.fly.dev/api/cleanup-old-data?days=60"
```

Returns:
```json
{
  "retentionDays": 90,
  "cutoffDate": "2025-11-01T00:00:00.000Z",
  "dryRun": false,
  "deleted": {
    "starterImpressions": 5200,
    "variantImpressions": 3100,
    "aiDecisions": 3100,
    "expiredOffers": 890,
    "oldMetaInsights": 45
  },
  "totalDeleted": 12335,
  "errors": []
}
```

## What Gets Cleaned Up

1. **StarterImpressions** - Starter tier learning data older than retention period
2. **VariantImpressions** - Pro/Enterprise tracking data older than retention period
3. **AIDecisions** - AI decision logs older than retention period
4. **DiscountOffers** - Expired, unredeemed discount codes
5. **MetaLearningInsights** - Old insight versions (keeps latest 3 per segment)

**NOT deleted:** Shops, Variants, Conversions (revenue data is preserved)

## Automated Cleanup

### Option 1: Fly.io Scheduled Machine

Add a scheduled machine to run cleanup daily:

```toml
# fly.toml
[processes]
  app = ""
  cleanup = "curl -X POST http://localhost:3000/api/cleanup-old-data"

[[machines]]
  schedule = "0 3 * * *"  # Daily at 3am UTC
  process_group = "cleanup"
```

### Option 2: External Cron Service

Use a free cron service like [cron-job.org](https://cron-job.org):

- **URL:** `https://your-app.fly.dev/api/cleanup-old-data`
- **Method:** POST
- **Schedule:** Daily at 3am

### Option 3: Fly.io CLI

Add to your deployment script:

```bash
# Run cleanup after deploy
fly ssh console -C "curl -X POST http://localhost:3000/api/cleanup-old-data"
```

## Monitoring on Fly.io

### Check Database Size

```bash
# Quick size check
fly postgres connect -a your-db-app -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

# Detailed table sizes
fly postgres connect -a your-db-app -c "
SELECT
  relname as table,
  pg_size_pretty(pg_total_relation_size(relid)) as size,
  n_live_tup as rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
"
```

### Fly.io Dashboard

1. Go to https://fly.io/dashboard
2. Click your Postgres app
3. Check "Metrics" tab for disk usage

## Cost Estimates

### Fly.io Postgres

- **Free tier:** 1GB storage
- **After 1GB:** $0.15/GB/month

### Expected Costs by Scale

| Merchants | Monthly Growth | Annual Storage | Annual Cost |
|-----------|----------------|----------------|-------------|
| 10 | ~3 MB | ~36 MB | Free |
| 100 | ~30 MB | ~360 MB | Free |
| 500 | ~150 MB | ~1.8 GB | ~$1.50/year |
| 1,000 | ~300 MB | ~3.6 GB | ~$5/year |

With 90-day retention cleanup, storage stays flat after 3 months.

## Best Practices

1. **Start with monitoring** - Check stats weekly until you understand your growth rate
2. **Use dry run first** - Always preview cleanup before running
3. **Keep 90 days minimum** - AI learning needs historical data
4. **Schedule during off-peak** - Run cleanup at 3am local time
5. **Monitor after cleanup** - Verify no unexpected data loss

## Troubleshooting

### Cleanup is slow

Large datasets may take time. Check logs:
```bash
fly logs -a your-app | grep Cleanup
```

### Errors in cleanup

Check the `errors` array in the response. Common issues:
- Database connection timeout - retry later
- Table doesn't exist - run `npx prisma db push`

### Storage not decreasing after cleanup

PostgreSQL doesn't immediately reclaim space. Run:
```bash
fly postgres connect -a your-db-app -c "VACUUM FULL;"
```

**Warning:** VACUUM FULL locks tables. Run during maintenance window.
