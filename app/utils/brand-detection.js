/**
 * Auto-detect brand colors from merchant's Shopify theme
 */

export async function detectBrandColors(admin) {
  try {
    // Get shop's theme
    const themeQuery = `
      query {
        shop {
          primaryDomain {
            url
          }
        }
      }
    `;
    
    const response = await admin.graphql(themeQuery);
    const result = await response.json();
    const shopUrl = result.data.shop.primaryDomain.url;
    
    // Fetch homepage HTML
    const htmlResponse = await fetch(shopUrl);
    const html = await htmlResponse.text();
    
    // Extract colors from inline styles and CSS variables
    const colors = extractColorsFromHTML(html);
    
    return {
      primary: colors.primary || '#000000',
      secondary: colors.secondary || '#ffffff',
      accent: colors.accent || '#f59e0b',
      font: detectFont(html) || 'system'
    };
    
  } catch (error) {
    console.error('[Brand Detection] Error:', error);
    return null;
  }
}

function extractColorsFromHTML(html) {
  const colors = {
    primary: null,
    secondary: null,
    accent: null
  };
  
  // Look for CSS variables (most modern themes use these)
  const cssVarMatches = html.match(/--color-[^:]+:\s*#[0-9a-fA-F]{6}/g) || [];
  const hexColors = cssVarMatches.map(match => match.match(/#[0-9a-fA-F]{6}/)[0]);
  
  // Look for inline hex colors
  const inlineColors = html.match(/#[0-9a-fA-F]{6}/g) || [];
  const allColors = [...new Set([...hexColors, ...inlineColors])];
  
  // Filter out common grays/whites/blacks
  const brandColors = allColors.filter(color => {
    const hex = parseInt(color.slice(1), 16);
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    
    // Skip if too close to white, black, or gray
    const isGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20;
    const tooBright = r > 240 && g > 240 && b > 240;
    const tooDark = r < 20 && g < 20 && b < 20;
    
    return !isGray && !tooBright && !tooDark;
  });
  
  if (brandColors.length > 0) {
    colors.primary = brandColors[0];
    colors.accent = brandColors.length > 1 ? brandColors[1] : brandColors[0];
  }
  
  return colors;
}

function detectFont(html) {
  // Look for common font-family declarations
  const fontMatch = html.match(/font-family:\s*([^;}"]+)/i);
  if (fontMatch) {
    const font = fontMatch[1].trim().replace(/['"]/g, '');
    // Return first font in stack
    return font.split(',')[0].trim();
  }
  return 'system';
}
