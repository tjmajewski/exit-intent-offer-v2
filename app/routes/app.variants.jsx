import { json } from "@remix-run/node";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  
  // Get shop from database
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });
  
  if (!shop) {
    return json({ variants: [], shop: null });
  }
  
  // Get all variants for this shop
  const variants = await db.variant.findMany({
    where: { shopId: shop.id },
    orderBy: [
      { status: 'asc' },
      { profitPerImpression: 'desc' }
    ]
  });
  
  // Group by baseline and status
  const variantsByBaseline = variants.reduce((acc, v) => {
    if (!acc[v.baseline]) {
      acc[v.baseline] = { alive: [], dead: [] };
    }
    if (v.status === 'alive' || v.status === 'champion') {
      acc[v.baseline].alive.push(v);
    } else {
      acc[v.baseline].dead.push(v);
    }
    return acc;
  }, {});
  
  return json({ 
    shop,
    variantsByBaseline,
    totalVariants: variants.length,
    aliveCount: variants.filter(v => v.status === 'alive' || v.status === 'champion').length,
    deadCount: variants.filter(v => v.status === 'dead').length
  });
}

export default function Variants() {
  const { shop, variantsByBaseline, totalVariants, aliveCount, deadCount } = useLoaderData();
  
  if (!shop) {
    return (
      <div style={{ padding: '20px' }}>
        <h1>Variant Performance</h1>
        <p>No shop data found.</p>
      </div>
    );
  }
  
  const baselines = Object.keys(variantsByBaseline);
  
  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <h1>🧬 Variant Evolution Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>Watch your variants evolve in real-time</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '30px' }}>
        <div style={{ background: '#f6f6f7', padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>Total Variants</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{totalVariants}</div>
        </div>
        <div style={{ background: '#f6f6f7', padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>🧬 Alive</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#008060' }}>{aliveCount}</div>
        </div>
        <div style={{ background: '#f6f6f7', padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>💀 Dead</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#bf0711' }}>{deadCount}</div>
        </div>
      </div>
      
      {baselines.length === 0 && (
        <div style={{ background: '#fff', padding: '40px', borderRadius: '8px', border: '1px solid #e1e3e5' }}>
          <h3>No variants yet</h3>
          <p>Variants will appear once you start getting traffic in AI mode.</p>
        </div>
      )}
      
      {baselines.map(baseline => {
        const { alive, dead } = variantsByBaseline[baseline];
        const champion = alive.find(v => v.status === 'champion');
        
        return (
          <div key={baseline} style={{ background: '#fff', padding: '30px', borderRadius: '8px', border: '1px solid #e1e3e5', marginBottom: '20px' }}>
            <h2>{baseline.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h2>
            
            {champion && (
              <div style={{ background: '#fef3c7', padding: '20px', borderRadius: '8px', marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <h3>👑 Current Champion</h3>
                  <span style={{ background: '#16a34a', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px' }}>
                    Generation {champion.generation}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '20px', marginBottom: '15px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Variant ID</div>
                    <div style={{ fontWeight: '600' }}>{champion.variantId}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Conversion Rate</div>
                    <div style={{ fontWeight: '600' }}>
                      {champion.impressions > 0 ? ((champion.conversions / champion.impressions) * 100).toFixed(1) : '0.0'}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Profit/Impression</div>
                    <div style={{ fontWeight: '600' }}>${champion.profitPerImpression.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Impressions</div>
                    <div style={{ fontWeight: '600' }}>{champion.impressions}</div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #d97706', paddingTop: '15px', marginTop: '15px' }}>
                  <h4 style={{ marginBottom: '10px' }}>Genes</h4>
                  <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                    <div><strong>Offer:</strong> ${champion.offerAmount}</div>
                    <div><strong>Headline:</strong> {champion.headline}</div>
                    <div><strong>Subhead:</strong> {champion.subhead}</div>
                    <div><strong>CTA:</strong> {champion.cta}</div>
                    <div><strong>Redirect:</strong> {champion.redirect}</div>
                    <div><strong>Urgency:</strong> {champion.urgency ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              </div>
            )}
            
            <h3 style={{ marginTop: '30px', marginBottom: '15px' }}>Live Variants ({alive.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f6f6f7', textAlign: 'left' }}>
                  <th style={{ padding: '12px', borderBottom: '2px solid #e1e3e5' }}>Variant ID</th>
                  <th style={{ padding: '12px', borderBottom: '2px solid #e1e3e5' }}>Status</th>
                  <th style={{ padding: '12px', borderBottom: '2px solid #e1e3e5' }}>Gen</th>
                  <th style={{ padding: '12px', borderBottom: '2px solid #e1e3e5' }}>Impressions</th>
                  <th style={{ padding: '12px', borderBottom: '2px solid #e1e3e5' }}>CVR</th>
                  <th style={{ padding: '12px', borderBottom: '2px solid #e1e3e5' }}>Profit/Imp</th>
                </tr>
              </thead>
              <tbody>
                {alive.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid #e1e3e5' }}>
                    <td style={{ padding: '12px' }}>{v.variantId}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ 
                        background: v.status === 'champion' ? '#dcfce7' : '#dbeafe',
                        color: v.status === 'champion' ? '#16a34a' : '#1e40af',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '12px'
                      }}>
                        {v.status === 'champion' ? '👑 Champion' : '🧬 Alive'}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>{v.generation}</td>
                    <td style={{ padding: '12px' }}>{v.impressions}</td>
                    <td style={{ padding: '12px' }}>
                      {v.impressions > 0 ? `${((v.conversions / v.impressions) * 100).toFixed(1)}%` : '0.0%'}
                    </td>
                    <td style={{ padding: '12px' }}>${v.profitPerImpression.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {dead.length > 0 && (
              <details style={{ marginTop: '30px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600', padding: '10px 0' }}>
                  💀 Dead Variants ({dead.length})
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '15px' }}>
                  <thead>
                    <tr style={{ background: '#fef2f2', textAlign: 'left' }}>
                      <th style={{ padding: '12px', borderBottom: '2px solid #fecaca' }}>Variant ID</th>
                      <th style={{ padding: '12px', borderBottom: '2px solid #fecaca' }}>Gen</th>
                      <th style={{ padding: '12px', borderBottom: '2px solid #fecaca' }}>Impressions</th>
                      <th style={{ padding: '12px', borderBottom: '2px solid #fecaca' }}>CVR</th>
                      <th style={{ padding: '12px', borderBottom: '2px solid #fecaca' }}>Lived For</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dead.slice(0, 20).map(v => {
                      const livedDays = v.deathDate 
                        ? Math.floor((new Date(v.deathDate) - new Date(v.birthDate)) / (1000 * 60 * 60 * 24))
                        : 0;
                      return (
                        <tr key={v.id} style={{ borderBottom: '1px solid #fecaca' }}>
                          <td style={{ padding: '12px', opacity: 0.7 }}>{v.variantId}</td>
                          <td style={{ padding: '12px', opacity: 0.7 }}>{v.generation}</td>
                          <td style={{ padding: '12px', opacity: 0.7 }}>{v.impressions}</td>
                          <td style={{ padding: '12px', opacity: 0.7 }}>
                            {v.impressions > 0 ? `${((v.conversions / v.impressions) * 100).toFixed(1)}%` : '0.0%'}
                          </td>
                          <td style={{ padding: '12px', opacity: 0.7 }}>{livedDays} days</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
