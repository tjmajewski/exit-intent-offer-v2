# ResparQ - AI-Powered Exit Intent & Cart Recovery

**Live App:** Exit Intent Offer v2
**Tech Stack:** React Router 7, Node.js, Prisma, SQLite/PostgreSQL, Shopify Admin API
**Version:** Pre-Launch (January 2026)

---

## Overview

ResparQ is a Shopify app that uses AI-powered exit intent modals and cart recovery to convert abandoning visitors into customers. Unlike traditional exit intent tools that focus on email capture, ResparQ delivers **immediate revenue** through intelligently-timed, personalized discount offers.

### Key Features

- **AI Decision Engine** - Analyzes 13+ customer signals to personalize offers
- **Evolutionary Variant System** - Genetic algorithm automatically improves modal performance
- **Promotional Intelligence** - Detects site-wide promos and adjusts strategy
- **Cart Monitoring** - Real-time cart value tracking with threshold offers
- **Manual Controls** - Enterprise users can kill/protect/champion variants
- **Multi-Trigger System** - Exit intent, time delay, cart value thresholds
- **Auto-Applied Discounts** - Seamless checkout integration
- **Meta-Learning** - Cross-store intelligence network

---

## Quick Start

### Prerequisites

- Node.js 20.19 - 22.12
- Shopify Partner Account
- Shopify Development Store
- Shopify CLI installed globally

### Installation

```bash
# Clone repository
git clone <repository-url>
cd exit-intent-offer-v2

# Install dependencies
npm install --legacy-peer-deps

# Set up database
npm run setup

# Start development server
npm run dev
```

### Local PostgreSQL Setup (macOS)

If `npm run dev` fails with database errors, you may need to set up PostgreSQL locally:

```bash
# Install PostgreSQL via Homebrew
brew install postgresql@15
brew services start postgresql@15

# Initialize the database (if needed)
/usr/local/opt/postgresql@15/bin/initdb -D /usr/local/var/postgresql@15

# Create the database
/usr/local/opt/postgresql@15/bin/createdb exit_intent_dev

# Add DATABASE_URL to .env
echo 'DATABASE_URL="postgresql://YOUR_USERNAME@localhost:5432/exit_intent_dev"' >> .env

# Push schema to database
npx prisma db push

# Mark migrations as applied (if using db push instead of migrate)
for dir in prisma/migrations/*/; do name=$(basename "$dir"); npx prisma migrate resolve --applied "$name" 2>/dev/null; done

# Start dev server (with SSL workaround if needed)
NODE_TLS_REJECT_UNAUTHORIZED=0 npx shopify app dev
```

