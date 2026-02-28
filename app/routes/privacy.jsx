export default function Privacy() {
  return (
    <div style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: '1.6',
      color: '#333'
    }}>
      <h1 style={{ marginBottom: '30px' }}>Privacy Policy</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>Last updated: February 2026</p>

      <section style={{ marginBottom: '30px' }}>
        <h2>Introduction</h2>
        <p>
          Repsarq ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
          explains how we collect, use, and share information when you use our Shopify application.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>Information We Collect</h2>
        <p>When merchants install our app, we collect:</p>
        <ul>
          <li><strong>Store Information:</strong> Shop name, domain, and email address</li>
          <li><strong>Order Data:</strong> Order totals and discount codes used (for conversion tracking)</li>
          <li><strong>App Settings:</strong> Configuration choices made within the app</li>
        </ul>
        <p>From store visitors (your customers), we collect anonymous behavioral signals:</p>
        <ul>
          <li>Cart value and contents</li>
          <li>Device type (mobile/desktop)</li>
          <li>Page views and time on site</li>
          <li>Whether they interacted with our modal</li>
        </ul>
        <p>We do NOT collect personal customer information like names, emails, or addresses.</p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>How We Use Information</h2>
        <p>We use collected information to:</p>
        <ul>
          <li>Provide and improve our exit intent modal service</li>
          <li>Personalize discount offers based on anonymous behavioral signals</li>
          <li>Track conversion performance and generate analytics</li>
          <li>Improve our AI algorithms across all stores (using anonymized, aggregated data)</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>Data Sharing</h2>
        <p>We do not sell your data. We may share information with:</p>
        <ul>
          <li><strong>Service Providers:</strong> Hosting and infrastructure providers (Fly.io)</li>
          <li><strong>Shopify:</strong> As required for app functionality</li>
          <li><strong>Legal Requirements:</strong> When required by law</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>Data Retention</h2>
        <p>
          We retain merchant data for as long as the app is installed. Upon uninstallation,
          we delete all store data within 48 hours as required by Shopify's data protection requirements.
        </p>
        <p>
          Anonymous behavioral data used for AI training is retained for up to 90 days,
          then automatically deleted.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>GDPR Compliance</h2>
        <p>For merchants and customers in the European Union:</p>
        <ul>
          <li>You have the right to access, correct, or delete your data</li>
          <li>You can request a copy of your data at any time</li>
          <li>We respond to all data requests within 30 days</li>
        </ul>
        <p>To exercise these rights, contact us at privacy@resparq.ai</p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>Security</h2>
        <p>
          We implement industry-standard security measures including encrypted data transmission (HTTPS),
          secure database storage, and regular security audits.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. We will notify merchants of significant
          changes via email or in-app notification.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy, please contact us at:<br />
          <strong>Email:</strong> privacy@resparq.ai<br />
          <strong>Website:</strong> www.resparq.ai
        </p>
      </section>
    </div>
  );
}
