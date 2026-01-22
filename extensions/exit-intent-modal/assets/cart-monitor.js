(function() {
  'use strict';

  console.log('[Cart Monitor] Script loaded');

  class CartMonitor {
    constructor() {
      this.checkInterval = null;
      this.bannerShown = false;
      this.lastCartTotal = 0;
      this.currentOfferId = null; // Track which offer we're monitoring
      
      this.init();
    }

    init() {
      // Start watching for offers (check every 2 seconds)
      this.watchForOffers();
    }

    watchForOffers() {
      // Check immediately
      this.checkForOffer();

      // Then check every 2 seconds for new offers
      setInterval(() => {
        this.checkForOffer();
      }, 2000);
    }

    checkForOffer() {
      const offerData = this.getActiveOffer();
      
      if (!offerData) {
        // No offer yet, keep waiting
        return;
      }

      // Offer found! Check if we're already monitoring it
      if (this.currentOfferId === offerData.code) {
        // Already monitoring this offer
        return;
      }

      // New offer detected!
      console.log('[Cart Monitor] Active offer found:', offerData);
      this.currentOfferId = offerData.code;
      
      // Check if we're on cart page OR if there's a mini-cart
      const isCartPage = window.location.pathname.includes('/cart');
      const hasMiniCart = this.detectMiniCart();
      
      if (!isCartPage && !hasMiniCart) {
        console.log('[Cart Monitor] Not on cart page and no mini-cart detected');
        return;
      }

      console.log('[Cart Monitor] Starting monitoring', {
        cartPage: isCartPage,
        miniCart: hasMiniCart
      });
      
      // Start monitoring cart
      this.startMonitoring(offerData, isCartPage, hasMiniCart);
    }

    detectMiniCart() {
      // Common mini-cart/drawer selectors
      const miniCartSelectors = [
        '#cart-drawer',
        '#CartDrawer',
        '.cart-drawer',
        '[id*="drawer"]',
        '[id*="sidebar-cart"]',
        '.mini-cart',
        '#mini-cart',
        '.cart-popup',
        '.slideout-cart',
        '[data-cart-drawer]'
      ];

      for (const selector of miniCartSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log('[Cart Monitor] Mini-cart detected:', selector);
          return element;
        }
      }

      return null;
    }
    
    getActiveOffer() {
      try {
        const stored = sessionStorage.getItem('exitIntentThresholdOffer');
        if (!stored) return null;

        const offer = JSON.parse(stored);
        
        // Check if offer is still valid (24 hours)
        const age = Date.now() - offer.timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (age > maxAge) {
          console.log('[Cart Monitor] Offer expired, removing');
          sessionStorage.removeItem('exitIntentThresholdOffer');
          return null;
        }

        return offer;
      } catch (error) {
        console.error('[Cart Monitor] Error parsing offer:', error);
        return null;
      }
    }

    async getCurrentCartTotal() {
      try {
        const response = await fetch('/cart.js');
        const cart = await response.json();
        return cart.total_price / 100; // Convert cents to dollars
      } catch (error) {
        console.error('[Cart Monitor] Error fetching cart:', error);
        return 0;
      }
    }

    async startMonitoring(offer, isCartPage, hasMiniCart) {
      console.log('[Cart Monitor] Starting to monitor cart for threshold:', offer.threshold);

      // Check immediately
      await this.checkThreshold(offer, isCartPage, hasMiniCart);

      // Then check every 2 seconds
      this.checkInterval = setInterval(() => {
        this.checkThreshold(offer, isCartPage, hasMiniCart);
      }, 2000);
      
      // If mini-cart exists, also watch for it opening/closing
      if (hasMiniCart) {
        this.watchMiniCart(hasMiniCart, offer);
      }
    }

    async checkThreshold(offer, isCartPage, hasMiniCart) {
      const currentTotal = await this.getCurrentCartTotal();
      
      // Only log if cart value changed
      if (currentTotal !== this.lastCartTotal) {
        console.log(`[Cart Monitor] Cart total: $${currentTotal} (threshold: $${offer.threshold})`);
        this.lastCartTotal = currentTotal;
      }

      // Check if threshold is met
      if (currentTotal >= offer.threshold && !this.bannerShown) {
        console.log('[Cart Monitor]  Threshold met! Showing banner');
        
        // Show banner on cart page
        if (isCartPage) {
          this.showQualificationBanner(offer);
        }
        
        // Update mini-cart CTA if exists
        if (hasMiniCart) {
          this.updateMiniCartCTA(hasMiniCart, offer, currentTotal, true);
        }
        
        this.applyDiscountCode(offer.code);
        this.bannerShown = true;
        
      } else if (currentTotal >= offer.threshold && this.bannerShown) {
        // Still qualified - do nothing (already showing banner)
        
      } else if (currentTotal < offer.threshold && this.bannerShown) {
        //  DROPPED BELOW THRESHOLD - Lost qualification!
        console.log('[Cart Monitor]  Cart dropped below threshold - removing qualification');
        
        // Remove qualification banner and show progress
        if (isCartPage) {
          this.removeQualificationBanner();
          this.showProgressBanner(offer, currentTotal);
        }
        
        // Show progress again in mini-cart
        if (hasMiniCart) {
          this.updateMiniCartCTA(hasMiniCart, offer, currentTotal, false);
        }
        
        // Remove discount code from sessionStorage
        sessionStorage.removeItem('exitIntentDiscount');
        
        this.bannerShown = false;
        
      } else if (currentTotal < offer.threshold && !this.bannerShown) {
        // Still below threshold - show progress
        if (isCartPage) {
          this.showProgressBanner(offer, currentTotal);
        }
        
        if (hasMiniCart) {
          this.updateMiniCartCTA(hasMiniCart, offer, currentTotal, false);
        }
      }
    }

    showQualificationBanner(offer) {
      // Check if banner already exists
      if (document.getElementById('exit-intent-qualification-banner')) {
        return;
      }

      // Create banner
      const banner = document.createElement('div');
      banner.id = 'exit-intent-qualification-banner';
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px;
        text-align: center;
        font-size: 16px;
        font-weight: 600;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 9998;
        animation: slideDown 0.5s ease-out;
      `;

      banner.innerHTML = `
        <style>
          @keyframes slideDown {
            from { transform: translateY(-100%); }
            to { transform: translateY(0); }
          }
          #exit-intent-qualification-banner .close-banner {
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 20px;
            line-height: 1;
            transition: background 0.2s;
          }
          #exit-intent-qualification-banner .close-banner:hover {
            background: rgba(255,255,255,0.3);
          }
        </style>
        <span> Congratulations! You qualified for $${offer.discount} off! Code <strong>${offer.code}</strong> has been applied at checkout.</span>
        <button class="close-banner" onclick="this.parentElement.remove()">×</button>
      `;

      document.body.appendChild(banner);
      console.log('[Cart Monitor] Banner displayed');
    }

    removeQualificationBanner() {
      const banner = document.getElementById('exit-intent-qualification-banner');
      if (banner) {
        banner.remove();
        console.log('[Cart Monitor] Qualification banner removed');
      }
    }

    showProgressBanner(offer, currentTotal) {
      // Check if banner already exists
      let banner = document.getElementById('exit-intent-progress-banner');
      
      const remaining = offer.threshold - currentTotal;
      
      if (!banner) {
        // Create banner
        banner = document.createElement('div');
        banner.id = 'exit-intent-progress-banner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
          padding: 16px;
          text-align: center;
          font-size: 16px;
          font-weight: 600;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          z-index: 9998;
          animation: slideDown 0.5s ease-out;
        `;
        
        banner.innerHTML = `
          <style>
            @keyframes slideDown {
              from { transform: translateY(-100%); }
              to { transform: translateY(0); }
            }
            #exit-intent-progress-banner .close-banner {
              position: absolute;
              right: 20px;
              top: 50%;
              transform: translateY(-50%);
              background: rgba(255,255,255,0.2);
              border: none;
              color: white;
              width: 30px;
              height: 30px;
              border-radius: 50%;
              cursor: pointer;
              font-size: 20px;
              line-height: 1;
              transition: background 0.2s;
            }
            #exit-intent-progress-banner .close-banner:hover {
              background: rgba(255,255,255,0.3);
            }
          </style>
          <span> Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off!</span>
          <button class="close-banner" onclick="this.parentElement.remove()">×</button>
        `;
        
        document.body.appendChild(banner);
        console.log('[Cart Monitor] Progress banner displayed');
      } else {
        // Update existing banner
        banner.querySelector('span').textContent = ` Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off!`;
      }
    }

    showProgressBanner(offer, currentTotal) {
      // Check if banner already exists
      let banner = document.getElementById('exit-intent-progress-banner');
      
      const remaining = offer.threshold - currentTotal;
      
      if (!banner) {
        // Create banner
        banner = document.createElement('div');
        banner.id = 'exit-intent-progress-banner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
          padding: 16px;
          text-align: center;
          font-size: 16px;
          font-weight: 600;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          z-index: 9998;
          animation: slideDown 0.5s ease-out;
        `;
        
        banner.innerHTML = `
          <style>
            @keyframes slideDown {
              from { transform: translateY(-100%); }
              to { transform: translateY(0); }
            }
            #exit-intent-progress-banner .close-banner {
              position: absolute;
              right: 20px;
              top: 50%;
              transform: translateY(-50%);
              background: rgba(255,255,255,0.2);
              border: none;
              color: white;
              width: 30px;
              height: 30px;
              border-radius: 50%;
              cursor: pointer;
              font-size: 20px;
              line-height: 1;
              transition: background 0.2s;
            }
            #exit-intent-progress-banner .close-banner:hover {
              background: rgba(255,255,255,0.3);
            }
          </style>
          <span> Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off!</span>
          <button class="close-banner" onclick="this.parentElement.remove()">×</button>
        `;
        
        document.body.appendChild(banner);
        console.log('[Cart Monitor] Progress banner displayed');
      } else {
        // Update existing banner
        banner.querySelector('span').textContent = ` Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off!`;
      }
    }

    showProgressBanner(offer, currentTotal) {
      // Check if banner already exists
      let banner = document.getElementById('exit-intent-progress-banner');
      
      const remaining = offer.threshold - currentTotal;
      
      if (!banner) {
        // Create banner
        banner = document.createElement('div');
        banner.id = 'exit-intent-progress-banner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
          padding: 16px;
          text-align: center;
          font-size: 16px;
          font-weight: 600;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          z-index: 9998;
          animation: slideDown 0.5s ease-out;
        `;
        
        banner.innerHTML = `
          <style>
            @keyframes slideDown {
              from { transform: translateY(-100%); }
              to { transform: translateY(0); }
            }
            #exit-intent-progress-banner .close-banner {
              position: absolute;
              right: 20px;
              top: 50%;
              transform: translateY(-50%);
              background: rgba(255,255,255,0.2);
              border: none;
              color: white;
              width: 30px;
              height: 30px;
              border-radius: 50%;
              cursor: pointer;
              font-size: 20px;
              line-height: 1;
              transition: background 0.2s;
            }
            #exit-intent-progress-banner .close-banner:hover {
              background: rgba(255,255,255,0.3);
            }
          </style>
          <span> Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off!</span>
          <button class="close-banner" onclick="this.parentElement.remove()">×</button>
        `;
        
        document.body.appendChild(banner);
        console.log('[Cart Monitor] Progress banner displayed');
      } else {
        // Update existing banner
        banner.querySelector('span').textContent = ` Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off!`;
      }
    }

    applyDiscountCode(code) {
      // Store code for checkout redirect
      sessionStorage.setItem('exitIntentDiscount', code);
      console.log(`[Cart Monitor] Discount code ${code} stored and ready for checkout from any page`);
    }

    watchMiniCart(miniCartElement, offer) {
      // Watch for mini-cart visibility changes
      const observer = new MutationObserver(() => {
        this.checkThreshold(offer, false, miniCartElement);
      });

      observer.observe(miniCartElement, {
        attributes: true,
        attributeFilter: ['class', 'style']
      });

      // Also listen for cart drawer open events
      document.addEventListener('cart-drawer:open', () => {
        console.log('[Cart Monitor] Mini-cart opened');
        setTimeout(() => this.checkThreshold(offer, false, miniCartElement), 100);
      });
    }

    updateMiniCartCTA(miniCartElement, offer, currentTotal, qualified) {
      const ctaId = 'exit-intent-minicart-cta';
      let existingCTA = miniCartElement.querySelector(`#${ctaId}`);

      if (qualified) {
        // Show "qualified" message
        if (!existingCTA) {
          existingCTA = this.createMiniCartCTA(ctaId, miniCartElement);
        }

        existingCTA.innerHTML = `
          <div style="text-align: center; padding: 12px;">
            <div style="font-size: 18px; margin-bottom: 4px;"> You Qualified!</div>
            <div style="font-size: 14px; opacity: 0.9;">$${offer.discount} off applied at checkout</div>
          </div>
        `;
        existingCTA.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      } else {
        // Show progress
        const remaining = offer.threshold - currentTotal;
        
        if (!existingCTA) {
          existingCTA = this.createMiniCartCTA(ctaId, miniCartElement);
        }

        existingCTA.innerHTML = `
          <div style="text-align: center; padding: 12px;">
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">
              Add $${Math.ceil(remaining / 5) * 5} more to get $${offer.discount} off! 
            </div>
            <div style="font-size: 13px; opacity: 0.9;">
              ${this.getProgressBar(currentTotal, offer.threshold)}
            </div>
          </div>
        `;
        existingCTA.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
      }

      console.log(`[Cart Monitor] Mini-cart CTA updated (qualified: ${qualified})`);
    }

    createMiniCartCTA(ctaId, miniCartElement) {
      const cta = document.createElement('div');
      cta.id = ctaId;
      cta.style.cssText = `
        color: white;
        border-radius: 8px;
        margin: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        transition: all 0.3s ease;
      `;

      // Try to insert at the top of mini-cart
      const cartHeader = miniCartElement.querySelector('[class*="header"]') || 
                        miniCartElement.querySelector('h2') ||
                        miniCartElement.querySelector('.cart-drawer__header');
      
      if (cartHeader) {
        cartHeader.after(cta);
      } else {
        miniCartElement.prepend(cta);
      }

      return cta;
    }

    getProgressBar(current, threshold) {
      const percentage = Math.min((current / threshold) * 100, 100);
      return `
        <div style="background: rgba(255,255,255,0.3); border-radius: 10px; height: 6px; overflow: hidden; margin-top: 8px;">
          <div style="background: white; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
        </div>
      `;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new CartMonitor();
    });
  } else {
    new CartMonitor();
  }
})();