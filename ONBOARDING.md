# Onboarding Checklist

The onboarding checklist guides new merchants through setting up Resparq during their 14-day trial. It appears at the top of the dashboard and tracks progress through 4 setup steps.

## How It Works

When a merchant first opens the app, the checklist appears above the dashboard header. Steps auto-complete as the merchant takes actions (saves settings, enables the modal, etc.). The checklist can be dismissed at any time via the X button, and auto-hides with a success message once all steps are complete.

## Steps by Plan Tier

### Starter

| # | Step | Completion Trigger |
|---|------|--------------------|
| 1 | Install the app in your theme | Merchant clicks "Open Theme Editor" button |
| 2 | Configure your first offer | `modalLibrary.modals.length > 0` (settings saved at least once) |
| 3 | Enable your modal | `status.enabled === true` (dashboard toggle is on) |
| 4 | Get your first impression | `analytics.impressions > 0` (lifetime or 30-day) |

### Pro / Enterprise

| # | Step | Completion Trigger |
|---|------|--------------------|
| 1 | Install the app in your theme | Merchant clicks "Open Theme Editor" button |
| 2 | Configure AI decisioning | `settings.mode === "ai"` (AI mode selected and saved) |
| 3 | Enable your modal | `status.enabled === true` (dashboard toggle is on) |
| 4 | Get your first impression | `analytics.impressions > 0` (lifetime or 30-day) |

## Storage

The checklist uses a dedicated Shopify metafield:

- **Namespace:** `exit_intent`
- **Key:** `onboarding`
- **Type:** `json`

```json
{
  "themeEditorClicked": false,
  "dismissed": false
}
```

Only two fields are stored explicitly:
- `themeEditorClicked` — Set to `true` when the merchant clicks the "Open Theme Editor" action button. Cannot be inferred from other data since we can't detect if the theme extension is actually enabled.
- `dismissed` — Set to `true` when the merchant clicks the X button to hide the checklist.

All other step completions are derived from existing data at load time:
- **Configure offer:** Derived from `exit_intent/modal_library` metafield
- **Configure AI:** Derived from `exit_intent/settings` metafield (`mode` field)
- **Enable modal:** Derived from `exit_intent/status` metafield
- **First impression:** Derived from `exit_intent/analytics` metafield

## Key Files

| File | Role |
|------|------|
| `app/components/OnboardingChecklist.jsx` | UI component with step definitions, rendering, and action buttons |
| `app/routes/app._index.jsx` | Dashboard loader (reads onboarding metafield), action handler (writes updates), renders checklist |

## Dismissal Behavior

- The X button submits `actionType: "onboardingAction"` with `onboardingField: "dismissed"` and `onboardingValue: "true"`
- Once dismissed, the checklist does not reappear (persisted in metafield)
- If all steps are complete, the checklist shows a brief success message instead of hiding immediately

## Testing / Resetting Onboarding

To reset the onboarding checklist for a shop, delete or update the `exit_intent/onboarding` metafield via the Shopify Admin API:

```graphql
mutation ResetOnboarding($ownerId: ID!) {
  metafieldsSet(metafields: [{
    ownerId: $ownerId
    namespace: "exit_intent"
    key: "onboarding"
    value: "{\"themeEditorClicked\": false, \"dismissed\": false}"
    type: "json"
  }]) {
    metafields { id }
  }
}
```

To simulate a fresh merchant, also clear the `settings`, `status`, `modal_library`, and `analytics` metafields.
