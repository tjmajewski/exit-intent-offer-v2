# ResparQ Onboarding Experience — Design Document

## Overview

When a merchant installs ResparQ, they land on an empty Dashboard with zero data and no guidance. This document describes a thorough but lightweight onboarding experience to get them to their first live modal as fast as possible.

---

## Current App Structure

### Sidebar Navigation (AppLayout.jsx)
- Dashboard (`/app`) — metrics, enable/disable toggle
- Settings (`/app/settings`) — 4 tabs: Quick Setup, AI Settings, Branding, Advanced
- Performance (`/app/analytics`) — PRO+
- Conversions (`/app/conversions`) — PRO+
- Promotions (`/app/promotions`) — ENTERPRISE
- Variants (`/app/variants`) — ENTERPRISE
- Upgrade (`/app/upgrade`) — shown for non-Enterprise

### Plan Tiers
- **Starter** ($29/mo): Manual mode, 1,000 impressions, 1 campaign, basic analytics
- **Pro** ($79/mo): AI mode, 10,000 impressions, evolution system, advanced analytics
- **Enterprise** ($199/mo): Unlimited impressions, promotional intelligence, custom CSS, white-label

### Key Settings a New User Must Configure
1. Choose optimization mode (Manual vs AI)
2. Pick a template (discount, free-shipping, urgency, welcome, reminder)
3. Write modal copy (headline, body, button text)
4. Configure discount (optional — enable, set type/amount, choose code mode)
5. Set trigger conditions (exit intent, time delay)
6. Customize branding (colors, font) — optional but recommended
7. Enable the modal (toggle ON from Dashboard)

---

## Onboarding Approach: Dashboard Checklist + Getting Started Page

Two components work together:

### 1. Dashboard Setup Checklist (dismissible card)

A card at the top of the Dashboard that shows on first install and persists until all steps are done (or the user dismisses it). Uses the existing `exit_intent` metafield namespace to store onboarding state.

#### Checklist Steps

| # | Step | Description | CTA | Completed When |
|---|------|-------------|-----|----------------|
| 1 | Configure your offer | Choose a template and customize your modal copy | "Go to Settings" → `/app/settings` | `settings.modalHeadline` exists and is non-default |
| 2 | Set your discount | Enable a discount and choose percentage or fixed amount | "Set up discount" → `/app/settings` (scrolls to discount section) | `settings.discountEnabled === true` |
| 3 | Choose your trigger | Pick when the modal appears (exit intent, time delay, or both) | "Configure triggers" → `/app/settings` | `settings.exitIntentEnabled || settings.timeDelayEnabled` |
| 4 | Match your brand | Set brand colors so the modal matches your store | "Customize branding" → `/app/settings` tab=branding | `settings.brandPrimaryColor` is set and not the default |
| 5 | Go live! | Enable your modal to start recovering abandoned carts | Toggle button inline | `status.enabled === true` |

#### UI Design
- White card with subtle purple left border, positioned above the metrics grid
- Progress bar showing "2 of 5 complete"
- Each step is a row with: checkbox icon (filled/empty), title, short description, action button
- Completed steps show a green checkmark and are slightly dimmed
- "Dismiss" link in the top-right corner — sets `onboardingDismissed: true` in metafields
- When all 5 are done, the card auto-collapses into a subtle "Setup complete!" success banner that fades after 5 seconds

#### Data Storage
Add to the `exit_intent/settings` metafield:
```json
{
  "onboardingDismissed": false,
  "onboardingCompletedAt": null
}
```

The checklist reads existing settings to determine completion — no separate tracking needed. The only new fields are `onboardingDismissed` (boolean) and `onboardingCompletedAt` (ISO date string, set when all 5 steps are done).

#### Visibility Logic
Show the checklist when ALL of these are true:
- `onboardingDismissed !== true`
- `onboardingCompletedAt` is null
- Not all 5 steps are complete

---

### 2. Getting Started Page (`/app/getting-started`)

A dedicated page accessible from the sidebar nav. This is the "reference guide" — always available, not dismissible.

#### Sidebar Addition
Add between "Dashboard" and "Settings" in `navItems` array in `AppLayout.jsx`:
```javascript
{ path: "/app/getting-started", label: "Getting Started", icon: "guide" }
```

Add a new `guide` icon (book or rocket icon). Once onboarding is complete, this nav item can optionally hide or move to the bottom — but keeping it visible is fine since new merchants may want to reference it later.

#### Page Content

The page should use the same card-based layout as the rest of the app (white cards, `#f9fafb` background, purple accents).

**Section 1: Welcome**
- Headline: "Welcome to ResparQ"
- 1-2 sentences: "ResparQ helps you recover abandoned carts by showing smart exit-intent modals to customers who are about to leave. Here's how to get started."

**Section 2: Quick Start (3 steps)**

Card with 3 numbered steps, each with an illustration area (can be a simple icon or emoji for v1):

1. **Configure your modal**
   - "Go to Settings → Quick Setup to choose a template and write your offer copy. Pick a discount amount that motivates customers to complete their purchase."
   - CTA button: "Open Settings"

2. **Match your brand**
   - "Head to Settings → Branding to set your store's colors. Use 'Auto-detect' to pull colors directly from your store, or set them manually."
   - CTA button: "Open Branding"

