import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDefaultPlan } from "../utils/featureGates";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    // Check if plan already exists
    const checkPlanResponse = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);

    const checkPlanResult = await checkPlanResponse.json();
    const shopId = checkPlanResult.data.shop.id;
    const existingPlan = checkPlanResult.data.shop.plan?.value;

    // If no plan exists, set default plan
    if (!existingPlan) {
      console.log("Setting default plan for new installation");
      
      const defaultPlan = getDefaultPlan();

      await admin.graphql(`
        mutation SetDefaultPlan($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "plan"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(defaultPlan)
        }
      });

      console.log("✓ Default plan set:", defaultPlan.tier);
    } else {
      console.log("✓ Existing plan found");
    }
  } catch (error) {
    console.error("Error setting default plan:", error);
  }

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};