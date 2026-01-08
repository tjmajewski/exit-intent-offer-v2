import { json } from "@remix-run/node";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get URL params for date filtering
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d";

  // Find shop record
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: shop }
  });

  if (!shopRecord) {
    return json({ conversions: [], plan: null, range });
  }

  // Calculate date range
  const now = new Date();
  let startDate;
  
  if (range === "7d") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "30d") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // "all" - get all conversions
    startDate = new Date(0);
  }

  // Fetch conversions
  const conversions = await db.conversion.findMany({
    where: {
      shopId: shopRecord.id,
      orderedAt: {
        gte: startDate
      }
    },
    orderBy: {
      orderedAt: 'desc'
    }
  });

  return json({
    conversions,
    plan: shopRecord.plan,
    range,
    shop
  });
};

export default function Conversions() {
  const { conversions, plan, range, shop } = useLoaderData();
  const [selectedConversion, setSelectedConversion] = useState(null);

  // Tier access control
  const canAccess = plan === "pro" || plan === "enterprise";
  const canExport = plan === "enterprise";

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Format time
  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Format currency
  const formatCurrency = (amount) => {
    return `$${amount.toFixed(2)}`;
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Date', 'Time', 'Order #', 'Customer Email', 'Order Value', 'Modal Had Discount', 'Discount Redeemed', 'Discount Amount'];
    const rows = conversions.map(c => [
      formatDate(c.orderedAt),
      formatTime(c.orderedAt),
      c.orderNumber,
      c.customerEmail || 'N/A',
      c.orderValue,
      c.modalHadDiscount ? 'Yes' : 'No',
      c.modalHadDiscount ? (c.discountRedeemed ? 'Yes' : 'No') : 'N/A',
      c.modalHadDiscount && c.discountAmount ? c.discountAmount : 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exit-intent-conversions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Locked state for Starter
  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Conversions</h1>
          <p style={{ color: '#6b7280' }}>Track every order that came through after seeing your modal</p>
        </div>

        <div style={{
          background: 'white',
          padding: 48,
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          textAlign: 'center'
        }}>
          <div style={{
            display: 'inline-block',
            padding: '4px 12px',
            background: '#f3f4f6',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 16,
            color: '#6b7280'
          }}>
            PRO
          </div>
          <h2 style={{ fontSize: 24, marginBottom: 12 }}>Order-Level Tracking</h2>
          <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
            See every order that converted after seeing your modal. Perfect for validating ROI with your finance team.
          </p>
          <button
            type="button"
            onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
            style={{
              padding: '12px 24px',
              background: '#8B5CF6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Conversions</h1>
          <p style={{ color: '#6b7280' }}>
            {conversions.length} order{conversions.length !== 1 ? 's' : ''} in the last {range === '7d' ? '7 days' : range === '30d' ? '30 days' : 'all time'}
          </p>
        </div>

        {canExport && conversions.length > 0 && (
          <button
            onClick={exportToCSV}
            style={{
              padding: '10px 20px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Export to CSV
          </button>
        )}
      </div>

      {/* Date Range Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: 8, 
        borderBottom: '2px solid #e5e7eb',
        marginBottom: 24 
      }}>
        <Link
          to="/app/conversions?range=7d"
          style={{
            padding: '12px 24px',
            background: 'transparent',
            border: 'none',
            borderBottom: range === '7d' ? '3px solid #8B5CF6' : '3px solid transparent',
            color: range === '7d' ? '#8B5CF6' : '#6b7280',
            fontWeight: range === '7d' ? 600 : 400,
            fontSize: 16,
            cursor: 'pointer',
            textDecoration: 'none',
            marginBottom: -2
          }}
        >
          Last 7 days
        </Link>
        <Link
          to="/app/conversions?range=30d"
          style={{
            padding: '12px 24px',
            background: 'transparent',
            border: 'none',
            borderBottom: range === '30d' ? '3px solid #8B5CF6' : '3px solid transparent',
            color: range === '30d' ? '#8B5CF6' : '#6b7280',
            fontWeight: range === '30d' ? 600 : 400,
            fontSize: 16,
            cursor: 'pointer',
            textDecoration: 'none',
            marginBottom: -2
          }}
        >
          Last 30 days
        </Link>
        <Link
          to="/app/conversions?range=all"
          style={{
            padding: '12px 24px',
            background: 'transparent',
            border: 'none',
            borderBottom: range === 'all' ? '3px solid #8B5CF6' : '3px solid transparent',
            color: range === 'all' ? '#8B5CF6' : '#6b7280',
            fontWeight: range === 'all' ? 600 : 400,
            fontSize: 16,
            cursor: 'pointer',
            textDecoration: 'none',
            marginBottom: -2
          }}
        >
          All time
        </Link>
      </div>

      {/* Empty State */}
      {conversions.length === 0 && (
        <div style={{
          background: 'white',
          padding: 48,
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16, fontWeight: 600, color: '#9ca3af' }}></div>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>No conversions yet</h2>
          <p style={{ color: '#6b7280' }}>
            Orders will appear here once customers complete purchases after seeing your modal.
          </p>
        </div>
      )}

      {/* Conversions Table */}
      {conversions.length > 0 && (
        <div style={{ 
          background: 'white', 
          borderRadius: 8, 
          border: '1px solid #e5e7eb',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Date</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Time</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Order #</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Customer</th>
                <th style={{ padding: 12, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Order Value</th>
                <th style={{ padding: 12, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Had Discount?</th>
                <th style={{ padding: 12, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Redeemed?</th>
                <th style={{ padding: 12, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Promo Total</th>
                {plan === 'enterprise' && (
                  <th style={{ padding: 12, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Modal</th>
                )}
              </tr>
            </thead>
            <tbody>
              {conversions.map((conversion, index) => (
                <tr 
                  key={conversion.id}
                  style={{ 
                    borderBottom: index < conversions.length - 1 ? '1px solid #e5e7eb' : 'none',
                    cursor: plan === 'enterprise' && conversion.modalSnapshot ? 'pointer' : 'default'
                  }}
                  onClick={() => {
                    if (plan === 'enterprise' && conversion.modalSnapshot) {
                      setSelectedConversion(conversion);
                    }
                  }}
                >
                  <td style={{ padding: 12, fontSize: 14 }}>{formatDate(conversion.orderedAt)}</td>
                  <td style={{ padding: 12, fontSize: 14, color: '#6b7280' }}>{formatTime(conversion.orderedAt)}</td>
                  <td style={{ padding: 12 }}>
                    <a 
                      href={`https://${shop}/admin/orders/${conversion.orderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#8B5CF6', textDecoration: 'none', fontWeight: 500 }}
                    >
                      {conversion.orderNumber}
                    </a>
                  </td>
                  <td style={{ padding: 12, fontSize: 14, color: '#6b7280' }}>
                    {conversion.customerEmail || 'Guest'}
                  </td>
                  <td style={{ padding: 12, fontSize: 14, textAlign: 'right', fontWeight: 500 }}>
                    {formatCurrency(conversion.orderValue)}
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <span style={{
                      padding: '4px 8px',
                      background: conversion.modalHadDiscount ? '#d1fae5' : '#f3f4f6',
                      color: conversion.modalHadDiscount ? '#065f46' : '#6b7280',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500
                    }}>
                      {conversion.modalHadDiscount ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    {conversion.modalHadDiscount ? (
                      <span style={{
                        padding: '4px 8px',
                        background: conversion.discountRedeemed ? '#d1fae5' : '#fee2e2',
                        color: conversion.discountRedeemed ? '#065f46' : '#991b1b',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500
                      }}>
                        {conversion.discountRedeemed ? 'Yes' : 'No'}
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 14 }}>N/A</span>
                    )}
                  </td>
                  <td style={{ padding: 12, fontSize: 14, textAlign: 'right', fontWeight: 500 }}>
                    {conversion.modalHadDiscount && conversion.discountAmount 
                      ? formatCurrency(conversion.discountAmount)
                      : <span style={{ color: '#9ca3af' }}>N/A</span>
                    }
                  </td>
                  {plan === 'enterprise' && (
                    <td style={{ padding: 12, textAlign: 'center' }}>
                      {conversion.modalSnapshot && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedConversion(conversion);
                          }}
                          style={{
                            padding: '6px 12px',
                            background: '#8B5CF6',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                        >
                          View
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Preview (Enterprise only) */}
      {selectedConversion && plan === 'enterprise' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: 20
          }}
          onClick={() => setSelectedConversion(null)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              maxWidth: 600,
              width: '100%',
              padding: 32,
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 24, marginBottom: 16 }}>Modal Preview</h2>
            <p style={{ color: '#6b7280', marginBottom: 24 }}>
              This is what the customer saw for order {selectedConversion.orderNumber}
            </p>

            {/* Render modal preview */}
            <div style={{
              padding: 32,
              background: '#f9fafb',
              borderRadius: 8,
              border: '2px solid #8B5CF6'
            }}>
              {(() => {
                try {
                  const config = JSON.parse(selectedConversion.modalSnapshot);
                  return (
                    <>
                      <h3 style={{ fontSize: 20, marginBottom: 12, fontWeight: 600 }}>
                        {config.modalHeadline || 'Wait! Don\'t leave yet'}
                      </h3>
                      <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
                        {config.modalBody || 'Complete your purchase and get an exclusive offer!'}
                      </p>
                      <button
                        style={{
                          padding: '12px 24px',
                          background: '#8B5CF6',
                          color: 'white',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 16,
                          fontWeight: 600,
                          width: '100%',
                          cursor: 'default'
                        }}
                      >
                        {config.ctaButton || 'Complete My Order'}
                      </button>
                      {config.discountEnabled && (
                        <p style={{ 
                          marginTop: 16, 
                          fontSize: 13, 
                          color: '#10b981',
                          textAlign: 'center',
                          fontWeight: 500
                        }}>
                          {config.offerType === 'percentage' 
                            ? `${config.discountPercentage}% discount` 
                            : `$${config.discountAmount} off`
                          }
                        </p>
                      )}
                    </>
                  );
                } catch (e) {
                  return <p style={{ color: '#ef4444' }}>Error loading modal preview</p>;
                }
              })()}
            </div>

            <button
              onClick={() => setSelectedConversion(null)}
              style={{
                marginTop: 24,
                padding: '10px 20px',
                background: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                width: '100%'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}