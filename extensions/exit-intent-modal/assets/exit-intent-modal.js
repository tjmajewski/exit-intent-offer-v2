(function() {
  'use strict';

  // IMMEDIATELY check if we should redirect to checkout with discount
  const discountCode = sessionStorage.getItem('exitIntentDiscount');
  if (discountCode && window.location.pathname === '/cart') {
    console.log('[Exit Intent] Redirecting from cart to checkout with discount');
    window.location.replace(`/checkout?discount=${discountCode}`);
    return; // Stop execution
  }

  // Get settings from the snippet (will be injected by Liquid)
  const settings = window.exitIntentSettings || {};
  
  // Mobile detection helper
  function isMobileDevice() {
    return window.innerWidth <= 768 || /mobile/i.test(navigator.userAgent);
  }

  // Fetch custom CSS from shop settings
  async function fetchCustomCSS(shopDomain) {
    try {
      const response = await fetch(`/apps/exit-intent/api/custom-css-public?shop=${shopDomain}`);
      if (!response.ok) return null;
      
      const data = await response.json();
      return data.customCSS || null;
    } catch (error) {
      console.error('[Custom CSS] Failed to fetch:', error);
      return null;
    }
  }

  // Exit intent modal manager
  class ExitIntentModal {
    constructor(settings = {}) {
  this.settings = settings;
  this.modalShown = false;
  this.modalElement = null;
  this.sessionKey = 'exitIntentShown';
  this.cartItemCount = 0;
  this.lastCartValue = 0;
  this.cartTimerStarted = false;
  this.cartTimerTimeout = null;
  this.aiDecisionInProgress = false;
  this.currentVariantId = null;
  this.currentSegment = null;
  
  // Check if modal is enabled (default to true if not explicitly set to false)
  if (this.settings.enabled === false) {
        console.log('Exit intent modal is disabled');
        return;
      }
      
      // Check if already shown in this session (with fallback for blocked storage)
      try {
        if (sessionStorage.getItem(this.sessionKey)) {
          console.log('Exit intent modal already shown this session');
          return;
        }
      } catch (e) {
        console.log('[Exit Intent] SessionStorage blocked (preview mode), proceeding anyway');
      }
      
      // Initialize
      this.init();
    }
    
    async init() {
      // Create modal HTML
      this.createModal();
      
      // Inject custom CSS if Enterprise tier
      if (this.settings.plan === 'enterprise') {
        const customCSS = await fetchCustomCSS(window.Shopify.shop);
        if (customCSS) {
          const style = document.createElement('style');
          style.id = 'resparq-custom-css';
          style.textContent = customCSS;
          document.head.appendChild(style);
          console.log('[Custom CSS] Injected custom styles');
        }
      }
      
      // Track cart hesitation (Enterprise signal)
      this.trackCartHesitation();
      
      // Track product dwell time (Enterprise signal)
      this.trackProductDwellTime();
      
      // AI Mode: Set up intelligent triggers
      if (this.settings.mode === 'ai' && this.settings.plan === 'enterprise') {
        // Enterprise AI evaluation (decides if/when to show)
        await this.evaluateEnterpriseCustomer();

        // Enterprise AI controls timing completely - don't set up manual triggers
        // The AI decides: immediate, exit_intent, or delayed timing
        console.log('[Enterprise AI] AI controls all timing decisions');
      } else if (this.settings.mode === 'ai') {
        // Pro AI: Use exit intent trigger (no time delays)
        // AI determines WHAT to show, exit intent determines WHEN
        console.log('[Pro AI] Using exit intent trigger with AI-optimized offers');
        this.setupAITriggers();
      } else {
        // Manual mode: Use configured triggers
        this.setupTriggers();
      }
      
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
      
      // 2. Cart value and item count
      const cart = await fetch('/cart.js').then(r => r.json());
      const cartValue = cart.total_price / 100;
      const itemCount = cart.item_count;
      
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
      
      // 9. Scroll depth (NEW - Enterprise signal)
      const scrollDepth = this.getScrollDepth();
      
      // 10. Cart abandonment history (NEW - Enterprise signal)
      const abandonmentCount = parseInt(localStorage.getItem('exitIntentAbandonments') || '0');
      
      // 11. Add-to-cart hesitation (NEW - Enterprise signal)
      const cartHesitation = this.getCartHesitation();
      
      // 12. Product page dwell time (NEW - Enterprise signal)
      const productDwellTime = this.getProductDwellTime();
      
      return {
        visitFrequency: visits,
        cartValue,
        itemCount,
        deviceType,
        accountStatus,
        trafficSource,
        timeOnSite,
        pageViews,
        hasAbandonedBefore,
        scrollDepth,
        abandonmentCount,
        cartHesitation,
        productDwellTime
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
    
    getScrollDepth() {
      // Calculate how far down the page user has scrolled (0-100%)
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      
      const maxScroll = documentHeight - windowHeight;
      const scrollPercent = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 100;
      
      // Track max scroll depth in session
      const currentMax = parseInt(sessionStorage.getItem('maxScrollDepth') || '0');
      const newMax = Math.max(currentMax, scrollPercent);
      sessionStorage.setItem('maxScrollDepth', newMax);
      
      return newMax;
    }
    
    async getCartValue() {
      try {
        const response = await fetch('/cart.js');
        const cart = await response.json();
        return cart.total_price / 100; // Convert cents to dollars
      } catch (error) {
        console.error('[Cart Value] Error fetching cart:', error);
        return 0;
      }
    }

    getCartHesitation() {
      // Track add/remove events in session
      // Returns number of times items were added then removed
      const hesitations = parseInt(sessionStorage.getItem('cartHesitations') || '0');
      return hesitations;
    }
    
    getProductDwellTime() {
      // Track time spent on product pages
      const currentPath = window.location.pathname;
      
      // Check if on a product page
      if (currentPath.includes('/products/')) {
        const dwellStart = sessionStorage.getItem('productPageStart');
        
        if (!dwellStart) {
          // First product page of session
          sessionStorage.setItem('productPageStart', Date.now());
          return 0;
        }
        
        // Calculate total dwell time across all product pages
        const totalDwell = parseInt(sessionStorage.getItem('totalProductDwell') || '0');
        return totalDwell;
      }
      
      return 0;
    }
    
    trackCartHesitation() {
      // Listen for cart changes
      let lastCartItemCount = 0;
      
      const checkCart = async () => {
        try {
          const cart = await fetch('/cart.js').then(r => r.json());
          const currentCount = cart.item_count;
          
          // If items decreased, that's a removal (hesitation)
          if (lastCartItemCount > 0 && currentCount < lastCartItemCount) {
            const hesitations = parseInt(sessionStorage.getItem('cartHesitations') || '0');
            sessionStorage.setItem('cartHesitations', hesitations + 1);
            console.log('[Cart Hesitation] Item removed, count:', hesitations + 1);
          }
          
          lastCartItemCount = currentCount;
        } catch (error) {
          console.error('Error tracking cart hesitation:', error);
        }
      };
      
      // Check cart every 2 seconds
      setInterval(checkCart, 2000);
    }
    
    trackProductDwellTime() {
      const currentPath = window.location.pathname;
      
      // Only track on product pages
      if (!currentPath.includes('/products/')) {
        return;
      }
      
      // Start timer when page loads
      const pageStart = Date.now();
      sessionStorage.setItem('productPageStart', pageStart);
      
      // Update total dwell time every 5 seconds
      const dwellInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - pageStart) / 1000);
        const previousTotal = parseInt(sessionStorage.getItem('totalProductDwell') || '0');
        sessionStorage.setItem('totalProductDwell', previousTotal + 5);
      }, 5000);
      
      // Clean up on page unload
      window.addEventListener('beforeunload', () => {
        clearInterval(dwellInterval);
        const elapsed = Math.floor((Date.now() - pageStart) / 1000);
        const previousTotal = parseInt(sessionStorage.getItem('totalProductDwell') || '0');
        sessionStorage.setItem('totalProductDwell', previousTotal + elapsed);
      });
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
        const newCartValue = cart.total_price / 100;
        
        // Cart increased - item was added OR cart value changed significantly
        const itemCountIncreased = newItemCount > this.cartItemCount;
        const cartValueChanged = this.lastCartValue && Math.abs(newCartValue - this.lastCartValue) > 5;
        
        if ((itemCountIncreased || cartValueChanged) && !this.aiDecisionInProgress) {
          console.log('[Exit Intent] Cart changed! Items:', newItemCount, 'Value:', newCartValue);
          
          // If timer trigger is enabled, start the timer now
          const triggers = this.settings.triggers || {};
          if (triggers.timeDelay && triggers.timeDelaySeconds && !this.cartPageTimer) {
            console.log('[Exit Intent] Starting timer after cart update');
            this.startCartPageTimer(triggers.timeDelaySeconds);
          }
        }
        
        // Always update tracking values
        this.cartItemCount = newItemCount;
        this.lastCartValue = newCartValue;
      })
      .catch(err => console.error('[Exit Intent] Error polling cart:', err));
  }

  // Start timer after cart has items (works on any page)
  startCartPageTimer(delaySeconds) {
    // Check if cart has items
    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        if (cart.item_count === 0) {
          console.log('[Exit Intent] Cart is empty, timer not started');
          return;
        }
        
        console.log(`[Exit Intent] Cart has items, starting ${delaySeconds}s timer`);
        
        // Start the timer - will show modal after delay on whatever page user is on
        this.cartPageTimer = setTimeout(() => {
          if (!this.modalShown) {
            console.log(`[Exit Intent] Timer triggered after ${delaySeconds}s`);
            this.showModal();
          }
        }, delaySeconds * 1000);
      })
      .catch(err => console.error('[Exit Intent] Error checking cart:', err));
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
        align-items: ${isMobileDevice() ? 'flex-end' : 'center'};
        z-index: 9999;
      `;
      
      // Create modal content
      const modal = document.createElement('div');
      modal.id = 'exit-intent-modal';
      const isMobile = isMobileDevice();
      modal.style.cssText = `
        background: white;
        border-radius: ${isMobile ? '20px 20px 0 0' : '16px'};
        padding: ${isMobile ? '32px 20px 20px 20px' : '48px 40px 40px 40px'};
        padding-right: ${isMobile ? '60px' : '40px'};
        max-width: ${isMobile ? '100%' : '480px'};
        width: ${isMobile ? '100%' : '90%'};
        max-height: ${isMobile ? '85vh' : 'none'};
        overflow-y: ${isMobile ? 'auto' : 'visible'};
        position: relative;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        transform: ${isMobile ? 'translateY(100%)' : 'scale(0.9)'};
        transition: transform 0.3s ease-out;
      `;
      
      // Add swipe handle for mobile
      if (isMobile) {
        const swipeHandle = document.createElement('div');
        swipeHandle.style.cssText = `
          width: 40px;
          height: 4px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 2px;
          margin: 0 auto 20px auto;
        `;
        modal.appendChild(swipeHandle);
      }
      
      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.style.cssText = `
        position: absolute;
        top: ${isMobile ? '16px' : '20px'};
        right: ${isMobile ? '16px' : '20px'};
        background: #f3f4f6;
        border: none;
        font-size: ${isMobile ? '28px' : '24px'};
        cursor: pointer;
        color: #6b7280;
        line-height: 1;
        width: ${isMobile ? '44px' : '32px'};
        height: ${isMobile ? '44px' : '32px'};
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        z-index: 1;
      `;
      closeBtn.onmouseover = () => closeBtn.style.background = '#e5e7eb';
      closeBtn.onmouseout = () => closeBtn.style.background = '#f3f4f6';
      closeBtn.onclick = () => this.closeModal();
      
      // Modal content
      const headline = document.createElement('h2');
      headline.textContent = this.settings.modalHeadline || 'Wait! Don\'t leave yet 🎁';
      headline.style.cssText = `
        margin: 0 0 16px 0;
        font-size: ${isMobile ? '24px' : '32px'};
        font-weight: 700;
        color: #1f2937;
        font-family: ${this.settings.brandFont || 'inherit'};
        line-height: 1.3;
        letter-spacing: -0.02em;
      `;
      
      const body = document.createElement('p');
      body.textContent = this.settings.modalBody || 'Complete your purchase now and get free shipping on your order!';
      body.style.cssText = `
        margin: 0 0 ${isMobile ? '24px' : '32px'} 0;
        font-size: ${isMobile ? '16px' : '17px'};
        line-height: 1.6;
        color: #6b7280;
        font-family: ${this.settings.brandFont || 'inherit'};
      `;
      
      const ctaButton = document.createElement('button');
      ctaButton.id = 'modal-primary-cta';
      ctaButton.textContent = this.settings.ctaButton || 'Complete My Order';
      ctaButton.style.cssText = `
        background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
        color: white;
        border: none;
        padding: ${isMobile ? '16px 24px' : '18px 32px'};
        font-size: ${isMobile ? '18px' : '17px'};
        font-weight: 600;
        border-radius: 12px;
        box-shadow: 0 4px 14px 0 rgba(139, 92, 246, 0.39);
        cursor: pointer;
        width: 100%;
        min-height: ${isMobile ? '48px' : 'auto'};
        font-family: ${this.settings.brandFont || 'inherit'};
        transition: all 0.2s ease;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      `;
      ctaButton.onclick = () => this.handleCTAClick();
      ctaButton.onmouseover = () => {
        ctaButton.style.transform = 'translateY(-2px)';
        ctaButton.style.boxShadow = '0 6px 20px 0 rgba(139, 92, 246, 0.5)';
      };
      ctaButton.onmouseout = () => {
        ctaButton.style.transform = 'translateY(0)';
        ctaButton.style.boxShadow = '0 4px 14px 0 rgba(139, 92, 246, 0.39)';
      };
      
      // Secondary button (will be shown for threshold offers)
      const secondaryButton = document.createElement('button');
      secondaryButton.id = 'modal-secondary-cta';
      secondaryButton.textContent = 'Keep Shopping';
      secondaryButton.style.cssText = `
        background: #f9fafb;
        color: #6b7280;
        border: 1px solid #e5e7eb;
        padding: ${isMobile ? '16px 24px' : '18px 32px'};
        font-size: ${isMobile ? '18px' : '17px'};
        font-weight: 600;
        border-radius: 12px;
        cursor: pointer;
        width: 100%;
        min-height: ${isMobile ? '48px' : 'auto'};
        margin-top: 12px;
        display: none;
        font-family: ${this.settings.brandFont || 'inherit'};
        transition: all 0.2s;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      `;
      secondaryButton.onmouseover = () => {
        secondaryButton.style.background = '#f3f4f6';
        secondaryButton.style.borderColor = '#d1d5db';
      };
      secondaryButton.onmouseout = () => {
        secondaryButton.style.background = '#f9fafb';
        secondaryButton.style.borderColor = '#e5e7eb';
      };
      secondaryButton.onclick = () => this.handleSecondaryClick();
      
      // Powered by badge (Entry/Pro only - Enterprise can hide via plan tier)
      const poweredBy = document.createElement('div');
      poweredBy.id = 'modal-powered-by';
      
      // Hide for Enterprise tier
      if (this.settings.plan === 'enterprise') {
        poweredBy.style.display = 'none';
      }
      
      poweredBy.innerHTML = `
        <a href="https://resparq.ai" target="_blank" style="
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #9ca3af;
          text-decoration: none;
          margin-top: 16px;
          float: right;
          transition: color 0.2s;
        " onmouseover="this.style.color='#8B5CF6'" onmouseout="this.style.color='#9ca3af'">
          <span>Powered by</span>
          <span style="font-weight: 600; color: #8B5CF6;">ResparQ</span>
          <span style="font-size: 13px;">⚡</span>
        </a>
      `;
      
      // Add swipe-to-dismiss for mobile
      if (isMobile) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        
        modal.addEventListener('touchstart', (e) => {
          // Only start drag if touching the modal background (not buttons)
          if (e.target === modal || e.target.tagName === 'H2' || e.target.tagName === 'P') {
            startY = e.touches[0].clientY;
            isDragging = true;
          }
        }, { passive: true });
        
        modal.addEventListener('touchmove', (e) => {
          if (!isDragging) return;
          currentY = e.touches[0].clientY;
          const diff = currentY - startY;
          
          // Only allow downward swipes
          if (diff > 0) {
            modal.style.transform = `translateY(${diff}px)`;
            modal.style.transition = 'none';
          }
        }, { passive: true });
        
        modal.addEventListener('touchend', () => {
          if (!isDragging) return;
          isDragging = false;
          
          const diff = currentY - startY;
          
          // If swiped down more than 100px, close modal
          if (diff > 100) {
            this.closeModal();
            this.trackEvent('modal_swiped_closed');
          } else {
            // Reset position with animation
            modal.style.transition = 'transform 0.3s ease-out';
            modal.style.transform = 'translateY(0)';
          }
        }, { passive: true });
      }
      
      // Assemble modal
      modal.appendChild(closeBtn);
      modal.appendChild(headline);
      modal.appendChild(body);
      modal.appendChild(ctaButton);
      modal.appendChild(secondaryButton);
      modal.appendChild(poweredBy);
      overlay.appendChild(modal);
      
      // Add to page
      document.body.appendChild(overlay);
      this.modalElement = overlay;
    }
    
    async evaluateEnterpriseCustomer() {
      console.log('[Enterprise AI] Evaluating customer...');
      
      // Check if cart has items first
      const hasItems = await this.hasItemsInCart();
      if (!hasItems) {
        console.log('[Enterprise AI] Cart is empty, not evaluating');
        return;
      }
      
      // Collect basic signals
      const basicSignals = await this.collectCustomerSignals();
      
      // Enrich signals with backend data
      const enrichedSignals = await this.enrichSignals(basicSignals);
      
      console.log('[Enterprise AI] Propensity score:', enrichedSignals.propensityScore);
      
      // Get Enterprise AI decision
      const decision = await this.getEnterpriseDecision(enrichedSignals);
      
      if (!decision) {
        console.log('[Enterprise AI] AI decided not to show modal');
        return;
      }
      
      console.log('[Enterprise AI] Decision:', decision);
      
      // AI controls when to show (default to immediate if timing not specified)
      if (!decision.timing || decision.timing === 'immediate') {
        // Show right away
        setTimeout(() => this.showModalWithOffer(decision), 1000);
      } else if (decision.timing === 'exit_intent') {
        // Wait for exit intent
        document.addEventListener('mouseout', (e) => {
          if (e.clientY < 0 && !this.modalShown) {
            this.showModalWithOffer(decision);
          }
        });
      } else if (decision.timing === 'delayed' && decision.delay) {
        // Delayed show
        setTimeout(() => this.showModalWithOffer(decision), decision.delay * 1000);
      }
    }
    
    async enrichSignals(basicSignals) {
      try {
        const cart = await fetch('/cart.js').then(r => r.json());
        
        const response = await fetch('/apps/exit-intent/api/enrich-signals', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            customerId: window.Shopify?.customer?.id,
            cart: cart,
            basicSignals: basicSignals
          })
        });
        
        return await response.json();
      } catch (error) {
        console.error('[Enterprise AI] Error enriching signals:', error);
        return basicSignals; // Fallback to basic signals
      }
    }
    
    async getEnterpriseDecision(enrichedSignals) {
      try {
        const response = await fetch('/apps/exit-intent/api/ai-decision', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            shop: window.Shopify.shop,
            signals: enrichedSignals,
            mode: 'enterprise' // Tell backend to use Enterprise AI
          })
        });
        
        const data = await response.json();
        return data.decision || null; // Return decision object or null
      } catch (error) {
        console.error('[Enterprise AI] Error getting decision:', error);
        return null; // Don't show on error
      }
    }
    
    showModalWithOffer(decision) {
      console.log('[Modal] showModalWithOffer called with decision:', decision);
      // Store the AI decision for the modal to use
      this.enterpriseOffer = decision;
      this.showModal();
    }

    setupAITriggers() {
      // Pro AI Mode: Use exit intent as primary trigger (no time delays)
      // Exit intent trigger (desktop only)
      if (!isMobileDevice()) {
        document.addEventListener('mouseout', async (e) => {
          if (e.clientY < 0 && !this.modalShown) {
            // Check if cart has items before showing
            const hasItems = await this.hasItemsInCart();
            if (hasItems) {
              this.showModal();
            } else {
              console.log('[Pro AI] Cart is empty, not showing modal');
            }
          }
        });
        console.log('[Pro AI] Exit intent trigger enabled');
      }

      // Only use cart value trigger if explicitly configured
      const triggers = this.settings.triggers || {};
      if (triggers.cartValue && (triggers.minCartValue || triggers.maxCartValue)) {
        this.checkCartValue();
      }
    }

    setupTriggers() {
      const triggers = this.settings.triggers || {};
      
      // Exit intent trigger (desktop only)
      if (triggers.exitIntent && !isMobileDevice()) {
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
        this.startCartPageTimer(triggers.timeDelaySeconds);
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

      // IMPORTANT: Get AI decision BEFORE showing modal to prevent flash of manual content
      // If we have an enterprise offer stored, use it
      if (this.enterpriseOffer) {
        await this.updateModalWithAI(this.enterpriseOffer);
      }
      // Otherwise if AI mode is enabled, get AI decision
      else if (this.settings.mode === 'ai') {
        await this.getAIDecision();
      }

      // NOW show the modal after content is ready
      // Prevent body scroll on mobile
      if (isMobileDevice()) {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
      }

      this.modalElement.style.display = 'flex';

      // Trigger animation
      requestAnimationFrame(() => {
        const modal = this.modalElement.querySelector('#exit-intent-modal');
        if (modal) {
          modal.style.transform = isMobileDevice() ? 'translateY(0)' : 'scale(1)';
        }
      });

      this.modalShown = true;
      
      // Mark as shown in session storage (won't show again this session)
      try {
  sessionStorage.setItem(this.sessionKey, 'true');
} catch (e) {
  console.log('[Exit Intent] Could not set sessionStorage (preview mode)');
}
      
      // Track impression
      this.trackEvent('impression');
      
      // Track variant impression (both Pro and Enterprise)
      this.trackVariant('impression');
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

        // Enhanced console logging for transparency
        console.log('%c═══════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        console.log('%c AI DECISION', 'color: #8B5CF6; font-weight: bold; font-size: 16px');
        console.log('%c═══════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');

        if (result.decision) {
          const dec = result.decision;
          console.log('%c📊 Offer Type:', 'color: #10b981; font-weight: bold', dec.type?.toUpperCase() || 'UNKNOWN');

          if (dec.type === 'percentage') {
            console.log('%c💰 Discount:', 'color: #f59e0b; font-weight: bold', `${dec.amount}% OFF`);
          } else if (dec.type === 'fixed') {
            console.log('%c💰 Discount:', 'color: #f59e0b; font-weight: bold', `$${dec.amount} OFF`);
          } else if (dec.type === 'threshold') {
            console.log('%c🎯 Threshold:', 'color: #f59e0b; font-weight: bold', `Spend $${dec.threshold} → Save $${dec.amount}`);
          }

          if (dec.code) {
            console.log('%c🎫 Discount Code:', 'color: #06b6d4; font-weight: bold', dec.code);
          }

          if (dec.variant) {
            console.log('%c📝 Variant:', 'color: #8b5cf6; font-weight: bold', `#${dec.variant.id} (${dec.variant.segment || 'default'})`);
            console.log('%c💬 Headline:', 'color: #6366f1', dec.variant.headline);
            console.log('%c💬 Subhead:', 'color: #6366f1', dec.variant.subhead);
            console.log('%c🔘 CTA:', 'color: #6366f1', dec.variant.cta);
          }

          console.log('%c📈 Variant ID:', 'color: #64748b', dec.variantId || 'N/A');
          console.log('%c🎯 Segment:', 'color: #64748b', dec.segment || 'default');
          console.log('%c═══════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');

          // Update modal with AI decision (await to ensure content is ready)
          await this.updateModalWithAI(result.decision);
        } else {
          console.log('%c⚠️ No decision returned', 'color: #ef4444; font-weight: bold');
          console.log('%c═══════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        }
      } catch (error) {
        console.error('[AI Mode] Error getting AI decision:', error);
        // Fall back to manual settings if AI fails
      }
    }
    
    async updateModalWithAI(decision) {
      const modal = this.modalElement.querySelector('#exit-intent-modal');
      const headline = modal.querySelector('h2');
      const body = modal.querySelector('p');
      const button = modal.querySelector('#modal-primary-cta');
      
      // Store variant info for tracking (both Pro and Enterprise)
      this.currentVariantId = decision.variantId || decision.variant?.id || null;
      this.currentSegment = decision.segment || null;
      this.currentImpressionId = decision.impressionId || null;
      this.currentImpressionId = decision.impressionId || null;
      
      // Use variant copy if provided (from evolution system)
      if (decision.variant) {
        // Get current cart value
        const cartValue = await this.getCartValue();
        
        // Calculate threshold remaining (rounded up to nearest $5)
        const thresholdRemaining = decision.threshold ? Math.ceil((decision.threshold - cartValue) / 5) * 5 : 0;
        const percentToGoal = decision.threshold ? Math.round((cartValue / decision.threshold) * 100) : 0;
        
        // Replace placeholders in variant genes
        const replacements = {
          '{{amount}}': decision.amount,
          '{{threshold}}': decision.threshold || 0,
          '{{threshold_remaining}}': `$${thresholdRemaining}`,
          '{{percent_to_goal}}': percentToGoal
        };
        
        let headlineText = decision.variant.headline;
        let subheadText = decision.variant.subhead;
        let ctaText = decision.variant.cta;
        
        // Replace all placeholders
        Object.keys(replacements).forEach(placeholder => {
          headlineText = headlineText.replace(new RegExp(placeholder, 'g'), replacements[placeholder]);
          subheadText = subheadText.replace(new RegExp(placeholder, 'g'), replacements[placeholder]);
          ctaText = ctaText.replace(new RegExp(placeholder, 'g'), replacements[placeholder]);
        });
        
        headline.textContent = headlineText;
        body.textContent = subheadText;
        button.textContent = ctaText;
        
        this.settings.discountCode = decision.code;
        this.settings.offerType = decision.type;
        
        console.log(`[Modal] Enterprise - Using variant ${decision.variant.id} for segment ${decision.variant.segment}`);
        
        // Show secondary button for threshold offers
        if (decision.type === 'threshold') {
          const secondaryBtn = modal.querySelector('#modal-secondary-cta');
          const primaryBtn = modal.querySelector('#modal-primary-cta');

          if (secondaryBtn) {
            secondaryBtn.style.display = 'block';
            secondaryBtn.textContent = 'Checkout Now';
          }

          // Update primary button text to be about shopping, not checkout
          if (primaryBtn && primaryBtn.textContent.toLowerCase().includes('checkout')) {
            primaryBtn.textContent = 'Keep Shopping';
          }

          // Store threshold offer for cart monitor
          sessionStorage.setItem('exitIntentThresholdOffer', JSON.stringify({
            code: decision.code,
            threshold: decision.threshold,
            discount: decision.amount,
            timestamp: Date.now()
          }));
        }
        
        return; // Skip default copy logic below
      }
      
      // Pro users get default copy below
      console.log(`[Modal] Pro - Using default copy, tracking variant ${this.currentVariantId}`);
      
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

        // Show secondary button for threshold offers
        const secondaryBtn = modal.querySelector('#modal-secondary-cta');
        if (secondaryBtn) {
          secondaryBtn.style.display = 'block';
          secondaryBtn.textContent = 'Checkout Now';
        }

        // Update primary button text to encourage MORE shopping
        const primaryBtn = modal.querySelector('#modal-primary-cta');
        if (primaryBtn) {
          primaryBtn.textContent = 'Keep Shopping';
        }

        // 🆕 STORE THRESHOLD INFO FOR CART MONITORING
        sessionStorage.setItem('exitIntentThresholdOffer', JSON.stringify({
          code: decision.code,
          threshold: decision.threshold,
          discount: decision.amount,
          timestamp: Date.now()
        }));
        console.log(`[Threshold Offer] Stored in sessionStorage: Spend $${decision.threshold}, save $${decision.amount}`);
      }
      
      console.log(`[AI Mode] Updated modal with ${decision.type} offer`);
    }
    
    closeModal() {
      if (!this.modalElement) return;
      
      const modal = this.modalElement.querySelector('#exit-intent-modal');
      
      // Animate out
      if (modal) {
        modal.style.transform = isMobileDevice() ? 'translateY(100%)' : 'scale(0.9)';
      }
      
      // Restore body scroll on mobile
      if (isMobileDevice()) {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
      }
      
      // Remove from DOM after animation
      setTimeout(() => {
        if (this.modalElement) {
          this.modalElement.remove();
          this.modalElement = null;
        }
      }, 300);
      
      // Track close
      this.trackEvent('closeout');
    }
    
 async handleCTAClick() {
      // Track button click
      this.trackEvent('click');

      // Track variant click (both Pro and Enterprise)
      this.trackVariant('click');

      // Track click for evolution system
      if (this.currentImpressionId) {
        try {
          await fetch('/apps/exit-intent/api/track-click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              impressionId: this.currentImpressionId,
              buttonType: 'primary'
            })
          });
          console.log('[Click Tracking] Primary button click recorded');
        } catch (error) {
          console.error('[Click Tracking] Error:', error);
        }
      }

      // Close modal
      this.closeModal();

      // Get settings
      const discountCode = this.settings.discountCode;
      const offerType = this.settings.offerType || 'percentage';
      const destination = this.settings.redirectDestination || 'checkout';

      // THRESHOLD OFFER: Primary CTA should encourage MORE shopping
      if (offerType === 'threshold') {
        console.log('[Threshold Offer] Primary CTA - redirecting to continue shopping');

        // Try to send them back to where they were shopping
        // Priority: 1) Previous page if it was a product/collection, 2) /collections, 3) Homepage
        const referrer = document.referrer;
        const currentDomain = window.location.origin;

        // If they came from a product or collection page on this site, go back there
        if (referrer && referrer.startsWith(currentDomain) &&
            (referrer.includes('/products/') || referrer.includes('/collections/'))) {
          console.log('[Threshold Offer] Going back to previous shopping page:', referrer);
          window.location.href = referrer;
        }
        // Otherwise try /collections (works on most themes)
        else if (window.location.pathname !== '/collections') {
          console.log('[Threshold Offer] Going to /collections');
          window.location.href = '/collections';
        }
        // Fallback to homepage
        else {
          console.log('[Threshold Offer] Going to homepage');
          window.location.href = '/';
        }
        return;
      }

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
    
    async handleSecondaryClick() {
      // Track secondary button click for evolution system
      if (this.currentImpressionId) {
        try {
          await fetch('/apps/exit-intent/api/track-click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              impressionId: this.currentImpressionId,
              buttonType: 'secondary'
            })
          });
          console.log('[Click Tracking] Secondary button click recorded');
        } catch (error) {
          console.error('[Click Tracking] Error:', error);
        }
      }

      // Close modal
      this.closeModal();

      // THRESHOLD OFFER: Secondary CTA should go to checkout
      const offerType = this.settings.offerType || 'percentage';
      if (offerType === 'threshold') {
        const discountCode = this.settings.discountCode;
        const redirectUrl = discountCode ? `/checkout?discount=${discountCode}` : '/checkout';
        console.log('[Threshold Offer] Secondary CTA - redirecting to checkout' + (discountCode ? ' with discount: ' + discountCode : ''));
        window.location.href = redirectUrl;
      }

      // For non-threshold offers, just close the modal (current behavior)
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
    
    async trackVariant(event, revenue = 0) {
      // Track variant performance (both Pro and Enterprise contribute to learning)
      if (!this.currentVariantId) {
        console.log('[Exit Intent] No variant ID to track');
        return;
      }
      
      try {
        await fetch('/apps/exit-intent/api/track-variant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop: window.Shopify.shop,
            variantId: this.currentVariantId,
            event: event,
            revenue: revenue
          })
        });
        
        console.log(`[Exit Intent] Tracked ${event} for variant ${this.currentVariantId} (segment: ${this.currentSegment})`);
      } catch (error) {
        console.error('[Exit Intent] Variant tracking error:', error);
      }
    }
  }
  
  // Intercept mini-cart checkout to apply discount
  function interceptMiniCartCheckout() {
    console.log('[Exit Intent] Setting up checkout interception');

    // Use event delegation - listen on document for ALL clicks
    document.addEventListener('click', (e) => {
      // Check if clicked element is the checkout button (or inside it)
      const checkoutButton = e.target.closest('#CartDrawer-Checkout, button[name="checkout"]');
      
      if (checkoutButton) {
        const code = sessionStorage.getItem('exitIntentDiscount');
        if (code) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log(`[Exit Intent] Intercepted checkout click! Redirecting with discount: ${code}`);
          window.location.href = `/checkout?discount=${code}`;
        }
      }
    }, true); // Use capture phase
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
    document.addEventListener('DOMContentLoaded', () => {
      autoApplyCartDiscount();
      interceptMiniCartCheckout();
    });
  } else {
    autoApplyCartDiscount();
    interceptMiniCartCheckout();
  }
  
  // Fix Shopify preview bar blocking clicks
  function fixPreviewBar() {
    // Need to check multiple times because preview bar loads after page
    const checkInterval = setInterval(() => {
      const previewBar = document.getElementById('PBarNextFrame');
      const previewWrapper = document.getElementById('PBarNextFrameWrapper');
      
      if (previewBar || previewWrapper) {
        if (previewBar) previewBar.style.pointerEvents = 'none';
        if (previewWrapper) previewWrapper.style.pointerEvents = 'none';
        console.log('[Exit Intent] Fixed Shopify preview bar blocking clicks');
        clearInterval(checkInterval);
      }
    }, 100);
    
    // Stop checking after 5 seconds
    setTimeout(() => clearInterval(checkInterval), 5000);
  }

  // Fetch shop settings including plan tier
  async function fetchShopSettings() {
    try {
      const response = await fetch(`/apps/exit-intent/api/shop-settings?shop=${window.Shopify.shop}`);
      if (!response.ok) return { plan: 'starter' };
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[Exit Intent] Failed to fetch settings:', error);
      return { plan: 'starter' };
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      fixPreviewBar();
      const settings = await fetchShopSettings();

      // Enhanced logging for AI mode
      if (settings.mode === 'ai') {
        console.log('%c════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        console.log('%c⚡ AI MODE ACTIVE', 'color: #8B5CF6; font-weight: bold; font-size: 14px');
        console.log('%c════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        console.log('%cℹ️  AI will generate custom offers when modal triggers', 'color: #64748b; font-style: italic');
        console.log('%cℹ️  Look for "🤖 AI DECISION" log when exit intent fires', 'color: #64748b; font-style: italic');
        console.log('%c════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        // Don't log settings object - it's just clutter for AI mode
      } else {
        console.log('[Exit Intent] Shop settings loaded:', settings);
      }

      new ExitIntentModal(settings);
    });
  } else {
    (async () => {
      fixPreviewBar();
      const settings = await fetchShopSettings();

      // Enhanced logging for AI mode
      if (settings.mode === 'ai') {
        console.log('%c════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        console.log('%c⚡ AI MODE ACTIVE', 'color: #8B5CF6; font-weight: bold; font-size: 14px');
        console.log('%c════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        console.log('%cℹ️  AI will generate custom offers when modal triggers', 'color: #64748b; font-style: italic');
        console.log('%cℹ️  Look for "🤖 AI DECISION" log when exit intent fires', 'color: #64748b; font-style: italic');
        console.log('%c════════════════════════════════════════════', 'color: #8B5CF6; font-weight: bold');
        // Don't log settings object - it's just clutter for AI mode
      } else {
        console.log('[Exit Intent] Shop settings loaded:', settings);
      }

      new ExitIntentModal(settings);
    })();
  }
})();