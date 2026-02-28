# Developer Onboarding Guide - Repsarq

Welcome! This guide will help you set up your development environment and understand the Repsarq codebase.

---

## Day 1: Setup

### Prerequisites

Install these before starting:

- **Node.js** 20.19 - 22.12 ([Download](https://nodejs.org/))
- **npm** 9+ (comes with Node.js)
- **Shopify CLI** ([Install guide](https://shopify.dev/docs/apps/tools/cli/installation))
- **Git** (for version control)
- **VS Code** (recommended IDE) or your preferred editor

### Step 1: Clone & Install

```bash
# Clone repository
git clone <repository-url>
cd exit-intent-offer-v2

# Install dependencies
npm install --legacy-peer-deps

# Generate Prisma client
npx prisma generate
```

**Why `--legacy-peer-deps`?**
Some dependencies have peer dependency conflicts. This flag tells npm to ignore them (they still work fine).

---

### Step 2: Set Up Database

```bash
# Initialize database
npm run setup

# This runs:
# - npx prisma migrate dev
# - Creates SQLite database at prisma/dev.db
```

**Check it worked:**
```bash
npm run prisma:studio
```

This opens a browser GUI showing your database. You should see empty tables (Shop, Variant, Conversion, etc.).

---

### Step 3: Configure Shopify App

```bash
# Start development server
npm run dev
```

**First run:** Shopify CLI will ask:
1. "Which Partner organization?" - Select yours
2. "Which app?" - Create new app or select existing
3. "Which store?" - Select development store

Shopify CLI will:
- Create ngrok tunnel
- Register webhooks
- Start local server
- Open app in browser

**Copy the URL** - It looks like: `https://random-string.ngrok.io`

---

### Step 4: Install App on Development Store

1. CLI shows: "Press P to open app in browser"
2. Press `P`
3. Browser opens → Click "Install app"
4. Grant permissions
5. Redirects to dashboard

**Troubleshooting:**
- If install fails, check CLI output for errors
- Try `shopify app dev --reset` to start fresh

---

### Step 5: Enable Theme Extension

1. Go to development store admin
2. **Online Store → Themes → Customize**
3. Click **Theme settings (⚙️)**
4. Scroll to **App embeds**
5. Find **"Exit Intent Modal"**
6. Toggle it **ON**
7. Click **Save**

**This step is critical!** Without it, the modal won't load on the storefront.

---

### Step 6: Test on Storefront

1. Open storefront in browser (store-name.myshopify.com)
2. Add product to cart
3. Move mouse to top of browser (simulates exit intent)
4. Modal should appear!

**If modal doesn't show:**
- Check browser console for errors
- Verify theme extension is enabled
- Check `npm run dev` is still running
- See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## Day 2: Understanding the Codebase

### Architecture Overview

Repsarq is a **full-stack Shopify app**:

```
Frontend (React)          Backend (React Router)      Database (Prisma)
     ↓                            ↓                           ↓
Admin Dashboard UI        Loaders/Actions/APIs          SQLite/PostgreSQL
     ↓                            ↓                           ↓
Settings, Analytics       Business Logic Utils        Shop, Variant, Conversion
```

**Key Directories:**
- `app/routes/` - All pages and API endpoints
- `app/components/` - React components
- `app/utils/` - Business logic (AI, evolution, discounts)
- `extensions/` - Storefront theme extension
- `prisma/` - Database schema and migrations

---

### File Naming Conventions

React Router uses file-based routing:

**Admin Pages:**
- `app._index.jsx` → `/app` (dashboard)
- `app.settings.jsx` → `/app/settings`
- `app.analytics.jsx` → `/app/analytics`

**Public API Endpoints:**
- `apps.exit-intent.api.shop-settings.jsx` → `/apps/exit-intent/api/shop-settings`
- `apps.exit-intent.api.ai-decision.jsx` → `/apps/exit-intent/api/ai-decision`

**Webhooks:**
- `webhooks.orders.create.jsx` → `/webhooks/orders/create`

**Rule:** Dots (`.`) become slashes (`/`) in URLs.

---

### Data Flow Example: Saving Settings

Let's trace how settings are saved:

1. **User clicks "Save" button** (`app/routes/app.settings.jsx`)

```javascript
// Form submits to action function
<form method="post">
  <input name="modalHeadline" value="Wait! Don't leave" />
  <button type="submit">Save Settings</button>
</form>
```

2. **Action function receives form data**

```javascript
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const settings = {
    modalHeadline: formData.get("modalHeadline"),
    modalBody: formData.get("modalBody"),
    // ... other fields
  };
```

3. **Create discount code** (if enabled)

```javascript
  if (settings.discountEnabled) {
    settings.discountCode = await createDiscountCode(
      admin,
      settings.discountPercentage
    );
  }
```

4. **Save to database**

```javascript
  await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: { ...settings },
    create: { shopifyDomain: session.shop, ...settings }
  });
```

5. **Return success response**

```javascript
  return json({ success: true });
}
```

6. **Frontend shows success message**

```javascript
const actionData = useActionData();
if (actionData?.success) {
  alert("Settings saved!");
}
```

---

### Data Flow Example: Showing Modal on Storefront

1. **Page loads** → `exit-intent-modal.js` runs
2. **Fetch settings** → `GET /apps/exit-intent/api/shop-settings?shop=...`
3. **Server queries database** → Returns modal config
4. **JavaScript receives settings** → Stores in `window.exitIntentSettings`
5. **Customer triggers exit** → Mouse moves to top
6. **Modal displays** → Renders with settings

---

## Day 3: Making Your First Change

Let's add a new field to the dashboard.

### Task: Add "Total Clicks" to Dashboard

**Step 1: Update Database Schema**

Edit `prisma/schema.prisma`:

```prisma
model Shop {
  // ... existing fields
  totalClicks Int @default(0)
}
```

**Step 2: Create Migration**

```bash
npx prisma migrate dev --name add_total_clicks
```

**Step 3: Update Dashboard Loader**

Edit `app/routes/app._index.jsx`:

```javascript
export async function loader({ request }) {
  // ... existing code

  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      totalClicks: true, // Add this line
      // ... other fields
    }
  });

  return json({
    stats: {
      clicks: shopRecord.totalClicks, // Add this line
      // ... other stats
    }
  });
}
```

**Step 4: Display in UI**

```javascript
export default function Dashboard() {
  const { stats } = useLoaderData();

  return (
    <div>
      <h2>Total Clicks: {stats.clicks}</h2>
      {/* ... rest of UI */}
    </div>
  );
}
```

**Step 5: Test**

1. Refresh dashboard → Should show "Total Clicks: 0"
2. Open Prisma Studio → Manually set `totalClicks = 42`
3. Refresh dashboard → Should show "Total Clicks: 42"

✅ **You just modified the full stack!**

---

## Key Concepts to Understand

### 1. Authentication

Every admin route needs authentication:

```javascript
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  // admin = Shopify GraphQL client
  // session.shop = "example.myshopify.com"
  // session.accessToken = OAuth token
}
```

**Public API routes don't need authentication** (they use shop domain in request).

---

### 2. Database Access

Always use Prisma client:

```javascript
import db from "../db.server";

// Query
const shop = await db.shop.findUnique({
  where: { shopifyDomain: "example.myshopify.com" }
});

// Create
const conversion = await db.conversion.create({
  data: {
    shopId: shop.id,
    orderNumber: "#1001",
    orderValue: 89.50
  }
});

// Update
await db.shop.update({
  where: { id: shop.id },
  data: { totalClicks: { increment: 1 } }
});
```

**Never write raw SQL!** Use Prisma for type safety and migrations.

---

### 3. Plan-Based Feature Gates

Features are gated by plan tier:

```javascript
import { hasFeature } from "../utils/featureGates";

const canUseAIMode = hasFeature(plan, 'ai'); // Pro, Enterprise
const canUseBranding = hasFeature(plan, 'brandCustomization'); // Enterprise only

{canUseAIMode ? (
  <AISettings />
) : (
  <UpgradePrompt tier="pro" />
)}
```

**Plan tiers:**
- `starter` - $29/mo
- `pro` - $79/mo
- `enterprise` - $299/mo

---

### 4. Evolution System (Enterprise Only)

The genetic algorithm lives in `app/utils/variant-engine.js`:

- **Variants** = Modal configurations with genes
- **Evolution Cycle** = Runs every 5 minutes via cron
- **Fitness** = Performance metric (profit per impression)
- **Selection** = Kill bottom 20%
- **Breeding** = Crossover top 20%
- **Mutation** = Random gene changes

**To test evolution:**
```bash
npm run evolution
```

See [EVOLUTION_SYSTEM.md](./EVOLUTION_SYSTEM.md) for deep dive.

---

### 5. Modal Loading on Storefront

The modal is a **vanilla JavaScript module** (no React on storefront):

**Files:**
- `extensions/exit-intent-modal/snippets/exit-intent-modal.liquid` - Liquid wrapper
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` - Modal logic
- `extensions/exit-intent-modal/assets/cart-monitor.js` - Cart tracking

**Key class:** `ExitIntentModal`

**Triggers:**
- Exit intent (mouse out)
- Time delay (after add-to-cart)
- Cart value (min/max thresholds)

---

## Common Development Tasks

### Adding a New Settings Field

1. Add field to `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add_field`
3. Update `app/routes/app.settings.jsx` loader (read field)
4. Update `app/routes/app.settings.jsx` action (save field)
5. Add form input to UI
6. Test save/load cycle

---

### Creating a New API Endpoint

1. Create file: `app/routes/apps.exit-intent.api.my-endpoint.jsx`
2. Export `loader` (GET) or `action` (POST)
3. Access via `/apps/exit-intent/api/my-endpoint`

**Example:**
```javascript
// app/routes/apps.exit-intent.api.hello.jsx
import { json } from "@remix-run/node";

export async function loader() {
  return json({ message: "Hello!" });
}
```

Test: `curl http://localhost:PORT/apps/exit-intent/api/hello`

---

### Adding a New Database Model

1. Add model to `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add_model`
3. Generate client: `npx prisma generate`
4. Use in code: `await db.myModel.create({ ... })`

---

### Debugging Tips

**View database:**
```bash
npm run prisma:studio
```

**Check logs:**
```bash
# Server logs (in terminal running npm run dev)
# Browser console (F12)
# Shopify CLI logs (in CLI terminal)
```

**Inspect network requests:**
1. Open DevTools (F12)
2. Network tab
3. Trigger action
4. Check request/response

**Common errors:**
- `ECONNREFUSED` = Database not running
- `Not found` = Wrong route name
- `Unauthorized` = Missing authentication
- `Prisma error` = Database schema mismatch (run migrations)

---

## Development Workflow

### Daily Routine

1. **Start dev server:** `npm run dev`
2. **Make changes** to code
3. **Test in browser** (auto-reloads)
4. **Check database** with Prisma Studio
5. **Commit changes:** `git commit -m "Description"`
6. **Push to branch:** `git push origin branch-name`

### Before Committing

- [ ] Code works locally
- [ ] No console errors
- [ ] Database migrations created (if schema changed)
- [ ] Tested in both manual and AI modes
- [ ] Tested in different plan tiers (use dev plan switcher)

---

## Useful Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Build for production

# Database
npm run setup            # Initialize database
npm run prisma:studio    # Open database GUI
npm run prisma:generate  # Generate Prisma client
npx prisma migrate dev   # Create migration

# Testing
npm run evolution        # Test evolution cycle
node test-conversion.js  # Test conversion tracking

# Deployment
npm run deploy           # Deploy to Shopify
```

---

## Resources

### Documentation

- [README.md](./README.md) - Project overview
- [API_REFERENCE.md](./API_REFERENCE.md) - All endpoints
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database models
- [EVOLUTION_SYSTEM.md](./EVOLUTION_SYSTEM.md) - Genetic algorithm
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues

### External Resources

- [Shopify App Docs](https://shopify.dev/docs/apps)
- [React Router Docs](https://reactrouter.com)
- [Prisma Docs](https://www.prisma.io/docs)
- [Shopify CLI Reference](https://shopify.dev/docs/apps/tools/cli)

---

## Getting Help

**Stuck?** Try these in order:

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Search existing documentation
3. Check Shopify CLI logs
4. Inspect browser console
5. Review database in Prisma Studio
6. Ask team for help (include error messages!)

---

## Next Steps

After completing Day 1-3:

- [ ] Read through all documentation files
- [ ] Explore the codebase systematically
- [ ] Make a small feature change
- [ ] Review existing PRs to understand code patterns
- [ ] Set up local testing workflow
- [ ] Understand deployment process

**Welcome to the team!** 🎉

---

**Last Updated:** January 2026
**Maintained by:** Repsarq Development Team
