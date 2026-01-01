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
  this.cartItemCount = 0;
  this.cartTimerStarted = false;
  this.cartTimerTimeout = null;
  this.cartItemCount = 0;
  this.cartTimerStarted = false;
  this.cartTimerTimeout = null;
  
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

    async collectCustomerSignals() {
      // 1. Visit frequency
      const visits = parseInt(localStorage.getItem('exitIntentVisits') || '0') + 1;
      localStorage.setItem('exitIntentVisits', visits);
      
      // 2. Cart value
      const cart = await fetch('/cart.js').then(r => r.json());
      const cartValue = cart.total_price / 100;
      
      // 3. Device type
      const deviceType = /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      
      // 4. Account status
      const accountStatus = window.Shopify?.customer ? 'logged_in' : 'guest';
      
      // 5. Traffic source
      const trafficSource = this.getTrafficSource();
      
      // 6. Time on site
      if (!window.sessionStartTime) window.sessionStartTime = Date.now();
      const timeOnSite = (Date.now() - window.sessionStartTime) / 1000;
      
      // 7. Page views
      const pageViews = parseInt(sessionStorage.getItem('pageViews') || '0') + 1;
      sessionStorage.setItem('pageViews', pageViews);
      
      // 8. Abandoned before
      const hasAbandonedBefore = document.cookie.includes('abandonedCart=true');
      
      return {
        visitFrequency: visits,
        cartValue,
        deviceType,
        accountStatus,
        trafficSource,
        timeOnSite,
        pageViews,
        hasAbandonedBefore
      };
    }
    
    getTrafficSource() {
      const ref = document.referrer;
      if (!ref || ref.includes(window.location.hostname)) return 'direct';
      if (ref.match(/google|bing|yahoo/i)) return 'organic';
      if (ref.match(/facebook|instagram|twitter|linkedin|tiktok/i)) return 'social';
      if (ref.match(/gclid|fbclid|utm_source=paid/i)) return 'paid';
      return 'referral';
    }

      // Cart monitoring for add-to-cart timer trigger
  initCartMonitoring(delaySeconds) {
    // Get initial cart count
    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        this.cartItemCount = cart.item_count;
        console.log('[Exit Intent] Initial cart count:', this.cartItemCount);
      })
      .catch(err => console.error('[Exit Intent] Error fetching initial cart:', err));

    // Listen for Shopify cart updates
    document.addEventListener('cart:updated', () => this.handleCartUpdate(delaySeconds));
    
    // Poll cart as fallback (some themes don't fire cart:updated)
    setInterval(() => this.pollCart(delaySeconds), 2000);
    
    // Listen for add-to-cart button clicks as additional trigger
    document.addEventListener('click', (e) => {
      const addToCartBtn = e.target.closest('[name="add"], [type="submit"][name="add"], .product-form__submit, button[name="add"]');
      if (addToCartBtn) {
        console.log('[Exit Intent] Add to cart button clicked');
        setTimeout(() => this.pollCart(delaySeconds), 500);
      }
    });
  }

  handleCartUpdate(delaySeconds) {
    console.log('[Exit Intent] Cart updated event fired');
    this.pollCart(delaySeconds);
  }

  pollCart(delaySeconds) {
    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        const newItemCount = cart.item_count;
        
        // Cart increased - item was added
        if (newItemCount > this.cartItemCount && !this.cartTimerStarted) {
          console.log('[Exit Intent] Item added to cart! Starting timer...');
          this.cartItemCount = newItemCount;
          this.cartTimerStarted = true;
          
          // Clear any existing timer
          if (this.cartTimerTimeout) {
            clearTimeout(this.cartTimerTimeout);
          }
          
          // Start countdown
          const delay = delaySeconds * 1000;
          console.log(`[Exit Intent] Timer will fire in ${delaySeconds} seconds`);
          
          this.cartTimerTimeout = setTimeout(async () => {
            if (!this.modalShown) {
              const hasItems = await this.hasItemsInCart();
              if (hasItems) {
                console.log('[Exit Intent] Timer completed - showing modal');
                this.showModal();
              }
            }
          }, delay);
        }
        
        // Update count for next check
        this.cartItemCount = newItemCount;
      })
      .catch(err => console.error('[Exit Intent] Error polling cart:', err));
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
      
      // Time delay trigger (after add-to-cart)
      if (triggers.timeDelay && triggers.timeDelaySeconds) {
        this.initCartMonitoring(triggers.timeDelaySeconds);
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
    
    async showModal() {
      if (this.modalShown || !this.modalElement) return;
      
      // If AI mode is enabled, get AI decision first
      if (this.settings.mode === 'ai') {
        await this.getAIDecision();
      }
      
      this.modalElement.style.display = 'flex';
      this.modalShown = true;
      
      // Mark as shown in session storage (won't show again this session)
      sessionStorage.setItem(this.sessionKey, 'true');
      
      // Track impression
      this.trackEvent('impression');
    }
    
    async getAIDecision() {
      try {
        // Collect customer signals
        const signals = await this.collectCustomerSignals();
        
        console.log('[AI Mode] Collected signals:', signals);
        
        // Call AI decision API
        const response = await fetch('/apps/exit-intent/api/ai-decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            shop: window.Shopify.shop,
            signals 
          })
        });
        
        const result = await response.json();
        
        console.log('[AI Mode] AI decision:', result);
        
        if (result.decision) {
          // Update modal with AI decision
          this.updateModalWithAI(result.decision);
        }
      } catch (error) {
        console.error('[AI Mode] Error getting AI decision:', error);
        // Fall back to manual settings if AI fails
      }
    }
    
    updateModalWithAI(decision) {
      const modal = this.modalElement.querySelector('#exit-intent-modal');
      const headline = modal.querySelector('h2');
      const body = modal.querySelector('p');
      const button = modal.querySelector('button[onclick]');
      
      // Update based on decision type
      if (decision.type === 'no-discount') {
        // No discount - just announcement
        headline.textContent = this.settings.modalHeadline || "Don't forget your cart!";
        body.textContent = this.settings.modalBody || "Your items are waiting for you. Complete your purchase now!";
        this.settings.discountCode = null;
      } else if (decision.type === 'percentage') {
        headline.textContent = `Get ${decision.amount}% Off Your Order! 🎁`;
        body.textContent = 'Complete your purchase now and save!';
        this.settings.discountCode = decision.code;
        this.settings.offerType = 'percentage';
      } else if (decision.type === 'fixed') {
        headline.textContent = `Get $${decision.amount} Off Your Order! 🎁`;
        body.textContent = 'Complete your purchase now and save!';
        this.settings.discountCode = decision.code;
        this.settings.offerType = 'fixed';
      } else if (decision.type === 'threshold') {
        headline.textContent = `Special Offer for You! 💰`;
        body.textContent = `Spend $${decision.threshold} and get $${decision.amount} off your order!`;
        this.settings.discountCode = decision.code;
        this.settings.offerType = 'threshold';
      }
      
      console.log(`[AI Mode] Updated modal with ${decision.type} offer`);
    }
    
    closeModal() {
      if (!this.modalElement) return;
      
      this.modalElement.style.display = 'none';
      
      // Track close
      this.trackEvent('closeout');
    }
    
 async handleCTAClick() {
      // Track button click
      this.trackEvent('click');
      
      // Close modal
      this.closeModal();
      
      // Get settings
      const discountCode = this.settings.discountCode;
      const offerType = this.settings.offerType || 'percentage';
      const destination = this.settings.redirectDestination || 'checkout';
      
      // Handle gift card offer - add product to cart
      if (offerType === 'giftcard') {
        try {
          console.log('Adding gift card voucher to cart...');
          await fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{
                id: 7790476951630,
                quantity: 1
              }]
            })
          });
          console.log('Gift card voucher added to cart');
        } catch (error) {
          console.error('Error adding gift card to cart:', error);
        }
        
        // Redirect to cart or checkout
        window.location.href = destination === 'cart' ? '/cart' : '/checkout';
        return;
      }
      
      // Handle discount codes (percentage or fixed)
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