# Production Cron Job Setup

## Overview
The Exit Intent Offer evolution system requires 3 cron jobs to run automatically:

1. **Evolution Cycle** - Every 5 minutes - Kills poor variants, breeds winners
2. **Gene Aggregation** - Nightly at 12 AM - Network intelligence meta-learning
3. **Seasonal Tracking** - Daily at 2 AM - Records seasonal performance patterns

---

## Heroku Setup

### 1. Install Heroku Scheduler Add-on
```bash
heroku addons:create scheduler:standard
```

### 2. Open Scheduler Dashboard
```bash
heroku addons:open scheduler
```

### 3. Add Jobs

**Evolution Cycle (Every 10 minutes):**
- Frequency: Every 10 minutes
- Command: `npm run evolution`

**Gene Aggregation (Daily at 12 AM UTC):**
- Frequency: Daily at 00:00
- Command: `npm run aggregate-genes`

**Seasonal Tracking (Daily at 2 AM UTC):**
- Frequency: Daily at 02:00
- Command: `npm run track-seasonal`

---

## Vercel Setup

Vercel doesn't support traditional cron jobs, but you can use Vercel Cron (serverless functions).

### 1. Create API Routes for Cron

**Create:** `app/routes/api.cron.evolution.jsx`
```javascript
import { json } from "@remix-run/node";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function action({ request }) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await execAsync("npm run evolution");
    return json({ success: true });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
```

**Create:** `app/routes/api.cron.aggregate-genes.jsx`
```javascript
import { json } from "@remix-run/node";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function action({ request }) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await execAsync("npm run aggregate-genes");
    return json({ success: true });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
```

**Create:** `app/routes/api.cron.seasonal.jsx`
```javascript
import { json } from "@remix-run/node";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function action({ request }) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await execAsync("npm run track-seasonal");
    return json({ success: true });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
```

### 2. Create vercel.json
```json
{
  "crons": [
    {
      "path": "/api/cron/evolution",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/aggregate-genes",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/cron/seasonal",
      "schedule": "0 2 * * *"
    }
  ]
}
```

### 3. Set Environment Variable
```bash
vercel env add CRON_SECRET
# Enter a secure random string
```

---

## AWS Lambda + CloudWatch Events

### 1. Package Each Cron as Lambda Function

**evolution-lambda.js:**
```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

exports.handler = async (event) => {
  try {
    await execAsync('npm run evolution');
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    return { statusCode: 500, body: error.message };
  }
};
```

### 2. Create CloudWatch Rules

**Evolution (Every 5 minutes):**
- Rate expression: `rate(5 minutes)`
- Target: evolution-lambda

**Gene Aggregation (Daily at midnight):**
- Cron expression: `cron(0 0 * * ? *)`
- Target: aggregate-genes-lambda

**Seasonal Tracking (Daily at 2 AM):**
- Cron expression: `cron(0 2 * * ? *)`
- Target: seasonal-lambda

---

## Railway Setup

Railway supports cron jobs natively.

### 1. Add to railway.json
```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE"
  },
  "cron": [
    {
      "schedule": "*/5 * * * *",
      "command": "npm run evolution"
    },
    {
      "schedule": "0 0 * * *",
      "command": "npm run aggregate-genes"
    },
    {
      "schedule": "0 2 * * *",
      "command": "npm run track-seasonal"
    }
  ]
}
```

---

## Render Setup

### 1. Create Cron Jobs in Dashboard

Go to Dashboard → Cron Jobs → New Cron Job

**Evolution Cycle:**
- Name: evolution-cycle
- Command: `npm run evolution`
- Schedule: `*/5 * * * *`

**Gene Aggregation:**
- Name: gene-aggregation
- Command: `npm run aggregate-genes`
- Schedule: `0 0 * * *`

**Seasonal Tracking:**
- Name: seasonal-tracking
- Command: `npm run track-seasonal`
- Schedule: `0 2 * * *`

---

## Testing Cron Jobs

### Local Testing
```bash
# Test evolution cycle
npm run evolution

# Test gene aggregation
npm run aggregate-genes

# Test seasonal tracking
npm run track-seasonal
```

### Monitor Logs
- Check cron job execution in your platform's logs
- Look for `[Evolution]`, `[Meta-Learning]`, `[Seasonal]` prefixes
- Verify variants are being killed/bred
- Check database for updated performance metrics

---

## Troubleshooting

**Cron not running:**
- Check environment variables are set
- Verify database connection string
- Check platform-specific logs

**Evolution not killing variants:**
- Need 100+ impressions since last cycle
- Variants need 50+ impressions to be evaluated
- Check `lastEvolutionCycle` timestamp in database

**Gene aggregation failing:**
- Need 3+ shops with AI mode enabled
- Variants need 10+ impressions to be included
- Check for database connection issues

---

## Monitoring Success

After deployment, verify:
1. Evolution cycle runs every 5 minutes (check logs)
2. Variants show increasing generation numbers (Gen 1, 2, 3...)
3. Gene aggregation updates MetaLearningGene table nightly
4. Seasonal patterns update daily
5. New shops inherit proven genes from network

---

## Production Checklist

- [ ] Cron jobs scheduled
- [ ] Environment variables set
- [ ] Database migrated (PostgreSQL in production)
- [ ] Logs monitored
- [ ] Evolution cycle confirmed working
- [ ] Gene aggregation confirmed working
- [ ] Seasonal tracking confirmed working
- [ ] Dashboard shows real-time variant performance
