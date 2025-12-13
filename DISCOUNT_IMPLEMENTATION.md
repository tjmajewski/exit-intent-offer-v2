# Automatic Discount Code Implementation Guide

## Overview

Implement one-click discount application where clicking the modal CTA automatically applies a discount code and redirects to checkout.

---

## Step 1: Add Discount Scope

**File: `shopify.app.toml`**

Add `write_discounts` and `read_orders` scopes:

```toml
scopes = "write_products,write_discounts,read_orders"
```

After changing scopes, you'll need to:
1. Reinstall the app on your dev store
2. Or update the app in Partners dashboard

---

## Step 2: Create Discount Code Function

**File: `app/routes/app.settings.jsx`**

Add this function to create discount codes via GraphQL:

```javascript
async function createDiscountCode(admin, discountPercentage) {
  const discountCode = `EXIT${discountPercentage}`; // e.g., EXIT10
  
  // First check if code already exists
  const checkQuery = `
    query {
      codeDiscountNodes(first: 1, query: "title:'Exit Intent Offer'") {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
      }
    }
  `;
  
  const checkResponse = await admin.graphql(checkQuery);
  const checkResult = await checkResponse.json();
  
  // If code exists, just return it
  if (checkResult.data.codeDiscountNodes.nodes.length > 0) {
    const existingCode = checkResult.data.codeDiscountNodes.nodes[0]
      .codeDiscount.codes.nodes[0].code;
    console.log(`✓ Using existing discount code: ${existingCode}`);
    return existingCode;
  }
  
  // Create new discount code
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: "Exit Intent Offer",
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: {
        all: true
      },
      customerGets: {
        value: {
          percentage: discountPercentage / 100
        },
        items: {
          all: true
        }
      },
      appliesOncePerCustomer: false,
      usageLimit: null // Unlimited uses
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const code = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(`✓ Created new discount code: ${code}`);
  return code;
}
```

---

## Step 3: Update Settings Action to Create Code

**File: `app/routes/app.settings.jsx`**

In your `action` function, after saving settings:

```javascript
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const settings = {
    enabled: formData.get("enabled") === "true",
    offerText: formData.get("offerText"),
    discountPercentage: parseInt(formData.get("discountPercentage")),
    ctaText: formData.get("ctaText"),
    discountCode: null // Will be set below
  };
  
  // Create discount code if percentage is set
  if (settings.discountPercentage > 0) {
    try {
      settings.discountCode = await createDiscountCode(admin, settings.discountPercentage);
    } catch (error) {
      console.error("Failed to create discount code:", error);
      return json({ error: "Failed to create discount code" }, { status: 500 });
    }
  }
  
  // Save settings to metafields (including discount code)
  const mutation = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        namespace: "exit_intent",
        key: "settings",
        type: "json",
        value: JSON.stringify(settings),
        ownerId: `gid://shopify/Shop/${session.shop.split('.')[0]}`
      }
    ]
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();

  if (result.data.metafieldsSet.userErrors.length > 0) {
    return json({ error: result.data.metafieldsSet.userErrors }, { status: 500 });
  }

  return json({ success: true, discountCode: settings.discountCode });
};
```

---

## Step 4: Update Theme Extension to Auto-Apply

**File: `extensions/exit-intent-modal/assets/exit-intent-modal.js`**

Update the CTA click handler:

```javascript
handleCTAClick() {
  const discountCode = this.settings.discountCode;
  
  // Track the click event
  this.trackEvent('click');
  
  // Hide modal immediately
  this.hide();
  
  // Apply discount and redirect to checkout
  if (discountCode) {
    this.applyDiscountAndCheckout(discountCode);
  } else {
    // Fallback: just go to checkout
    window.location.href = '/checkout';
  }
}

applyDiscountAndCheckout(discountCode) {
  // Shopify automatically applies discount with ?discount parameter
  const checkoutUrl = `/checkout?discount=${discountCode}`;
  
  console.log(`Applying discount: ${discountCode}`);
  
  // Redirect to checkout
  window.location.href = checkoutUrl;
}
```

---

## Step 5: Add Order Webhook

**File: `app/shopify.server.js`**

Add webhook configuration:

```javascript
import { DeliveryMethod } from "@shopify/shopify-api";

export const shopify = shopifyApp({
  // ... existing config
  webhooks: {
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
  },
});
```

---

## Step 6: Create Webhook Handler

**File: `app/routes/webhooks.orders.create.jsx`**

```javascript
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  console.log("📦 Order created:", payload.id);
  console.log("Order total:", payload.total_price);

  // Check if our discount code was used
  const discountCodes = payload.discount_codes || [];
  const exitDiscountUsed = discountCodes.find(dc => 
    dc.code && dc.code.startsWith("EXIT")
  );

  if (exitDiscountUsed) {
    const orderValue = parseFloat(payload.total_price);
    console.log(`🎉 Exit intent discount redeemed: ${exitDiscountUsed.code}`);
    console.log(`💰 Order value: $${orderValue}`);
    
    // Update analytics
    try {
      await updateAnalytics(shop, {
        conversions: 1,
        revenue: orderValue
      });
      console.log("✓ Analytics updated");
    } catch (error) {
      console.error("Failed to update analytics:", error);
    }
  }

  return new Response(null, { status: 200 });
};

