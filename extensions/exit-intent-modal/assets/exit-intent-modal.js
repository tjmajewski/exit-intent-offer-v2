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
      
      // Check if modal is enabled
      if (!this.settings.enabled) {
        console.log('Exit intent modal is disabled');
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
        document.addEventListener('mouseout', (e) => {
          if (e.clientY < 0 && !this.modalShown) {
            this.showModal();
          }
        });
      }
      
      // Time delay trigger (only on cart page)
      if (triggers.timeDelay && triggers.timeDelaySeconds) {
        if (window.location.pathname.includes('/cart')) {
          setTimeout(() => {
            if (!this.modalShown) {
              this.showModal();
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
      
      // Close modal and go to cart
      this.closeModal();
      window.location.href = '/cart';
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
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new ExitIntentModal();
    });
  } else {
    new ExitIntentModal();
  }
})();