(function() {
  'use strict';

  // Get settings from the snippet (will be injected by Liquid)
  const settings = window.exitIntentSettings || {};
  
  // Exit intent modal manager
  class ExitIntentModal {
    constructor() {
      this.settings = settings;
      this.modalShown = false;
      this.modalElement = null;
      this.sessionKey = 'exitIntentShown';
      
      // Check if modal is enabled
      if (!this.settings.enabled) {
        console.log('Exit intent modal is disabled');
        return;
      }
      
      // Check if already shown in this session
      if (sessionStorage.getItem(this.sessionKey)) {
        console.log('Exit intent modal already shown this session');
        return;
      }
      
      // Initialize
      this.init();
    }
    
    init() {
      // Create modal HTML
      this.createModal();
      
      // Set up triggers
      this.setupTriggers();
      
      // Set up event listeners
      this.setupEventListeners();
    }
    
    async hasItemsInCart() {
      try {
        const response = await fetch('/cart.js');
        const cart = await response.json();
        return cart.item_count > 0;
      } catch (error) {
        console.error('Error checking cart:', error);
        return false;
      }
    }
    
    createModal() {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.id = 'exit-intent-modal-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 9999;
      `;
      
      // Create modal content
      const modal = document.createElement('div');
      modal.id = 'exit-intent-modal';
      modal.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 40px;
        max-width: 500px;
        width: 90%;
        position: relative;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      `;
      
      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.style.cssText = `
        position: absolute;
        top: 15px;
        right: 15px;
        background: none;
        border: none;
        font-size: 30px;
        cursor: pointer;
        color: #999;
        line-height: 1;
      `;
      closeBtn.onclick = () => this.closeModal();
      
      // Modal content
      const headline = document.createElement('h2');
      headline.textContent = this.settings.modalHeadline || 'Wait! Don\'t leave yet 🎁';
      headline.style.cssText = `
        margin: 0 0 20px 0;
        font-size: 28px;
        color: #333;
      `;
      
      const body = document.createElement('p');
      body.textContent = this.settings.modalBody || 'Complete your purchase now and get free shipping on your order!';
      body.style.cssText = `
        margin: 0 0 30px 0;
        font-size: 16px;
        line-height: 1.6;
        color: #666;
      `;
      
      const ctaButton = document.createElement('button');
      ctaButton.textContent = this.settings.ctaButton || 'Complete My Order';
      ctaButton.style.cssText = `
        background: #000;
        color: white;
        border: none;
        padding: 15px 40px;
        font-size: 16px;
        font-weight: bold;
        border-radius: 4px;
        cursor: pointer;
        width: 100%;
      `;
      ctaButton.onclick = () => this.handleCTAClick();
      
      // Assemble modal
      modal.appendChild(closeBtn);
      modal.appendChild(headline);
      modal.appendChild(body);
      modal.appendChild(ctaButton);
      overlay.appendChild(modal);
      
      // Add to page
      document.body.appendChild(overlay);
      this.modalElement = overlay;
    }
    
    setupTriggers() {
      const triggers = this.settings.triggers || {};
      
      // Exit intent trigger
      if (triggers.exitIntent) {
        document.addEventListener('mouseout', async (e) => {
          if (e.clientY < 0 && !this.modalShown) {
            // Check if cart has items before showing
            const hasItems = await this.hasItemsInCart();
            if (hasItems) {
              this.showModal();
            } else {
              console.log('Cart is empty, not showing exit intent modal');
            }
          }
        });
      }
      
      // Time delay trigger (only on cart page)
      if (triggers.timeDelay && triggers.timeDelaySeconds) {
        if (window.location.pathname.includes('/cart')) {
          setTimeout(async () => {
            if (!this.modalShown) {
              const hasItems = await this.hasItemsInCart();
              if (hasItems) {
                this.showModal();
              }
            }
          }, triggers.timeDelaySeconds * 1000);
        }
      }
      
      // Cart value trigger
      if (triggers.cartValue && (triggers.minCartValue || triggers.maxCartValue)) {
        this.checkCartValue();
      }
    }
    
    async checkCartValue() {
      try {
        const response = await fetch('/cart.js');
        const cart = await response.json();
        const cartTotal = cart.total_price / 100; // Convert cents to dollars
        
        const triggers = this.settings.triggers || {};
        const min = triggers.minCartValue || 0;
        const max = triggers.maxCartValue || Infinity;
        
        if (cartTotal >= min && cartTotal <= max) {
          // Cart value is in range, triggers are active
          console.log('Cart value trigger conditions met');
        }
      } catch (error) {
        console.error('Error checking cart value:', error);
      }
    }
    
    setupEventListeners() {
      // Close on overlay click
      if (this.modalElement) {
        this.modalElement.addEventListener('click', (e) => {
          if (e.target === this.modalElement) {
            this.closeModal();
          }
        });
      }
      
      // Close on ESC key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.modalShown) {
          this.closeModal();
        }
      });
    }
    
    showModal() {
      if (this.modalShown || !this.modalElement) return;
      
      this.modalElement.style.display = 'flex';
      this.modalShown = true;
      
      // Mark as shown in session storage (won't show again this session)
      sessionStorage.setItem(this.sessionKey, 'true');
      
      // Track impression
      this.trackEvent('impression');
    }
    
    closeModal() {
      if (!this.modalElement) return;
      
      this.modalElement.style.display = 'none';
      
      // Track close
      this.trackEvent('closeout');
    }
    
    handleCTAClick() {
      // Track button click
      this.trackEvent('click');
      
      // Close modal
      this.closeModal();
      
      // Get settings
      const discountCode = this.settings.discountCode;
      const destination = this.settings.redirectDestination || 'checkout';
      
      // Build redirect URL
      let redirectUrl;
      
      if (destination === 'cart') {
        // If going to cart with discount, set flag for auto-apply
        if (discountCode) {
          sessionStorage.setItem('exitIntentDiscount', discountCode);
          console.log(`Redirecting to cart - will auto-apply discount: ${discountCode}`);
        }
        redirectUrl = '/cart';
      } else {
        // Checkout - use URL parameter (works natively)
        redirectUrl = discountCode ? `/checkout?discount=${discountCode}` : '/checkout';
        console.log(`Redirecting to checkout${discountCode ? ' with discount: ' + discountCode : ''}`);
      }
      
      window.location.href = redirectUrl;
    }
    
    async trackEvent(eventType) {
      // Send analytics to your app via app proxy
      try {
        await fetch('/apps/exit-intent/track', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event: eventType,
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error('Error tracking event:', error);
      }
    }
  }
  
  // Auto-apply discount on cart page if flag is set
  function autoApplyCartDiscount() {
    const discountCode = sessionStorage.getItem('exitIntentDiscount');
    
    if (!discountCode) return;
    
    // Only run on cart page
    if (!window.location.pathname.includes('/cart')) return;
    
    console.log('Attempting to auto-apply discount:', discountCode);
    
    // Clear the flag immediately to prevent repeated attempts
    sessionStorage.removeItem('exitIntentDiscount');
    
    // Common discount field selectors across different themes
    const selectors = [
      'input[name="discount"]',
      'input[name="checkout[reduction_code]"]',
      'input#discount_code',
      'input#CartDrawer-Discount',
      'input.discount-code',
      'input[placeholder*="discount" i]',
      'input[placeholder*="coupon" i]',
      'input[placeholder*="promo" i]'
    ];
    
    // Try to find the discount input
    let discountInput = null;
    for (const selector of selectors) {
      discountInput = document.querySelector(selector);
      if (discountInput) {
        console.log('Found discount input:', selector);
        break;
      }
    }
    
    if (!discountInput) {
      console.log('No discount input found - redirecting to checkout instead');
      window.location.href = `/checkout?discount=${discountCode}`;
      return;
    }
    
    // Fill in the discount code
    discountInput.value = discountCode;
    discountInput.dispatchEvent(new Event('input', { bubbles: true }));
    discountInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Try to find and click the apply button
    const applyButton = discountInput.closest('form')?.querySelector('button[type="submit"]') ||
                        discountInput.closest('form')?.querySelector('button') ||
                        document.querySelector('button[name="discount_apply"]') ||
                        document.querySelector('button.discount-apply');
    
    if (applyButton) {
      console.log('Clicking apply button');
      setTimeout(() => applyButton.click(), 100);
    } else {
      // Try to submit the form directly
      const form = discountInput.closest('form');
      if (form) {
        console.log('Submitting discount form');
        setTimeout(() => form.submit(), 100);
      } else {
        console.log('Could not find apply button or form - discount filled in but not applied');
      }
    }
  }
  
  // Run auto-apply when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoApplyCartDiscount);
  } else {
    autoApplyCartDiscount();
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new ExitIntentModal();
    });
  } else {
    new ExitIntentModal();
  }
})();