async function updateAnalytics(shop, updates) {
  // This is similar to your existing trackEvent logic
  // Query current analytics from metafields
  // Increment conversions and add revenue
  // Save back to metafields
  
  // You'll need to import admin and authenticate here
  // Or restructure to pass admin as parameter
  
  // Pseudo-code:
  // const current = await getAnalyticsMetafield(shop);
  // const updated = {
  //   impressions: current.impressions,
  //   clicks: current.clicks,
  //   conversions: current.conversions + updates.conversions,
  //   revenue: current.revenue + updates.revenue
  // };
  // await saveAnalyticsMetafield(shop, updated);
}
```

---

## Step 7: Update Analytics Metafield Structure

Add `conversions` and `revenue` fields to your analytics metafield:

```javascript
{
  impressions: 0,
  clicks: 0,
  closeouts: 0,
  conversions: 0,    // NEW
  revenue: 0         // NEW
}
```

Update your tracking route to initialize these fields if they don't exist.

---

## Step 8: Update Dashboard

**File: `app/routes/app._index.jsx`**

Update loader to include new metrics:

```javascript
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  // Query analytics metafield
  const query = `
    query {
      shop {
        metafield(namespace: "exit_intent", key: "analytics") {
          value
        }
      }
    }
  `;
  
  const response = await admin.graphql(query);
  const result = await response.json();
  
  const analytics = result.data.shop.metafield?.value 
    ? JSON.parse(result.data.shop.metafield.value)
    : {
        impressions: 0,
        clicks: 0,
        closeouts: 0,
        conversions: 0,
        revenue: 0
      };
  
  return json({ analytics });
};
```

Update UI to show revenue:

```jsx
<Card>
  <BlockStack gap="200">
    <Text variant="headingLg">Revenue Recovered</Text>
    <Text variant="heading3xl" as="h2">
      ${analytics.revenue.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      })}
    </Text>
    <Text variant="bodyMd" tone="subdued">
      This month
    </Text>
  </BlockStack>
</Card>

<Card>
  <BlockStack gap="200">
    <Text variant="headingMd">Conversions</Text>
    <Text variant="headingXl">{analytics.conversions}</Text>
    <Text variant="bodySm" tone="subdued">
      {analytics.impressions > 0 
        ? `${((analytics.conversions / analytics.impressions) * 100).toFixed(1)}% conversion rate`
        : '0% conversion rate'}
    </Text>
  </BlockStack>
</Card>

<Card>
  <BlockStack gap="200">
    <Text variant="headingMd">Revenue per Impression</Text>
    <Text variant="headingXl">
      ${analytics.impressions > 0 
        ? (analytics.revenue / analytics.impressions).toFixed(2)
        : '0.00'}
    </Text>
    <Text variant="bodySm" tone="subdued">
      Efficiency metric
    </Text>
  </BlockStack>
</Card>
```

---

## Testing Checklist

### Test 1: Discount Code Creation
1. Start dev server: `npm run dev`
2. Go to Settings page
3. Set discount percentage to 10
4. Save settings
5. Check terminal for log: "✓ Created new discount code: EXIT10"
6. Go to Shopify Admin → Discounts
7. Verify "EXIT10" discount exists

### Test 2: Auto-Apply Works
1. Visit your test store
2. Add item to cart
3. Trigger exit intent (move mouse to top of page)
4. Modal should appear
5. Click CTA button
6. Should redirect to `/checkout?discount=EXIT10`
7. Verify discount is applied in checkout
8. Complete test order (use Shopify's test payment)

### Test 3: Revenue Tracking
1. After completing test order
2. Check terminal logs for webhook: "📦 Order created"
3. Should see: "🎉 Exit intent discount redeemed: EXIT10"
4. Should see: "💰 Order value: $X.XX"
5. Refresh dashboard
6. Verify conversions incremented
7. Verify revenue shows order total

### Test 4: Edge Cases
1. Try using different discount percentage (15%)
2. Should create EXIT15 code
3. Try saving same discount twice
4. Should reuse existing code (check logs)
5. Try completing order without discount
6. Should not increment conversion/revenue

---

## Common Issues

### Issue: "Permission denied" when creating discount
**Solution:** Make sure you reinstalled app after adding `write_discounts` scope

### Issue: Discount not applying at checkout
**Solution:** 
- Check discount code is spelled correctly
- Verify discount is active in Shopify Admin
- Check browser console for errors
- Try manually: `/checkout?discount=EXIT10`

### Issue: Webhook not firing
**Solution:**
- Check webhook is registered: `npm run shopify app webhooks list`
- Check webhook URL is accessible
- Check terminal logs for webhook delivery
- Verify webhook secret is correct

### Issue: Analytics not updating
**Solution:**
- Check webhook handler is receiving order data
- Check discount code is being detected correctly
- Verify metafield update query is successful
- Check for any GraphQL errors in logs

---

## Next Steps After Implementation

1. **Test thoroughly** with multiple orders
2. **Monitor webhook deliveries** in Shopify Admin
3. **Check discount usage** in Shopify analytics
4. **Verify revenue calculations** match Shopify reports
5. **Add error handling** for edge cases
6. **Add UI feedback** when discount is applied
7. **Consider adding**: Discount expiration, usage limits, customer restrictions

---

## Resources

- [Shopify Discount API](https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/discountCodeBasicCreate)
- [Shopify Webhooks](https://shopify.dev/docs/apps/build/webhooks)
- [App Proxy Pattern](https://shopify.dev/docs/apps/online-store/app-proxies)

---

*Last Updated: December 12, 2024*
