// Click-to-open explainer for admin dashboard metrics: why the chart
// matters, what it shows, and exactly how it's calculated. Definitions
// live in metric-info.js so copy stays in one place.
import { useState, useCallback } from "react";
import { Popover, Button, BlockStack, Text } from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";

export default function InfoPopover({ info }) {
  const [active, setActive] = useState(false);
  const toggle = useCallback(() => setActive((value) => !value), []);

  if (!info) return null;

  return (
    <Popover
      active={active}
      activator={
        <Button
          icon={InfoIcon}
          variant="tertiary"
          size="micro"
          onClick={toggle}
          accessibilityLabel={`About: ${info.title}`}
        />
      }
      onClose={toggle}
      preferredAlignment="left"
    >
      <div style={{ maxWidth: 340, padding: 16 }}>
        <BlockStack gap="300">
          <Text as="h4" variant="headingSm">
            {info.title}
          </Text>
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
              WHY IT MATTERS
            </Text>
            <Text as="p" variant="bodySm">
              {info.importance}
            </Text>
          </BlockStack>
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
              WHAT IT SHOWS
            </Text>
            <Text as="p" variant="bodySm">
              {info.meaning}
            </Text>
          </BlockStack>
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
              HOW IT&apos;S CALCULATED
            </Text>
            <Text as="p" variant="bodySm">
              {info.calculation}
            </Text>
          </BlockStack>
        </BlockStack>
      </div>
    </Popover>
  );
}
