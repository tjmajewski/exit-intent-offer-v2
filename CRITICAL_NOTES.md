# Critical App Embed Fix

## Issue: Extension Not Appearing in Theme Customizer

**Date Fixed:** December 23, 2025

### Symptoms
- Extension loads in terminal (`npm run dev` shows it building)
- Does NOT appear in Shopify Theme Customizer → App Embeds
- Cannot enable modal on storefront

### Required Files

**File 1:** `extensions/exit-intent-modal/blocks/exit-intent-app-block.liquid`
```liquid
{% render 'exit-intent-modal' %}

{% schema %}
{
  "name": "Exit Intent Modal",
  "target": "body",
  "settings": [
    {
      "type": "paragraph",
      "content": "This app block enables the exit intent modal on your store."
    }
  ]
}
{% endschema %}
```

**File 2:** `extensions/exit-intent-modal/shopify.extension.toml`
```toml
api_version = "2024-10"
name = "exit-intent-modal"
uid = "149bec6a-746c-0616-8f2d-f6810f0bd373e82dc3e7"
type = "theme"

[[extension_points]]
target = "body"
```

### Why This Works
- The `blocks/` folder contains app blocks that appear in theme customizer
- The `{% schema %}` tag registers the block with Shopify
- `target: "body"` makes it appear in "App embeds" section
- Without these, extension exists but isn't accessible to merchants

### If This Breaks Again
1. Check these two files exist with correct content
2. Run `npm run dev` or `shopify app deploy`
3. Hard refresh theme customizer (Cmd+Shift+R)
4. Look for "Exit Intent Modal" in App embeds

### Reference
This was debugged across multiple sessions. Full context in:
- `/mnt/transcripts/2025-12-22-07-33-03-shopify-exit-intent-offer-types-update.txt`
- GitHub commit: "Fix theme extension registration - add app block"