**Common Issues:**
- `DATETIME` errors: The migrations use SQLite syntax. Use `npx prisma db push` instead of `migrate deploy`
- SSL certificate errors: Prefix command with `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Postgres not running: Run `brew services start postgresql@15`

### First-Time Setup

1. **Install app on development store** via the Shopify CLI URL
2. **Enable the theme extension**: Shopify Admin → Online Store → Themes → Customize → App embeds → Enable "Exit Intent Modal"
3. **Configure settings**: App admin → Settings → Set up your first modal
4. **Test on storefront**: Add item to cart, trigger exit intent (move mouse to top of browser)

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Shopify Admin (Embedded)                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │Dashboard │  │ Settings │  │ Analytics │  │Conversions│  │
│  └──────────┘  └──────────┘  └───────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    React Router 7 Backend                    │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐    │
│  │   Loaders   │  │   Actions    │  │  API Routes    │    │
│  │ (Read data) │  │ (Write data) │  │ (Public APIs)  │    │
│  └─────────────┘  └──────────────┘  └────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Business Logic Utilities                │   │
│  │  • AI Decision Engine    • Variant Evolution        │   │
│  │  • Discount Creation     • Meta-Learning            │   │
│  │  • Social Proof         • Promotional Intelligence │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Prisma + Database                         │
│     SQLite (dev) / PostgreSQL (production)                  │
│                                                               │
│  Shops, Variants, Conversions, MetaLearning, Promotions    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Storefront (Theme Extension)                │
│                                                               │
│  exit-intent-modal.js  →  Triggers modal on customer exit   │
│  cart-monitor.js       →  Tracks cart changes               │
│                                                               │
│  Liquid snippet injects settings from database via API      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Customer visits store** → Modal JavaScript loads from theme extension
2. **Settings fetched** → `/apps/exit-intent/api/shop-settings` returns modal config from database
3. **Customer signals collected** → Visit frequency, cart value, device type, etc.
4. **AI decision** → `/apps/exit-intent/api/ai-decision` determines offer (if AI mode)
5. **Modal displays** → Customer sees personalized offer
6. **Tracking** → Impressions, clicks tracked via API
7. **Conversion** → `orders/create` webhook links order to modal
8. **Evolution** → Cron job analyzes performance, breeds better variants

---

## Tech Stack

### Frontend
- **React 18.3.1** - UI library
- **Shopify Polaris** - Admin UI components
- **CSS Modules** - Scoped styling
- **Vanilla JS** - Storefront modal (no dependencies)

### Backend
- **React Router 7** - Full-stack framework
- **Node.js 20.19-22.12** - Runtime
- **Prisma 6.16.3** - ORM
- **SQLite** - Development database
- **PostgreSQL** - Production database (recommended)

### Shopify Integration
- **@shopify/shopify-app-react-router** - App Bridge and authentication
- **Admin GraphQL API** - Discounts, metafields, orders, customers
- **Webhooks** - Order creation, app lifecycle events

### AI & Analytics
- **jstat** - Statistical analysis for variant significance
- **ExcelJS** - Excel export for conversions
- **Custom AI Engine** - Decision logic and evolution system

### DevOps
- **Shopify CLI** - Development and deployment
- **Vite** - Build tool
- **ESLint** - Code linting
- **Sentry** - Error tracking (production)

---

## Project Structure

```
exit-intent-offer-v2/
├── app/
│   ├── routes/                    # React Router routes
│   │   ├── app.*.jsx             # Admin pages (dashboard, settings, analytics)
│   │   ├── apps.exit-intent.api.*.jsx  # Public API endpoints
│   │   └── webhooks.*.jsx        # Webhook handlers
│   ├── components/                # React components
│   │   ├── AppLayout.jsx         # Main admin layout
│   │   └── settings/             # Settings page components
│   ├── utils/                     # Business logic
│   │   ├── ai-decision.js        # AI offer determination
│   │   ├── variant-engine.js     # Evolution system
│   │   ├── gene-pools.js         # Modal content genetics
│   │   ├── meta-learning.js      # Cross-store intelligence
│   │   ├── social-proof.js       # Customer count/ratings
│   │   ├── discount-codes.js     # Discount creation
│   │   └── featureGates.js       # Plan-based feature access
│   ├── cron/                      # Scheduled jobs
│   │   ├── evolution-cycle.js    # Variant evolution (every 5 min)
│   │   ├── aggregate-gene-performance.js  # Meta-learning
│   │   └── track-seasonal-patterns.js     # Seasonal tracking
│   ├── db.server.js              # Prisma client
│   ├── shopify.server.js         # Shopify API config
│   └── root.jsx                  # Root component
├── extensions/
│   └── exit-intent-modal/         # Theme extension
│       ├── blocks/               # App blocks (theme customizer)
│       ├── snippets/             # Liquid templates
│       ├── assets/               # JavaScript bundles
│       │   ├── exit-intent-modal.js    # Main modal logic
│       │   └── cart-monitor.js         # Cart tracking
│       └── shopify.extension.toml      # Extension config
├── prisma/
│   ├── schema.prisma             # Database models
│   └── migrations/               # Migration history
├── public/                        # Static assets
├── docs/                          # Documentation (see below)
├── package.json                  # Dependencies & scripts
├── shopify.app.toml              # App configuration
└── vite.config.js                # Build configuration
```

---

## Documentation

Comprehensive documentation is available in the following files:

### Core Documentation
- **[API_REFERENCE.md](./API_REFERENCE.md)** - All API endpoints and webhooks
- **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** - Database models and relationships
- **[FRONTEND_COMPONENTS.md](./FRONTEND_COMPONENTS.md)** - Component architecture
- **[DEVELOPER_ONBOARDING.md](./DEVELOPER_ONBOARDING.md)** - Getting started guide
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - How to test features
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Production deployment
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions
- **[ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)** - Required env vars

### Feature Documentation
- **[EVOLUTION_SYSTEM.md](./EVOLUTION_SYSTEM.md)** - AI variant evolution deep dive
- **[DISCOUNT_IMPLEMENTATION.md](./DISCOUNT_IMPLEMENTATION.md)** - Discount code system
- **[EXCEL_EXPORT_IMPLEMENTATION.md](./EXCEL_EXPORT_IMPLEMENTATION.md)** - Excel export feature
- **[PLAN_SWITCHER_ARCHITECTURE.md](./PLAN_SWITCHER_ARCHITECTURE.md)** - Plan tier system
- **[SOCIAL_PROOF_README.md](./SOCIAL_PROOF_README.md)** - Social proof system
- **[CAMPAIGN_ARCHITECTURE.md](./CAMPAIGN_ARCHITECTURE.md)** - A/B testing (future)

### Operational Documentation
- **[PRODUCTION-CRON-SETUP.md](./PRODUCTION-CRON-SETUP.md)** - Cron job configuration
- **[DATABASE_MAINTENANCE.md](./DATABASE_MAINTENANCE.md)** - Database cleanup and monitoring
- **[ROADMAP.md](./ROADMAP.md)** - Feature roadmap and launch checklist
- **[REFACTORING_NOTES.md](./REFACTORING_NOTES.md)** - Code refactoring history
- **[CRITICAL_NOTES.md](./CRITICAL_NOTES.md)** - Important fixes and gotchas

---

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start dev server with Shopify CLI
npm run build            # Build for production
npm run setup            # Initialize database

# Database
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Open Prisma Studio GUI

# Cron Jobs (manual testing)
npm run evolution        # Run evolution cycle
npm run aggregate-genes  # Run meta-learning aggregation
npm run track-seasonal   # Track seasonal patterns

# Deployment
npm run deploy           # Deploy app and extension
```

