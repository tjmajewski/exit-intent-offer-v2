(function() {
  'use strict';

  // Currency formatting helper - uses shop's active currency + buyer locale.
  // Symbol position (€10 vs 10 €, R$ 10, ¥10, 10 zł) is locale-driven via
  // Intl.NumberFormat, so each market sees their native convention.
  function formatCurrency(amount) {
    try {
      const currencyCode = window.Shopify?.currency?.active || 'USD';
      // BCP 47 locale chain. window.Shopify.country is a country code (e.g.
      // "US") which is NOT a valid locale on its own — skip it.
      const locale = (window.Shopify && window.Shopify.locale) ||
        (typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) ||
        'en';
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
    } catch (e) {
      return `${amount}`;
    }
  }

  // Detect if the cart already has competing promo surfaces (free-shipping bars,
  // discount progress trackers, upsell banners). When detected we downgrade to
  // text-only inline rendering so we don't pile on top of existing promos.
  function detectCompetingPromos(scope) {
    if (!scope) return false;
    const promoSelectors = [
      '[class*="free-shipping"]',
      '[class*="shipping-bar"]',
      '[class*="shipping-progress"]',
      '[data-shipping-threshold]',
      '[class*="cart-promotion"]',
      '[class*="cart-banner"]',
      '[class*="upsell"]',
      '[class*="goal-bar"]',
      '[class*="reward-bar"]',
      '[id*="boost-bar"]',
      '[id*="reconvert"]'
    ];
    for (const sel of promoSelectors) {
      if (scope.querySelector(sel)) return true;
    }
    // Heuristic: text-content scan for "free shipping" or "spend $X" copy
    try {
      const text = (scope.textContent || '').toLowerCase();
      if (text.includes('free shipping') || text.includes('away from free')) return true;
    } catch (_) {}
    return false;
  }

  // Clone a few visual properties off the cart's existing checkout button so
  // our injected Apply button looks like it belongs to the theme.
  function cloneCheckoutButtonStyle(scope) {
    const root = scope || document;
    const selectors = [
      '#CartDrawer-Checkout',
      'button[name="checkout"]',
      '[name="checkout"]',
      '.cart__checkout-button',
      '.cart-drawer__checkout',
      '.cart__submit',
      '[type="submit"][value*="checkout" i]'
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) {
        const cs = window.getComputedStyle(el);
        return {
          borderRadius: cs.borderRadius,
          fontFamily: cs.fontFamily,
          fontWeight: cs.fontWeight,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform
        };
      }
    }
    return null;
  }

  // Hide the persistent offer pill while a cart-surface offer is mounted
  // (one-surface rule: never stack pill + cart line).
  function hideOfferPill() {
    const pill = document.getElementById('exit-intent-offer-pill');
    if (pill) pill.remove();
  }

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
      // 1) Threshold offers (legacy path — drives progress bar / qualification banner)
      const thresholdOffer = this.getActiveOffer();
      if (thresholdOffer) {
        if (this.currentOfferId !== thresholdOffer.code) {
          console.log('[Cart Monitor] Active threshold offer found:', thresholdOffer);
          this.currentOfferId = thresholdOffer.code;
          const isCartPage = window.location.pathname.includes('/cart');
          const hasMiniCart = this.detectMiniCart();
          if (isCartPage || hasMiniCart) {
            this.startMonitoring(thresholdOffer, isCartPage, hasMiniCart);
          }
        }
        return;
      }

      // 2) Flat % / $ off offers (from dismissed-modal pending offer)
      const flatOffer = this.getPendingFlatOffer();
      if (!flatOffer) return;
      if (this.currentFlatOfferCode === flatOffer.code) return;

      const isCartPage = window.location.pathname.includes('/cart');
      const miniCart = this.detectMiniCart();
      if (!isCartPage && !miniCart) return;

      console.log('[Cart Monitor] Active flat offer found:', flatOffer);
      this.currentFlatOfferCode = flatOffer.code;

      // One-surface rule: kill the pill while cart shows the offer
      hideOfferPill();

      if (isCartPage) {
        this.mountFlatCartPageSurface(flatOffer);
      }
      if (miniCart) {
        this.mountFlatMiniCartSurface(flatOffer, miniCart);
        this.watchMiniCartForFlatOffer(miniCart, flatOffer);
      }
    }

    /**
     * Read the pending flat-discount offer set by the modal's closeModal
     * when the customer dismisses without clicking the CTA. This is the
     * surface that recovers accidental click-offs.
     */
    getPendingFlatOffer() {
      try {
        if (sessionStorage.getItem('exitIntentPillDismissed') === 'true') return null;
        const raw = sessionStorage.getItem('exitIntentPendingOffer');
        if (!raw) return null;
        const offer = JSON.parse(raw);
        if (!offer || !offer.code) return null;
        // 24h expiry matches code TTL
        if (offer.timestamp && Date.now() - offer.timestamp > 24 * 60 * 60 * 1000) {
          sessionStorage.removeItem('exitIntentPendingOffer');
          return null;
        }
        return offer;
      } catch (_) {
        return null;
      }
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
        // Only activate if the modal was actually shown this session
        if (!sessionStorage.getItem('exitIntentShown')) {
          return null;
        }

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
        console.log(`[Cart Monitor] Cart total: ${formatCurrency(currentTotal)} (threshold: ${formatCurrency(offer.threshold)})`);
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

      const t = this.getThemeTokens();

      // Create banner
      const banner = document.createElement('div');
      banner.id = 'exit-intent-qualification-banner';
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: ${t.primary};
        color: ${t.primaryText};
        padding: 16px;
        text-align: center;
        font-size: 16px;
        font-weight: 600;
        font-family: ${t.fontFamily};
        box-shadow: 0 2px 10px rgba(0,0,0,0.15);
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
            background: rgba(255,255,255,0.18);
            border: none;
            color: ${t.primaryText};
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
        <span>You qualified for ${formatCurrency(offer.discount)} off — code <strong>${offer.code}</strong> applied at checkout.</span>
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
        const t = this.getThemeTokens();

        // Create banner
        banner = document.createElement('div');
        banner.id = 'exit-intent-progress-banner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: ${t.primary};
          color: ${t.primaryText};
          padding: 16px;
          text-align: center;
          font-size: 16px;
          font-weight: 600;
          font-family: ${t.fontFamily};
          box-shadow: 0 2px 10px rgba(0,0,0,0.15);
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
              background: rgba(255,255,255,0.18);
              border: none;
              color: ${t.primaryText};
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
          <span>Add ${formatCurrency(Math.ceil(remaining / 5) * 5)} more to get ${formatCurrency(offer.discount)} off</span>
          <button class="close-banner" onclick="this.parentElement.remove()">×</button>
        `;

        document.body.appendChild(banner);
        console.log('[Cart Monitor] Progress banner displayed');
      } else {
        // Update existing banner
        banner.querySelector('span').textContent = `Add ${formatCurrency(Math.ceil(remaining / 5) * 5)} more to get ${formatCurrency(offer.discount)} off`;
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
      const t = this.getThemeTokens();

      if (qualified) {
        // Show "qualified" message
        if (!existingCTA) {
          existingCTA = this.createMiniCartCTA(ctaId, miniCartElement);
        }

        existingCTA.innerHTML = `
          <div style="text-align: center; padding: 12px;">
            <div style="font-size: 18px; font-weight: 700; margin-bottom: 4px;">You qualified</div>
            <div style="font-size: 14px; opacity: 0.92;">${formatCurrency(offer.discount)} off applied at checkout</div>
          </div>
        `;
        existingCTA.style.background = t.primary;
        existingCTA.style.color = t.primaryText;
      } else {
        // Show progress
        const remaining = offer.threshold - currentTotal;

        if (!existingCTA) {
          existingCTA = this.createMiniCartCTA(ctaId, miniCartElement);
        }

        existingCTA.innerHTML = `
          <div style="text-align: center; padding: 12px;">
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">
              Add ${formatCurrency(Math.ceil(remaining / 5) * 5)} more to get ${formatCurrency(offer.discount)} off
            </div>
            <div style="font-size: 13px; opacity: 0.9;">
              ${this.getProgressBar(currentTotal, offer.threshold)}
            </div>
          </div>
        `;
        existingCTA.style.background = t.primary;
        existingCTA.style.color = t.primaryText;
      }

      console.log(`[Cart Monitor] Mini-cart CTA updated (qualified: ${qualified})`);
    }

    // ============================================================
    // FLAT OFFER SURFACES (% off / $ off — accidental dismissal recovery)
    // Native-feeling, coexistence-aware. When the cart already shows
    // competing promos (free-shipping bars, etc.) we downgrade to a
    // text-only inline line instead of a full banner.
    // ============================================================

    buildFlatOfferLabel(offer) {
      if (offer.savingsText) return `${offer.savingsText} ready — code ${offer.code}`;
      return `Apply code ${offer.code}`;
    }

    applyFlatOffer(offer) {
      try {
        sessionStorage.setItem('exitIntentPillDismissed', 'true');
        sessionStorage.removeItem('exitIntentPendingOffer');
        const attrs = { exit_intent: 'true' };
        if (offer.aiDecisionId) attrs.exit_intent_ai_decision = offer.aiDecisionId;
        fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: attrs })
        }).catch(() => {});
      } catch (_) {}
      try { sessionStorage.setItem('exitIntentDiscount', offer.code); } catch (_) {}
      window.location.replace(`/discount/${encodeURIComponent(offer.code)}?redirect=/checkout`);
    }

    mountFlatCartPageSurface(offer) {
      const existing = document.getElementById('exit-intent-flat-cart-banner');
      if (existing) return;

      const accent = offer.accentColor || '#111827';
      const font = offer.brandFont || 'inherit';

      // Find a sensible mount point near the top of the cart
      const cartScope =
        document.querySelector('main [class*="cart"]') ||
        document.querySelector('main') ||
        document.body;

      // Coexistence check — if cart already has promo bars, render inline text-only
      const crowded = detectCompetingPromos(cartScope);
      const checkoutStyle = cloneCheckoutButtonStyle(cartScope);

      const wrap = document.createElement('div');
      wrap.id = 'exit-intent-flat-cart-banner';
      wrap.style.cssText = crowded
        ? `
          margin: 8px 0 16px 0;
          padding: 10px 12px;
          font-family: ${font};
          font-size: 14px;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          border-top: 1px solid rgba(0,0,0,0.08);
          border-bottom: 1px solid rgba(0,0,0,0.08);
        `
        : `
          margin: 12px 0 20px 0;
          padding: 14px 16px;
          background: rgba(0,0,0,0.03);
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: ${checkoutStyle?.borderRadius || '8px'};
          font-family: ${font};
          font-size: 14px;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        `;

      const label = document.createElement('span');
      label.textContent = this.buildFlatOfferLabel(offer);
      label.style.cssText = 'flex: 1; min-width: 0;';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply';
      applyBtn.style.cssText = `
        background: ${accent};
        color: #ffffff;
        border: none;
        padding: 10px 18px;
        border-radius: ${checkoutStyle?.borderRadius || '6px'};
        font-family: ${checkoutStyle?.fontFamily || font};
        font-weight: ${checkoutStyle?.fontWeight || '600'};
        font-size: 13px;
        letter-spacing: ${checkoutStyle?.letterSpacing || 'normal'};
        text-transform: ${checkoutStyle?.textTransform || 'none'};
        cursor: pointer;
        flex-shrink: 0;
      `;
      applyBtn.onclick = () => this.applyFlatOffer(offer);

      wrap.appendChild(label);
      wrap.appendChild(applyBtn);

      // Mount as the first child of the cart scope so it sits above contents
      if (cartScope.firstChild) {
        cartScope.insertBefore(wrap, cartScope.firstChild);
      } else {
        cartScope.appendChild(wrap);
      }
    }

    mountFlatMiniCartSurface(offer, miniCart) {
      const existingId = 'exit-intent-flat-minicart-line';
      if (miniCart.querySelector(`#${existingId}`)) return;

      const accent = offer.accentColor || '#111827';
      const font = offer.brandFont || 'inherit';
      const crowded = detectCompetingPromos(miniCart);
      const checkoutStyle = cloneCheckoutButtonStyle(miniCart);

      const line = document.createElement('div');
      line.id = existingId;
      line.style.cssText = crowded
        ? `
          margin: 8px 12px;
          padding: 8px 0;
          font-family: ${font};
          font-size: 13px;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-top: 1px solid rgba(0,0,0,0.08);
        `
        : `
          margin: 12px;
          padding: 10px 12px;
          background: rgba(0,0,0,0.03);
          border-radius: ${checkoutStyle?.borderRadius || '6px'};
          font-family: ${font};
          font-size: 13px;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        `;

      const label = document.createElement('span');
      label.textContent = this.buildFlatOfferLabel(offer);
      label.style.cssText = 'flex: 1; min-width: 0; line-height: 1.3;';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply';
      applyBtn.style.cssText = `
        background: ${accent};
        color: #ffffff;
        border: none;
        padding: 8px 14px;
        border-radius: ${checkoutStyle?.borderRadius || '6px'};
        font-family: ${checkoutStyle?.fontFamily || font};
        font-weight: ${checkoutStyle?.fontWeight || '600'};
        font-size: 12px;
        letter-spacing: ${checkoutStyle?.letterSpacing || 'normal'};
        text-transform: ${checkoutStyle?.textTransform || 'none'};
        cursor: pointer;
        flex-shrink: 0;
      `;
      applyBtn.onclick = () => this.applyFlatOffer(offer);

      line.appendChild(label);
      line.appendChild(applyBtn);

      // Place just above the mini-cart's checkout button when we can find one
      const checkoutBtn =
        miniCart.querySelector('#CartDrawer-Checkout') ||
        miniCart.querySelector('button[name="checkout"]') ||
        miniCart.querySelector('[name="checkout"]') ||
        miniCart.querySelector('.cart-drawer__checkout');
      if (checkoutBtn && checkoutBtn.parentElement) {
        checkoutBtn.parentElement.insertBefore(line, checkoutBtn);
      } else {
        miniCart.appendChild(line);
      }
    }

    watchMiniCartForFlatOffer(miniCart, offer) {
      // Some themes re-render the drawer contents on cart updates. Re-inject
      // if our line disappears while the drawer is still visible.
      if (this._miniCartFlatObserver) return;
      this._miniCartFlatObserver = new MutationObserver(() => {
        if (!miniCart.querySelector('#exit-intent-flat-minicart-line')) {
          // Drawer still open?
          const style = window.getComputedStyle(miniCart);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            this.mountFlatMiniCartSurface(offer, miniCart);
          }
        }
      });
      this._miniCartFlatObserver.observe(miniCart, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    createMiniCartCTA(ctaId, miniCartElement) {
      const t = this.getThemeTokens();
      const cta = document.createElement('div');
      cta.id = ctaId;
      cta.style.cssText = `
        color: ${t.primaryText};
        border-radius: ${t.borderRadius};
        margin: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        font-family: ${t.fontFamily};
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
      const t = this.getThemeTokens();
      return `
        <div style="background: ${t.trackBg}; border-radius: 999px; height: 6px; overflow: hidden; margin-top: 8px;">
          <div style="background: ${t.primaryText}; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
        </div>
      `;
    }

    // ============================================================
    // THEME TOKEN SNIFFING
    // Reads merchant's theme CSS custom properties at runtime so our
    // surfaces (banners, mini-cart CTA, progress bar) adopt the store's
    // colors, fonts, and button radius. Falls back to neutral defaults
    // if theme doesn't expose tokens.
    //
    // Supports Dawn-style themes (RGB triples like "18 18 18") and
    // direct color values. Cached after first call.
    // ============================================================
    getThemeTokens() {
      if (this._themeTokens) return this._themeTokens;

      const root = getComputedStyle(document.documentElement);
      const readVar = (name) => (root.getPropertyValue(name) || '').trim();

      // Dawn-style themes expose RGB triples ("18 18 18"); normalize to rgb()
      const toColor = (val) => {
        if (!val) return null;
        const trimmed = val.trim();
        if (/^\d+\s+\d+\s+\d+$/.test(trimmed)) {
          return `rgb(${trimmed.split(/\s+/).join(', ')})`;
        }
        return trimmed;
      };
      const pick = (vars, fallback) => {
        for (const v of vars) {
          const c = toColor(readVar(v));
          if (c) return c;
        }
        return fallback;
      };

      // Sniff a primary button for border-radius and font
      let btnRadius = '8px';
      let btnFont = '';
      const btn = document.querySelector(
        '.shopify-payment-button__button, button[type="submit"], .button--primary, ' +
        '[class*="button-primary"], .btn-primary, button.product-form__submit, ' +
        'button.cart__submit, .cart__checkout, [name="checkout"]'
      );
      if (btn) {
        const cs = getComputedStyle(btn);
        if (cs.borderRadius) btnRadius = cs.borderRadius;
        if (cs.fontFamily) btnFont = cs.fontFamily;
      }

      const primary = pick(
        ['--color-button', '--color-accent-1', '--color-primary', '--color-foreground'],
        '#1a1a1a'
      );
      const primaryText = pick(
        ['--color-button-text', '--color-background', '--color-base-background-1'],
        '#ffffff'
      );
      const accent = pick(
        ['--color-accent-2', '--color-accent-1', '--color-link'],
        primary
      );

      this._themeTokens = {
        primary,
        primaryText,
        accent,
        fontFamily: btnFont || readVar('--font-body-family') ||
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        borderRadius: btnRadius,
        // semi-transparent track derived from primaryText for use against primary bg
        trackBg: 'rgba(255, 255, 255, 0.25)'
      };
      return this._themeTokens;
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