import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Plan names used by billing.request() and billing.require()
export const BILLING_PLANS = {
  STARTER_MONTHLY: "ResparQ Starter Monthly",
  STARTER_ANNUAL: "ResparQ Starter Annual",
  PRO_MONTHLY: "ResparQ Pro Monthly",
  PRO_ANNUAL: "ResparQ Pro Annual",
  ENTERPRISE_MONTHLY: "ResparQ Enterprise Monthly",
  ENTERPRISE_ANNUAL: "ResparQ Enterprise Annual",
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [BILLING_PLANS.STARTER_MONTHLY]: {
      replacementBehavior: "APPLY_IMMEDIATELY",
      trialDays: 14,
      lineItems: [
        {
          interval: "EVERY_30_DAYS",
          amount: 29,
          currencyCode: "USD",
        },
        {
          interval: "USAGE",
          amount: 500,
          currencyCode: "USD",
          terms: "5% of recovered revenue",
        },
      ],
    },
    [BILLING_PLANS.STARTER_ANNUAL]: {
      replacementBehavior: "APPLY_IMMEDIATELY",
      trialDays: 14,
      lineItems: [
        {
          interval: "ANNUAL",
          amount: 295.80,
          currencyCode: "USD",
        },
      ],
    },
    [BILLING_PLANS.PRO_MONTHLY]: {
      replacementBehavior: "APPLY_IMMEDIATELY",
      trialDays: 14,
      lineItems: [
        {
          interval: "EVERY_30_DAYS",
          amount: 79,
          currencyCode: "USD",
        },
        {
          interval: "USAGE",
          amount: 2000,
          currencyCode: "USD",
          terms: "2% of recovered revenue",
        },
      ],
    },
    [BILLING_PLANS.PRO_ANNUAL]: {
      replacementBehavior: "APPLY_IMMEDIATELY",
      trialDays: 14,
      lineItems: [
        {
          interval: "ANNUAL",
          amount: 805.80,
          currencyCode: "USD",
        },
      ],
    },
    [BILLING_PLANS.ENTERPRISE_MONTHLY]: {
      replacementBehavior: "APPLY_IMMEDIATELY",
      trialDays: 14,
      lineItems: [
        {
          interval: "EVERY_30_DAYS",
          amount: 199,
          currencyCode: "USD",
        },
        {
          interval: "USAGE",
          amount: 5000,
          currencyCode: "USD",
          terms: "1% of recovered revenue",
        },
      ],
    },
    [BILLING_PLANS.ENTERPRISE_ANNUAL]: {
      replacementBehavior: "APPLY_IMMEDIATELY",
      trialDays: 14,
      lineItems: [
        {
          interval: "ANNUAL",
          amount: 2029.80,
          currencyCode: "USD",
        },
      ],
    },
  },
  webhooks: {
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;