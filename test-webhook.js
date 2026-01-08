async function testWebhook() {
  const payload = {
    id: 5432109876543,
    order_number: 1002,
    created_at: new Date().toISOString(),
    total_price: "89.99",
    total_discounts: "9.00",
    customer: {
      id: 123456789,
      email: "customer@example.com"
    },
    discount_codes: [
      {
        code: "10OFF",
        amount: "9.00"
      }
    ],
    line_items: [
      {
        id: 987654321,
        product_id: 111222333,
        title: "Test Product",
        quantity: 1,
        price: "89.99"
      }
    ]
  };

  const response = await fetch('http://localhost:5173/webhooks/orders/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Shop-Domain': 'exit-intent-test-2.myshopify.com', // Replace with your actual shop domain
      'X-Shopify-Topic': 'orders/create'
    },
    body: JSON.stringify(payload)
  });

  console.log('Response status:', response.status);
  const text = await response.text();
  console.log('Response:', text);
}

testWebhook().catch(console.error);