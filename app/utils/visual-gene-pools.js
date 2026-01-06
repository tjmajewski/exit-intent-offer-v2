// Visual Gene Pools: Colors, layouts, animations for modal variants

export const visualGenePools = {
  // Color schemes
  colorSchemes: [
    {
      id: 'classic',
      primary: '#000000',
      secondary: '#ffffff',
      accent: '#f59e0b',
      background: '#ffffff'
    },
    {
      id: 'modern',
      primary: '#1e293b',
      secondary: '#f1f5f9',
      accent: '#3b82f6',
      background: '#f8fafc'
    },
    {
      id: 'vibrant',
      primary: '#7c3aed',
      secondary: '#fef3c7',
      accent: '#f59e0b',
      background: '#faf5ff'
    },
    {
      id: 'luxury',
      primary: '#78350f',
      secondary: '#fef3c7',
      accent: '#d97706',
      background: '#fffbeb'
    },
    {
      id: 'minimal',
      primary: '#18181b',
      secondary: '#fafafa',
      accent: '#71717a',
      background: '#ffffff'
    }
  ],

  // Modal layouts
  layouts: [
    {
      id: 'centered',
      modalWidth: '500px',
      padding: '40px',
      alignment: 'center'
    },
    {
      id: 'wide',
      modalWidth: '600px',
      padding: '40px 60px',
      alignment: 'left'
    },
    {
      id: 'compact',
      modalWidth: '400px',
      padding: '30px',
      alignment: 'center'
    },
    {
      id: 'split',
      modalWidth: '700px',
      padding: '0',
      alignment: 'split' // Image on left, content on right
    }
  ],

  // Button styles
  buttonStyles: [
    {
      id: 'solid',
      borderRadius: '4px',
      fontWeight: 'bold',
      padding: '15px 40px'
    },
    {
      id: 'rounded',
      borderRadius: '24px',
      fontWeight: '600',
      padding: '14px 36px'
    },
    {
      id: 'sharp',
      borderRadius: '0px',
      fontWeight: 'bold',
      padding: '16px 48px'
    },
    {
      id: 'pill',
      borderRadius: '50px',
      fontWeight: '600',
      padding: '12px 32px'
    }
  ],

  // Animations
  animations: [
    {
      id: 'fade',
      entrance: 'fadeIn 0.3s ease-out',
      exit: 'fadeOut 0.2s ease-in'
    },
    {
      id: 'slide',
      entrance: 'slideDown 0.4s ease-out',
      exit: 'slideUp 0.3s ease-in'
    },
    {
      id: 'scale',
      entrance: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      exit: 'scaleOut 0.2s ease-in'
    },
    {
      id: 'bounce',
      entrance: 'bounceIn 0.5s ease-out',
      exit: 'fadeOut 0.2s ease-in'
    },
    {
      id: 'none',
      entrance: 'none',
      exit: 'none'
    }
  ],

  // Typography
  typography: [
    {
      id: 'modern',
      headlineFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      headlineSize: '28px',
      bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      bodySize: '16px'
    },
    {
      id: 'elegant',
      headlineFont: 'Georgia, "Times New Roman", serif',
      headlineSize: '32px',
      bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      bodySize: '15px'
    },
    {
      id: 'bold',
      headlineFont: '"Arial Black", "Arial Bold", sans-serif',
      headlineSize: '30px',
      bodyFont: 'Arial, sans-serif',
      bodySize: '16px'
    }
  ]
};

/**
 * Get a random visual gene from a category
 */
export function getRandomVisualGene(category) {
  const pool = visualGenePools[category];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate complete visual genes for a variant
 */
export function generateVisualGenes() {
  return {
    colorScheme: getRandomVisualGene('colorSchemes').id,
    layout: getRandomVisualGene('layouts').id,
    buttonStyle: getRandomVisualGene('buttonStyles').id,
    animation: getRandomVisualGene('animations').id,
    typography: getRandomVisualGene('typography').id
  };
}

/**
 * Get visual styling for frontend based on genes
 */
export function getVisualStyles(genes) {
  const colorScheme = visualGenePools.colorSchemes.find(c => c.id === genes.colorScheme);
  const layout = visualGenePools.layouts.find(l => l.id === genes.layout);
  const buttonStyle = visualGenePools.buttonStyles.find(b => b.id === genes.buttonStyle);
  const animation = visualGenePools.animations.find(a => a.id === genes.animation);
  const typography = visualGenePools.typography.find(t => t.id === genes.typography);

  return {
    modal: {
      width: layout.modalWidth,
      padding: layout.padding,
      textAlign: layout.alignment === 'center' ? 'center' : 'left',
      background: colorScheme.background,
      animation: animation.entrance
    },
    headline: {
      color: colorScheme.primary,
      fontFamily: typography.headlineFont,
      fontSize: typography.headlineSize
    },
    body: {
      color: colorScheme.primary,
      fontFamily: typography.bodyFont,
      fontSize: typography.bodySize
    },
    button: {
      background: colorScheme.primary,
      color: colorScheme.secondary,
      borderRadius: buttonStyle.borderRadius,
      fontWeight: buttonStyle.fontWeight,
      padding: buttonStyle.padding
    },
    accent: {
      color: colorScheme.accent
    }
  };
}

/**
 * CSS keyframes for animations
 */
export const animationKeyframes = `
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-50px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideUp {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-50px);
  }
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes scaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

@keyframes bounceIn {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    transform: scale(1);
  }
}
`;
