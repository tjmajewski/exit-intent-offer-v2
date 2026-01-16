# Social Proof System

## Overview
Automatically displays customer counts and ratings in exit intent modals to build trust.

## How It Works

1. **Data Collection**: Fetches order count, customer count, and ratings from Shopify
2. **Formatting**: Formats numbers nicely (5000 → "5k+", 4.8 → "4.8★")
3. **Gene Selection**: Variants randomly use social proof genes if shop qualifies
4. **Placeholder Replacement**: `{{social_proof_count}}` → "5k+", `{{rating}}` → "4.8"

## Merchant Settings

Located in: **Settings → AI Settings → Social Proof Settings**

- Enable/disable social proof
- Choose metric type (orders/customers/reviews)
- Set minimum threshold (default: 100)
- Refresh metrics manually

## Data Collection

### Manual Refresh
Click "Refresh Metrics Now" button in settings

### Automatic (Cron)
Set up a daily cron job to call:
```
GET /api/cron/social-proof?secret=YOUR_CRON_SECRET
```

Recommended services:
- EasyCron (easycron.com)
- GitHub Actions
- Render Cron Jobs

## Testing

Run the test suite:
```bash
node test-social-proof.js
```

## Database Fields

Added to `Shop` model:
- `orderCount` - Total orders
- `customerCount` - Total customers  
- `avgRating` - Average rating (4.0-5.0)
- `reviewCount` - Total reviews
- `socialProofEnabled` - Enable/disable
- `socialProofType` - orders/customers/reviews
- `socialProofMinimum` - Minimum to show (default: 100)
- `socialProofUpdatedAt` - Last update timestamp

## Gene Pools

Each baseline now has two gene arrays:
- `headlines` - Regular headlines
- `headlinesWithSocialProof` - Headlines with `{{placeholders}}`
- `subheads` - Regular subheads
- `subheadsWithSocialProof` - Subheads with `{{placeholders}}`

## Cache

Social proof data is cached for 1 hour in memory to avoid DB hits on every variant creation.

## Future Enhancements

- [ ] Integration with Judge.me API for real review data
- [ ] Integration with Yotpo API
- [ ] Integration with Shopify Product Reviews
- [ ] Real-time updates via webhooks
- [ ] A/B test social proof vs. no social proof effectiveness
