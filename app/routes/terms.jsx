export default function Terms() {
  return (
    <div style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: '1.6',
      color: '#333'
    }}>
      <h1 style={{ marginBottom: '30px' }}>Terms of Service</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>Last updated: February 2026</p>

      <section style={{ marginBottom: '30px' }}>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By installing or using ResparQ ("the App"), you agree to be bound by these Terms of Service.
          If you do not agree to these terms, do not install or use the App.
        </p>
        <p>
          These terms apply to all merchants who install ResparQ through the Shopify App Store.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>2. Description of Service</h2>
        <p>
          ResparQ is an exit intent and cart recovery application for Shopify stores. The App displays
          personalized modal offers to customers who show signs of abandoning your store, with the goal
          of recovering lost revenue through discount offers and direct checkout flows.
        </p>
        <p>Key features include:</p>
        <ul>
          <li>AI-powered exit intent modals with personalized discount offers</li>
          <li>Evolutionary variant testing (automatic A/B optimization)</li>
          <li>Cart monitoring and threshold-based offers</li>
          <li>Conversion tracking and analytics</li>
          <li>Promotional intelligence (Enterprise plan)</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>3. Subscription Plans and Billing</h2>
        <p>ResparQ offers three subscription tiers, billed monthly through Shopify Billing:</p>
        <ul>
          <li><strong>Starter ($29/month):</strong> 1,000 impressions/month, manual mode, basic triggers</li>
          <li><strong>Pro ($79/month):</strong> 10,000 impressions/month, AI mode, all triggers, analytics</li>
          <li><strong>Enterprise ($199/month):</strong> Unlimited impressions, advanced AI, manual controls, promotional intelligence, custom CSS</li>
        </ul>
        <p>
          All plans include a 14-day free trial. Charges are processed by Shopify and appear on your
          Shopify invoice. Cancellation takes effect at the end of the current billing period.
        </p>
        <p>
          Usage-based charges may apply for commission on recovered revenue, as outlined in your plan
          details at the time of subscription.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>4. Acceptable Use</h2>
        <p>You agree to use ResparQ only for its intended purpose. You may not:</p>
        <ul>
          <li>Use the App to deceive or mislead your customers</li>
          <li>Display offers that violate Shopify's terms of service or applicable laws</li>
          <li>Attempt to reverse-engineer or copy the App's AI or optimization systems</li>
          <li>Use the App on stores that sell prohibited products under Shopify's policies</li>
          <li>Interfere with the App's servers or infrastructure</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>5. Discount Codes and Offers</h2>
        <p>
          ResparQ creates discount codes in your Shopify store as part of its functionality.
          You are responsible for:
        </p>
        <ul>
          <li>Ensuring discount codes comply with your store's policies</li>
          <li>Any financial impact of discounts offered through the App</li>
          <li>Configuring discount amounts and limits appropriately for your margins</li>
        </ul>
        <p>
          ResparQ's AI will attempt to optimize discount amounts, but you retain full control
          over maximum discount limits and can disable discounts at any time.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>6. Data and Privacy</h2>
        <p>
          Your use of ResparQ is also governed by our{' '}
          <a href="/privacy" style={{ color: '#5c6ac4' }}>Privacy Policy</a>,
          which is incorporated into these terms by reference.
        </p>
        <p>
          We collect anonymous behavioral data from your store visitors to power our AI optimization.
          We do not collect personal customer data (names, emails, addresses). See our Privacy Policy
          for full details.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>7. Intellectual Property</h2>
        <p>
          The App, including its AI systems, evolutionary optimization algorithms, and all associated
          code and content, is owned by ResparQ and protected by intellectual property laws.
        </p>
        <p>
          You retain ownership of your store's data and any content you create within the App
          (custom headlines, copy, CSS).
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>8. Disclaimers and Limitation of Liability</h2>
        <p>
          ResparQ is provided "as is" without warranty of any kind. We do not guarantee specific
          conversion rates, revenue increases, or business outcomes.
        </p>
        <p>
          To the maximum extent permitted by law, ResparQ's liability for any claim arising from
          your use of the App is limited to the amount you paid for the App in the three months
          preceding the claim.
        </p>
        <p>
          We are not liable for indirect, incidental, special, or consequential damages, including
          lost profits or revenue.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>9. Termination</h2>
        <p>
          You may terminate your subscription at any time by uninstalling the App from your Shopify store.
          We may suspend or terminate your access if you violate these terms.
        </p>
        <p>
          Upon termination, we will delete your store's data within 48 hours as required by Shopify's
          data protection requirements.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>10. Changes to Terms</h2>
        <p>
          We may update these Terms of Service from time to time. We will notify merchants of
          material changes via email or in-app notification. Continued use of the App after
          changes constitutes acceptance of the updated terms.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>11. Governing Law</h2>
        <p>
          These terms are governed by the laws of the jurisdiction in which ResparQ operates,
          without regard to conflict of law principles.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>12. Contact</h2>
        <p>
          For questions about these Terms of Service, contact us at:<br />
          <strong>Email:</strong> support@resparq.ai<br />
          <strong>Website:</strong> www.resparq.ai
        </p>
      </section>
    </div>
  );
}