3. **Turn it on**
   - "Once you're happy with your settings, flip the toggle on your Dashboard to go live. Your modal will start appearing to customers who show exit intent."
   - CTA button: "Go to Dashboard"

**Section 3: Understanding Your Options**

Expandable/collapsible sections (accordion style):

- **Manual vs AI Mode**
  - Manual: You control everything — template, copy, discount, triggers. Best for stores that want full control or are just getting started.
  - AI Mode (Pro+): The AI automatically tests different headlines, offers, and styles, then evolves toward what converts best. You set the goal and constraints, the AI does the rest.

- **Trigger Types**
  - Exit Intent: Detects when a customer's cursor moves toward the browser's close/back button. Works on desktop; on mobile, triggers on back-button behavior.
  - Time Delay (Pro+): Shows the modal after a customer has been on the cart page for a set number of seconds. Good for catching hesitant shoppers.

- **Discount Codes**
  - Generic: One code for everyone (e.g., SAVE15). Simple, easy to track.
  - Unique: Auto-generated per customer with 24-hour expiry. Creates urgency and prevents code sharing.

- **What happens when a customer sees the modal?**
  1. Customer triggers exit intent (or time delay fires)
  2. Modal appears with your offer
  3. If they click the CTA, the discount code is auto-applied to their cart
  4. They're redirected to checkout (or cart, if configured in Advanced settings)
  5. ResparQ tracks the conversion and attributes revenue

**Section 4: Pro Tips**

Short bullet list:
- Start with a 10-15% discount — it's the sweet spot between conversion and margin
- Enable exit intent first before adding time delay — test one trigger at a time
- Check your Performance tab after 48 hours to see real data
- On Pro+, try AI Mode — it typically outperforms manual after 100+ impressions
- Use the Preview button in Settings to see exactly what customers will see

**Section 5: Need Help?**

- "Email us at [support email] and we'll respond within 24 hours."
- Link to upgrade page if on Starter

---

## Implementation Details

### Files to Create
- `app/routes/app.getting-started.jsx` — Getting Started page route
- `app/components/OnboardingChecklist.jsx` — Dashboard checklist component

### Files to Modify
- `app/components/AppLayout.jsx` — Add "Getting Started" nav item + book/guide icon
- `app/routes/app._index.jsx` — Import and render `OnboardingChecklist` above metrics grid, pass `settings`, `status`, and `plan` as props

### Checklist Component Props
```jsx
<OnboardingChecklist
  settings={settings}    // from loader — has modalHeadline, discountEnabled, etc.
  status={status}        // from loader — has enabled boolean
  plan={plan}            // from loader — has tier
  onDismiss={handleDismissOnboarding}  // sets onboardingDismissed in metafield
/>
```

### Completion Detection Logic
```javascript
const steps = [
  {
    id: 'configure',
    title: 'Configure your offer',
    description: 'Choose a template and customize your modal copy',
    complete: settings?.modalHeadline && settings.modalHeadline !== 'Wait! Before You Go...',
    action: '/app/settings',
    actionLabel: 'Go to Settings'
  },
  {
    id: 'discount',
    title: 'Set your discount',
    description: 'Enable a discount to incentivize checkout completion',
    complete: settings?.discountEnabled === true,
    action: '/app/settings',
    actionLabel: 'Set up discount'
  },
  {
    id: 'trigger',
    title: 'Choose your trigger',
    description: 'Pick when the modal appears to customers',
    complete: settings?.exitIntentEnabled || settings?.timeDelayEnabled,
    action: '/app/settings',
    actionLabel: 'Configure triggers'
  },
  {
    id: 'brand',
    title: 'Match your brand',
    description: 'Set colors so the modal fits your store',
    complete: settings?.brandPrimaryColor && settings.brandPrimaryColor !== '#1a1a2e',
    action: '/app/settings?tab=branding',
    actionLabel: 'Customize branding'
  },
  {
    id: 'golive',
    title: 'Go live!',
    description: 'Enable your modal to start recovering abandoned carts',
    complete: status?.enabled === true,
    action: null,  // inline toggle
    actionLabel: 'Enable'
  }
];
```

### Route Structure for Getting Started
```
app/routes/app.getting-started.jsx
```
- Uses `AppLayout` wrapper like all other pages
- Loader: authenticate admin, load plan metafield (for sidebar badge rendering)
- No action needed — it's read-only
- Uses accordion-style collapsible sections (useState toggle per section)

### Design Tokens (match existing app)
- Card: `background: white, border: 1px solid #e5e7eb, borderRadius: 8, padding: 24`
- Purple accent: `#8B5CF6`
- Text primary: `#1f2937`
- Text secondary: `#666` or `#6b7280`
- Success green: `#10b981`
- Background: `#f9fafb`

---

## What NOT to Build

- No email drip sequence — overkill for v1
- No interactive product tour / tooltip overlay — complex and fragile
- No video embeds — keep it text-based for now
- No separate onboarding "wizard" that blocks the main app — checklist is non-blocking
- No downloadable PDFs — the Getting Started page serves this purpose

---

## Future Enhancements (Post-Launch)

- Animate the progress bar as steps complete
- Show a confetti animation when all 5 steps are done
- Add "Recommended next steps" after onboarding (e.g., "Try AI Mode", "Check your first analytics")
- Track time-to-first-modal-enabled as an internal metric
- A/B test checklist copy to see what drives faster activation
