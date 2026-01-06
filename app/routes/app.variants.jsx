import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { useEffect, useState } from "react";

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
  
  // Get recent impressions for activity feed
  const recentImpressions = await db.variantImpression.findMany({
    where: { shopId: shop.id },
    orderBy: { timestamp: 'desc' },
    take: 10,
    include: {
      variant: {
        select: {
          variantId: true,
          headline: true
        }
      }
    }
  });
  
  // Calculate evolution cycle status
  const impressionsSinceLastCycle = await db.variantImpression.count({
    where: {
      shopId: shop.id,
      timestamp: {
        gte: shop.lastEvolutionCycle || new Date(0)
      }
    }
  });
  
  const needsEvolution = impressionsSinceLastCycle >= 100;
  const progressToNextCycle = Math.min((impressionsSinceLastCycle / 100) * 100, 100);
  
  // Generation stats
  const maxGeneration = variants.length > 0 ? Math.max(...variants.map(v => v.generation)) : 0;
  const avgGeneration = variants.length > 0 
    ? (variants.reduce((sum, v) => sum + v.generation, 0) / variants.length).toFixed(1)
    : 0;
  
  return json({ 
    shop,
    variantsByBaseline,
    totalVariants: variants.length,
    aliveCount: variants.filter(v => v.status === 'alive' || v.status === 'champion').length,
    deadCount: variants.filter(v => v.status === 'dead').length,
    recentImpressions,
    evolutionStatus: {
      impressionsSinceLastCycle,
      needsEvolution,
      progressToNextCycle,
      lastCycle: shop.lastEvolutionCycle
    },
    generationStats: {
      max: maxGeneration,
      avg: avgGeneration
    }
  });
}

export default function Variants() {
  const data = useLoaderData();
  const { shop, variantsByBaseline, totalVariants, aliveCount, deadCount, recentImpressions, evolutionStatus, generationStats } = data;
  const fetcher = useFetcher();
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetcher.load('/app/variants');
    }, 30000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, fetcher]);
  
  // Use fetcher data if available, otherwise use initial data
  const displayData = fetcher.data || data;
  
  if (!shop) {
    return (
      <div style={{ padding: '20px' }}>
        <h1>Variant Performance</h1>
        <p>No shop data found.</p>
      </div>
    );
  }
  
  const baselines = Object.keys(displayData.variantsByBaseline);
  
  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <h1>🧬 Variant Evolution Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>Watch your variants evolve in real-time</p>
      
      {/* Auto-refresh toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input 
            type="checkbox" 
            checked={autoRefresh} 
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ fontSize: '14px' }}>Auto-refresh (30s)</span>
        </label>
      </div>
      
      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '20px', marginBottom: '30px' }}>
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
        <div style={{ background: '#f6f6f7', padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>Max Generation</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#7c3aed' }}>Gen {generationStats.max}</div>
        </div>
      </div>
      
      {/* Evolution Cycle Status */}
      <div style={{ background: evolutionStatus.needsEvolution ? '#fef3c7' : '#f0fdf4', padding: '20px', borderRadius: '8px', marginBottom: '30px', border: `2px solid ${evolutionStatus.needsEvolution ? '#f59e0b' : '#22c55e'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>
            {evolutionStatus.needsEvolution ? '⚡ Evolution Ready' : '🔄 Evolution Cycle'}
          </h3>
          <span style={{ fontSize: '14px', color: '#666' }}>
            {evolutionStatus.impressionsSinceLastCycle} / 100 impressions
          </span>
        </div>
        <div style={{ background: '#fff', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ 
            background: evolutionStatus.needsEvolution ? '#f59e0b' : '#22c55e',
            height: '100%',
            width: `${evolutionStatus.progressToNextCycle}%`,
            transition: 'width 0.3s ease'
          }} />
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
          {evolutionStatus.needsEvolution 
            ? 'Evolution cycle will run soon - poor variants will die, winners will breed'
            : `${100 - evolutionStatus.impressionsSinceLastCycle} more impressions until next evolution`
          }
        </div>
      </div>
      
      {/* Recent Activity Feed */}
      {recentImpressions.length > 0 && (
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e1e3e5', marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '15px' }}>📊 Recent Activity</h3>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {recentImpressions.map((imp, i) => (
              <div key={imp.id} style={{ 
                padding: '10px',
                borderBottom: i < recentImpressions.length - 1 ? '1px solid #f0f0f0' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '14px', fontWeight: '500' }}>{imp.variant.variantId}</span>
                  <span style={{ fontSize: '12px', color: '#666', marginLeft: '10px' }}>
                    {imp.converted ? '✅ Converted' : imp.clicked ? '👆 Clicked' : '👁️ Impression'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#999' }}>
                  {new Date(imp.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '30px', display: 'none' }}>
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
        const { alive, dead } = displayData.variantsByBaseline[baseline];
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