### Development Workflow

1. **Make code changes** in `app/` or `extensions/`
2. **Test in browser** via Shopify CLI URL
3. **Check database** with Prisma Studio (`npm run prisma:studio`)
4. **Run tests** (manual testing for now, see TESTING_GUIDE.md)
5. **Commit changes** with descriptive messages
6. **Push to branch** for review

### Branch Strategy

- `main` - Production-ready code
- `claude/*` - Feature branches created by Claude Code
- Never push directly to `main` without review

---

## Key Concepts

### 1. Plan Tiers

**Starter ($29/mo)**
- 1,000 impressions/month
- Manual mode only
- Basic triggers (exit intent, timer)

**Pro ($79/mo)**
- 10,000 impressions/month
- AI mode with basic optimization
- All triggers
- Conversion tracking

**Enterprise ($299/mo)**
- Unlimited impressions
- Advanced AI with manual controls
- Promotional intelligence
- Brand customization
- Excel exports

### 2. AI Decision Engine

Analyzes 13 customer signals:
- Visit frequency (first-time, returning, frequent)
- Cart value ($0-$1000+)
- Device type (mobile, tablet, desktop)
- Account status (guest, logged-in)
- Traffic source (direct, organic, paid, social, email)
- Time on site (seconds)
- Page views
- Scroll depth
- Abandonment history
- Cart hesitation (time in cart without checkout)
- Product dwell time
- Add-to-cart velocity
- Exit velocity

**Output:** Offer type, discount amount, urgency level, copy tone

### 3. Evolution System

Genetic algorithm that:
- Generates variant "population" (10 per baseline)
- Tracks performance (impressions, clicks, conversions, revenue)
- Kills poor performers (bottom 20%)
- Breeds winners (top 20% crossover + mutation)
- Increases generation number
- Runs every 5 minutes (when 100+ new impressions)

**Genes:** Headline, subhead, CTA, offer amount, urgency, colors, layout, button style

### 4. Meta-Learning

Cross-store intelligence:
- Aggregates anonymous performance data from all shops
- Identifies winning genes across network
- New shops bootstrap with proven variants
- Confidence-weighted recommendations
- Privacy-preserving (no customer data shared)

---

## Testing

### Manual Testing Checklist

**Modal Display:**
- [ ] Exit intent triggers on mouse-out
- [ ] Timer triggers after add-to-cart
- [ ] Cart value threshold triggers correctly
- [ ] Modal only shows once per session
- [ ] Mobile version displays as bottom sheet

**Discount Functionality:**
- [ ] Manual mode creates discount codes in Shopify
- [ ] AI mode generates unique codes
- [ ] Discount applies at checkout
- [ ] Conversion tracked when order placed

**Admin Dashboard:**
- [ ] Dashboard shows correct stats
- [ ] Settings save correctly
- [ ] Analytics display conversion data
- [ ] Plan switcher updates tier (dev only)

**Evolution System:**
- [ ] Variants generate correctly
- [ ] Poor performers get killed
- [ ] Generation number increases
- [ ] Activity feed shows recent events

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for detailed testing procedures.

---

## Deployment

### Production Checklist

- [ ] Environment variables configured
- [ ] Database migrated to PostgreSQL
- [ ] Cron jobs scheduled
- [ ] Error monitoring enabled (Sentry)
- [ ] Load testing completed
- [ ] Webhooks registered
- [ ] Theme extension deployed
- [ ] App listing updated

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for step-by-step instructions.

---

## Troubleshooting

### Common Issues

**Modal not showing:**
- Check theme extension is enabled in customizer
- Verify settings exist in database
- Check browser console for errors
- Ensure sessionStorage not blocked

**Discount not applying:**
- Verify discount code exists in Shopify Admin
- Check discount code in database matches Shopify
- Ensure discount hasn't expired
- Check cart meets minimum requirements

**Conversion not tracking:**
- Verify `orders/create` webhook is active
- Check webhook logs in Shopify Admin
- Ensure discount code used matches database
- Check Conversion table for record

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for comprehensive troubleshooting guide.

---

## Contributing

### Code Style

- Use ESLint for linting
- Follow React best practices
- Keep functions small and focused
- Add comments for complex logic
- Write descriptive commit messages

### Pull Request Process

1. Create feature branch from `main`
2. Make changes and test thoroughly
3. Update documentation if needed
4. Create PR with description
5. Address review feedback
6. Merge when approved

---

## License

Proprietary - All rights reserved

---

## Support

For issues or questions:
- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Review relevant documentation
- Contact: support@resparq.com

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

---

**Last Updated:** January 2026
**Status:** Pre-Launch Development
**Next Milestone:** Production Launch

---

## Quick Links

- [Shopify App Development Docs](https://shopify.dev/docs/apps)
- [React Router Documentation](https://reactrouter.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
