/**
 * Resparq modal template registry
 *
 * Each template is a self-contained renderer with the same input contract.
 * The dispatcher picks one by templateId at modal-render time.
 *
 * Adding a new template:
 *   1. Add a render function below following the same shape
 *   2. Register it in TEMPLATES at the bottom of this file
 *   3. That's it — picker UI, AI gene, preview pane all read from TEMPLATES
 *
 * All renderers return { overlay, modal, primaryCta, secondaryCta, closeBtn }
 * so exit-intent-modal.js can attach handlers and run its existing show/hide
 * lifecycle without caring which template was rendered.
 */
(function () {
  'use strict';

  if (window.ResparqTemplates) return; // idempotent load

  // ===========================================================================
  // THEME TOKEN SNIFFING
  // Reads merchant theme CSS custom properties + primary-button computed style
  // so templates adopt the store's colors, fonts, and border-radius.
  // Cached after first call.
  // ===========================================================================
  let _themeTokens = null;
  function getThemeTokens() {
    if (_themeTokens) return _themeTokens;

    const root = getComputedStyle(document.documentElement);
    const readVar = (name) => (root.getPropertyValue(name) || '').trim();

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
    const background = pick(
      ['--color-background', '--color-base-background-1'],
      '#ffffff'
    );
    const foreground = pick(
      ['--color-foreground', '--color-base-text'],
      '#1a1a1a'
    );
    const muted = pick(['--color-base-text-light'], '#6b7280');

    _themeTokens = {
      primary,
      primaryText,
      background,
      foreground,
      muted,
      fontFamily: btnFont || readVar('--font-body-family') ||
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      borderRadius: btnRadius
    };
    return _themeTokens;
  }

  // Allow callers (e.g. preview pane) to inject override tokens.
  function setThemeTokens(tokens) {
    _themeTokens = { ...getThemeTokens(), ...tokens };
  }

  function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  // ===========================================================================
  // OPAQUE BACKGROUND GUARD
  // Theme sniffing returned transparent / invalid colors on some merchant
  // themes (Dawn variants, dark-mode overrides). Modal must always be opaque
  // and high-contrast. Validate background; fall back to white if unsafe.
  // ===========================================================================
  function isSafeOpaqueColor(c) {
    if (!c || typeof c !== 'string') return false;
    const v = c.trim().toLowerCase();
    if (!v || v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'unset') return false;
    // Reject any rgba with alpha < 0.9
    const rgba = v.match(/rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+\s*[,/]?\s*([\d.]+)?/);
    if (rgba && rgba[1] && parseFloat(rgba[1]) < 0.9) return false;
    return true;
  }

  /**
   * Merge sniffed tokens with merchant-provided overrides (brand settings).
   * Merchant settings always win for visible colors. Sniffed values are kept
   * for borderRadius and fontFamily (low risk to defer to theme).
   *
   * Caller passes brand settings as `{ primary, primaryText, background,
   * foreground }` — typically built from settings.brand* in the storefront.
   */
  function tokensFor(overrides) {
    const sniffed = getThemeTokens();
    const o = overrides || {};
    return {
      primary: o.primary || sniffed.primary,
      primaryText: o.primaryText || sniffed.primaryText,
      background: isSafeOpaqueColor(o.background) ? o.background
                : isSafeOpaqueColor(sniffed.background) ? sniffed.background
                : '#ffffff',
      foreground: o.foreground || sniffed.foreground || '#1a1a1a',
      muted: o.muted || sniffed.muted,
      accent: o.accent || sniffed.accent || (o.primary || sniffed.primary),
      borderRadius: sniffed.borderRadius,
      fontFamily: o.fontFamily || sniffed.fontFamily
    };
  }

  // ===========================================================================
  // SHARED PRIMITIVES
  // ===========================================================================

  function makeOverlay({ align = 'center', opaque = true } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'resparq-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: ${opaque ? 'rgba(0,0,0,0.6)' : 'transparent'};
      display: none;
      justify-content: center;
      align-items: ${align};
      z-index: 9999;
      pointer-events: ${opaque ? 'auto' : 'none'};
    `;
    return overlay;
  }

  function makeCloseButton(t, { tone = 'light' } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML = '&times;';
    const bg = tone === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)';
    const color = tone === 'dark' ? t.primaryText : t.foreground;
    btn.style.cssText = `
      position: absolute;
      top: 14px;
      right: 14px;
      background: ${bg};
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      color: ${color};
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      z-index: 2;
    `;
    return btn;
  }

  function makePrimaryButton(text, t, { full = true } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = `
      background: ${t.primary};
      color: ${t.primaryText};
      border: none;
      padding: 14px 24px;
      font-size: 16px;
      font-weight: 600;
      border-radius: ${t.borderRadius};
      cursor: pointer;
      width: ${full ? '100%' : 'auto'};
      min-height: 48px;
      font-family: ${t.fontFamily};
      transition: opacity 0.15s, transform 0.15s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    `;
    btn.onmouseover = () => { btn.style.opacity = '0.92'; };
    btn.onmouseout = () => { btn.style.opacity = '1'; };
    return btn;
  }

  function makeSecondaryButton(text, t) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = `
      background: transparent;
      color: ${t.muted};
      border: none;
      padding: 12px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
      margin-top: 4px;
      font-family: ${t.fontFamily};
      text-decoration: underline;
      text-underline-offset: 3px;
    `;
    return btn;
  }

  function makeDiscountBadge(amountText, t) {
    if (!amountText) return null;
    const el = document.createElement('div');
    el.textContent = `${amountText} OFF`;
    el.style.cssText = `
      display: inline-block;
      background: ${t.primary};
      color: ${t.primaryText};
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    `;
    return el;
  }

  /**
   * Cart-item thumbnail row (showProductImages gene). Renders up to 3 images;
   * returns null when there's nothing to draw. Injected by the dispatcher so
   * every template gets it without per-template wiring.
   */
  function makeProductImageRow(images, t) {
    if (!Array.isArray(images) || images.length === 0) return null;
    const row = document.createElement('div');
    row.className = 'resparq-product-images';
    row.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: center;
      margin: 0 0 18px;
    `;
    images.slice(0, 3).forEach((item) => {
      if (!item || !item.image) return;
      const img = document.createElement('img');
      // Shopify CDN image API: request a small rendition, not the full asset.
      // Only http(s)/protocol-relative URLs take the width param — anything
      // else (data URIs in QA harnesses) passes through untouched.
      img.src = /^(https?:)?\/\//.test(item.image)
        ? item.image + (item.image.includes('?') ? '&' : '?') + 'width=128'
        : item.image;
      img.alt = item.title || '';
      img.loading = 'lazy';
      img.onerror = () => { img.style.display = 'none'; };
      img.style.cssText = `
        width: 64px;
        height: 64px;
        object-fit: cover;
        border-radius: ${t.borderRadius};
        border: 1px solid rgba(0,0,0,0.08);
        background: #ffffff;
        flex: 0 0 auto;
      `;
      row.appendChild(img);
    });
    return row.children.length > 0 ? row : null;
  }

  // Layouts where a thumbnail row doesn't fit: top-banner is a slim strip,
  // scratch-reveal's canvas interaction leaves no room above the CTA.
  const NO_IMAGE_ROW_TEMPLATES = ['top-banner', 'scratch-reveal'];

  function makePoweredBy(show) {
    const el = document.createElement('div');
    if (!show) { el.style.display = 'none'; return el; }
    el.innerHTML =
      '<p style="margin:14px 0 0;text-align:right;font-size:10px;opacity:0.4;color:#666;' +
      'letter-spacing:0.02em;font-family:sans-serif;line-height:1.4;">' +
      '<a href="https://resparq.ai" target="_blank" rel="noopener noreferrer" ' +
      'style="color:inherit;text-decoration:none;">Powered by Resparq</a></p>';
    return el;
  }

  // ===========================================================================
  // TEMPLATE 1: CLASSIC CARD
  // Centered modal, soft shadow, neutral baseline. Single column.
  // ===========================================================================
  function renderClassicCard(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-classic-card';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      padding: ${mobile ? '32px 22px 22px' : '40px 36px 32px'};
      max-width: ${mobile ? '100%' : '460px'};
      width: ${mobile ? '100%' : '90%'};
      position: relative;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.3);
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t);

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 12px;
      font-size: ${mobile ? '24px' : '28px'};
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: ${t.foreground};
    `;

    const subhead = document.createElement('p');
    subhead.textContent = props.subhead;
    subhead.style.cssText = `
      margin: 0 0 24px;
      font-size: 15px;
      line-height: 1.5;
      color: ${t.muted};
    `;

    const primaryCta = makePrimaryButton(props.cta, t);
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    const badge = makeDiscountBadge(props.amountText, t);
    if (badge) modal.appendChild(badge);
    modal.appendChild(headline);
    modal.appendChild(subhead);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 2: TOP BANNER
  // Slim non-blocking strip at top of viewport. No dark overlay.
  // Headline left, inline CTA right, small close button.
  // ===========================================================================
  // Find the storefront header so the top-banner can sit below it rather than
  // overlap it. Picks the tallest visible, full-width-ish element anchored at
  // the very top of the viewport. Returns its bottom edge (px), capped for
  // safety, or 0 when no header is found / the page is scrolled past it.
  function bannerTopInset() {
    let inset = 0;
    try {
      const sel = [
        'header',
        '.header',
        '.site-header',
        '#shopify-section-header',
        '[data-section-type="header"]',
        '[class*="ection-header"]'
      ].join(',');
      document.querySelectorAll(sel).forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.top <= 4 && r.height > 8 && r.width >= window.innerWidth * 0.6 && r.bottom > inset) {
          inset = r.bottom;
        }
      });
    } catch (_) {}
    return Math.min(Math.max(inset, 0), 240);
  }

  function renderTopBanner(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    // Banner doesn't use a dark overlay — it's non-intrusive by design.
    // We still wrap in an overlay div for show/hide consistency.
    // Sit BELOW the storefront's header instead of covering it: measure any
    // header-like element anchored at the top and offset the banner past it.
    const topInset = bannerTopInset();
    const overlay = document.createElement('div');
    overlay.className = 'resparq-overlay resparq-banner-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: ${topInset}px;
      left: 0;
      right: 0;
      display: none;
      z-index: 9999;
      animation: resparq-slide-down 0.35s ease-out;
    `;

    const styleTag = document.createElement('style');
    styleTag.textContent = `
      @keyframes resparq-slide-down {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    `;
    overlay.appendChild(styleTag);

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-top-banner';
    modal.style.cssText = `
      background: ${t.primary};
      color: ${t.primaryText};
      padding: ${mobile ? '12px 16px' : '14px 24px'};
      font-family: ${t.fontFamily};
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      position: relative;
    `;

    const text = document.createElement('div');
    const headlineSpan = document.createElement('strong');
    // Surface discount amount inline in the banner so the offer is unmissable.
    headlineSpan.textContent = props.amountText
      ? `${props.amountText} OFF — ${props.headline}`
      : props.headline;
    headlineSpan.style.cssText = 'font-size: 15px; font-weight: 700;';
    const subSpan = document.createElement('span');
    subSpan.textContent = props.subhead ? ` — ${props.subhead}` : '';
    subSpan.style.cssText = 'font-size: 14px; opacity: 0.92; margin-left: 6px;';
    text.appendChild(headlineSpan);
    text.appendChild(subSpan);

    const primaryCta = document.createElement('button');
    primaryCta.type = 'button';
    primaryCta.textContent = props.cta;
    primaryCta.style.cssText = `
      background: ${t.primaryText};
      color: ${t.primary};
      border: none;
      padding: 8px 18px;
      font-size: 14px;
      font-weight: 600;
      border-radius: ${t.borderRadius};
      cursor: pointer;
      font-family: ${t.fontFamily};
      white-space: nowrap;
    `;

    const closeBtn = makeCloseButton(t, { tone: 'dark' });
    closeBtn.style.position = 'static';
    closeBtn.style.width = '28px';
    closeBtn.style.height = '28px';
    closeBtn.style.marginLeft = '4px';

    const secondaryCta = makeSecondaryButton('No thanks', t);
    secondaryCta.style.display = 'none'; // banner has no secondary

    modal.appendChild(text);
    modal.appendChild(primaryCta);
    modal.appendChild(closeBtn);
    overlay.appendChild(modal);

    // Append hidden secondary for handler-attach consistency
    overlay.appendChild(secondaryCta);

    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 3: BOTTOM SHEET
  // Slides up from bottom. Native iOS/Android pattern. Mobile-first but
  // also works on desktop (anchored to bottom).
  // ===========================================================================
  function renderBottomSheet(props) {
    const t = tokensFor(props.themeOverrides);

    const overlay = makeOverlay({ align: 'flex-end' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-bottom-sheet';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: 20px 20px 0 0;
      padding: 16px 24px 28px;
      width: 100%;
      max-width: 560px;
      position: relative;
      box-shadow: 0 -10px 40px -10px rgba(0,0,0,0.25);
      font-family: ${t.fontFamily};
    `;

    const handle = document.createElement('div');
    handle.style.cssText = `
      width: 44px;
      height: 5px;
      background: rgba(0,0,0,0.18);
      border-radius: 999px;
      margin: 0 auto 18px;
    `;

    const closeBtn = makeCloseButton(t);

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 8px 0 8px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: ${t.foreground};
    `;

    const subhead = document.createElement('p');
    subhead.textContent = props.subhead;
    subhead.style.cssText = `
      margin: 0 0 22px;
      font-size: 15px;
      line-height: 1.5;
      color: ${t.muted};
    `;

    const primaryCta = makePrimaryButton(props.cta, t);
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'Not now', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(handle);
    modal.appendChild(closeBtn);
    const sheetBadge = makeDiscountBadge(props.amountText, t);
    if (sheetBadge) modal.appendChild(sheetBadge);
    modal.appendChild(headline);
    modal.appendChild(subhead);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 4: COUPON TICKET
  // Gamified ticket look with dashed edge. Discount amount as the hero element.
  // ===========================================================================
  function renderCouponTicket(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: 'center' });

    // Outer card (provides spacing/shadow + close)
    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-coupon-ticket';
    modal.style.cssText = `
      background: transparent;
      max-width: ${mobile ? '92%' : '440px'};
      width: 100%;
      position: relative;
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t, { tone: 'dark' });
    closeBtn.style.top = '-12px';
    closeBtn.style.right = '-12px';
    closeBtn.style.background = t.primary;
    closeBtn.style.color = t.primaryText;
    closeBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';

    // Coupon body with dashed edge
    const ticket = document.createElement('div');
    ticket.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border: 2px dashed ${t.primary};
      border-radius: 14px;
      padding: 28px 24px 24px;
      text-align: center;
      box-shadow: 0 20px 60px -20px rgba(0,0,0,0.35);
      position: relative;
    `;

    const tag = document.createElement('div');
    tag.textContent = 'EXCLUSIVE OFFER';
    tag.style.cssText = `
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: ${t.primary};
      margin-bottom: 10px;
    `;

    const hero = document.createElement('div');
    // Show the discount amount as the hero (fall back to headline if no amount)
    if (props.amountText) {
      hero.textContent = props.amountText;
    } else if (props.amount) {
      hero.textContent = props.amount;
    } else {
      hero.textContent = props.headline;
    }
    hero.style.cssText = `
      font-size: ${mobile ? '42px' : '52px'};
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
      color: ${t.foreground};
      margin: 4px 0 6px;
    `;

    const sub = document.createElement('div');
    sub.textContent = props.subhead || props.headline;
    sub.style.cssText = `
      font-size: 14px;
      color: ${t.muted};
      margin-bottom: 20px;
      line-height: 1.4;
    `;

    const primaryCta = makePrimaryButton(props.cta, t);

    const codeRow = document.createElement('div');
    if (props.code) {
      codeRow.textContent = `Code: ${props.code}`;
      codeRow.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: ${t.muted};
        margin-top: 12px;
        letter-spacing: 0.04em;
      `;
    }

    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    ticket.appendChild(tag);
    ticket.appendChild(hero);
    ticket.appendChild(sub);
    ticket.appendChild(primaryCta);
    if (props.code) ticket.appendChild(codeRow);
    ticket.appendChild(secondaryCta);
    ticket.appendChild(makePoweredBy(props.showPoweredBy));

    modal.appendChild(closeBtn);
    modal.appendChild(ticket);
    overlay.appendChild(modal);

    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 5: SPLIT HERO
  // Two-panel modal. Colored left panel carries the discount amount as a big
  // hero; right panel holds headline, subhead, CTA. Stacks on mobile.
  // ===========================================================================
  function renderSplitHero(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-split-hero';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      max-width: ${mobile ? '100%' : '620px'};
      width: ${mobile ? '100%' : '92%'};
      position: relative;
      overflow: hidden;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.3);
      font-family: ${t.fontFamily};
      display: flex;
      flex-direction: ${mobile ? 'column' : 'row'};
    `;

    const closeBtn = makeCloseButton(t, { tone: 'dark' });

    // Left hero panel
    const hero = document.createElement('div');
    hero.style.cssText = `
      background: ${t.primary};
      color: ${t.primaryText};
      flex: ${mobile ? '0 0 auto' : '0 0 42%'};
      padding: ${mobile ? '28px 22px' : '36px 28px'};
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: ${mobile ? 'center' : 'flex-start'};
      text-align: ${mobile ? 'center' : 'left'};
    `;
    const heroLabel = document.createElement('div');
    heroLabel.textContent = 'YOUR OFFER';
    heroLabel.style.cssText =
      'font-size:11px;font-weight:700;letter-spacing:0.15em;opacity:0.75;margin-bottom:8px;';
    // No-discount offers have no amount to feature, so the hero leads with the
    // headline instead (and the right panel drops it to avoid duplication).
    const hasAmount = !!(props.amountText || props.amount);
    const heroAmount = document.createElement('div');
    heroAmount.textContent = hasAmount ? (props.amountText || props.amount) : props.headline;
    heroAmount.style.cssText = `
      font-size: ${hasAmount ? (mobile ? '40px' : '54px') : (mobile ? '24px' : '32px')};
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.05;
    `;
    const heroSub = document.createElement('div');
    heroSub.textContent = props.amountText ? 'OFF your order' : '';
    heroSub.style.cssText = 'font-size:13px;font-weight:600;opacity:0.85;margin-top:8px;';
    hero.appendChild(heroLabel);
    hero.appendChild(heroAmount);
    if (props.amountText) hero.appendChild(heroSub);

    // Right content panel
    const content = document.createElement('div');
    content.style.cssText = `
      flex: 1 1 auto;
      padding: ${mobile ? '24px 22px 22px' : '36px 32px 30px'};
      display: flex;
      flex-direction: column;
      justify-content: center;
    `;
    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 10px;
      font-size: ${mobile ? '22px' : '26px'};
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: ${t.foreground};
    `;
    const subhead = document.createElement('p');
    subhead.textContent = props.subhead;
    subhead.style.cssText =
      `margin:0 0 22px;font-size:15px;line-height:1.5;color:${t.muted};`;

    const primaryCta = makePrimaryButton(props.cta, t);
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    if (hasAmount) content.appendChild(headline);
    content.appendChild(subhead);
    content.appendChild(primaryCta);
    content.appendChild(secondaryCta);
    content.appendChild(makePoweredBy(props.showPoweredBy));

    modal.appendChild(closeBtn);
    modal.appendChild(hero);
    modal.appendChild(content);
    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 6: TIMER-FRONT
  // Countdown timer is the hero. Live mm:ss ticker drives urgency. Interval
  // self-clears once the element leaves the DOM (modal closed).
  // ===========================================================================
  function renderTimerFront(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-timer-front';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      padding: ${mobile ? '30px 22px 22px' : '38px 36px 32px'};
      max-width: ${mobile ? '100%' : '460px'};
      width: ${mobile ? '100%' : '90%'};
      position: relative;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.3);
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t);

    // Only show the countdown when the caller passes a real future deadline.
    // No deadline = no fake urgency: degrade to a headline-led card instead of
    // inventing a 24h window (e.g. no-discount offers have nothing to expire).
    const parsedEndsAt = Number(props.timerEndsAt);
    const hasTimer = !!parsedEndsAt && !isNaN(parsedEndsAt) && parsedEndsAt > Date.now();

    const label = document.createElement('div');
    label.textContent = 'OFFER EXPIRES IN';
    label.style.cssText =
      `font-size:11px;font-weight:700;letter-spacing:0.15em;color:${t.muted};margin-bottom:12px;`;

    let endsAt = parsedEndsAt;
    if (hasTimer) {
      modal.dataset.resparqTimerEndsAt = String(endsAt);
    }

    let timer = null;
    if (hasTimer) {
      // Show an hours cell when the window is an hour or longer.
      const showHours = (endsAt - Date.now()) >= 60 * 60 * 1000;

      timer = document.createElement('div');
      timer.style.cssText = `
        display: inline-flex;
        gap: 8px;
        margin-bottom: 18px;
      `;
      const makeCell = () => {
        const cell = document.createElement('div');
        cell.style.cssText = `
          background: ${t.primary};
          color: ${t.primaryText};
          font-size: ${mobile ? '28px' : '34px'};
          font-weight: 800;
          line-height: 1;
          padding: 14px 12px;
          border-radius: 10px;
          min-width: 54px;
          font-variant-numeric: tabular-nums;
        `;
        cell.textContent = '00';
        return cell;
      };
      const makeColon = () => {
        const colon = document.createElement('div');
        colon.textContent = ':';
        colon.style.cssText =
          `font-size:28px;font-weight:800;color:${t.primary};align-self:center;`;
        return colon;
      };
      const hourCell = showHours ? makeCell() : null;
      const minCell = makeCell();
      const secCell = makeCell();
      if (hourCell) { timer.appendChild(hourCell); timer.appendChild(makeColon()); }
      timer.appendChild(minCell);
      timer.appendChild(makeColon());
      timer.appendChild(secCell);

      const paint = () => {
        const target = Number(modal.dataset.resparqTimerEndsAt) || endsAt;
        let remaining = Math.max(0, Math.floor((target - Date.now()) / 1000));
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const s = remaining % 60;
        if (hourCell) {
          hourCell.textContent = String(h).padStart(2, '0');
          minCell.textContent = String(m).padStart(2, '0');
        } else {
          // No hours cell: roll any hours into the minutes display.
          minCell.textContent = String(h * 60 + m).padStart(2, '0');
        }
        secCell.textContent = String(s).padStart(2, '0');
      };
      paint();
      // Interval clears itself when the modal is removed from the DOM.
      const tick = setInterval(() => {
        if (!document.body.contains(modal)) { clearInterval(tick); return; }
        paint();
        const target = Number(modal.dataset.resparqTimerEndsAt) || endsAt;
        if (target - Date.now() <= 0) clearInterval(tick);
      }, 1000);
    }

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 8px;
      font-size: ${mobile ? '22px' : '26px'};
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: ${t.foreground};
    `;

    const subhead = document.createElement('p');
    subhead.textContent = props.subhead;
    subhead.style.cssText =
      `margin:0 0 22px;font-size:15px;line-height:1.5;color:${t.muted};`;

    const primaryCta = makePrimaryButton(props.cta, t);
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    if (hasTimer) {
      modal.appendChild(label);
      modal.appendChild(timer);
    }
    const badge = makeDiscountBadge(props.amountText, t);
    if (badge) { badge.style.display = 'block'; modal.appendChild(badge); }
    modal.appendChild(headline);
    modal.appendChild(subhead);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 7: TESTIMONIAL
  // Social-proof card. Star row + merchant-supplied quote (subhead) framed as
  // a testimonial, then the offer and CTA. No fabricated names or stats.
  // ===========================================================================
  function renderTestimonial(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-testimonial';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      padding: ${mobile ? '32px 22px 22px' : '40px 36px 32px'};
      max-width: ${mobile ? '100%' : '460px'};
      width: ${mobile ? '100%' : '90%'};
      position: relative;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.3);
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t);

    const stars = document.createElement('div');
    stars.textContent = '★★★★★';
    stars.setAttribute('aria-label', '5 out of 5 stars');
    stars.style.cssText =
      `color:${t.primary};font-size:20px;letter-spacing:3px;margin-bottom:14px;`;

    const quote = document.createElement('p');
    quote.textContent = props.subhead
      ? `“${props.subhead}”`
      : `“${props.headline}”`;
    quote.style.cssText = `
      margin: 0 0 18px;
      font-size: ${mobile ? '18px' : '20px'};
      line-height: 1.4;
      font-weight: 600;
      font-style: italic;
      color: ${t.foreground};
    `;

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 18px;
      font-size: 15px;
      font-weight: 500;
      line-height: 1.5;
      color: ${t.muted};
    `;

    const primaryCta = makePrimaryButton(props.cta, t);
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    modal.appendChild(stars);
    const badge = makeDiscountBadge(props.amountText, t);
    if (badge) { badge.style.display = 'inline-block'; modal.appendChild(badge); }
    modal.appendChild(quote);
    modal.appendChild(headline);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE 8: SCRATCH REVEAL
  // Canvas scratch-off over the discount hero. Drag (pointer/touch) erases the
  // foil; once enough is cleared the foil auto-fades. CTA stays clickable
  // throughout so the claim flow never depends on the canvas working.
  // ===========================================================================
  function renderScratchReveal(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-scratch-reveal';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      padding: ${mobile ? '32px 22px 22px' : '40px 36px 32px'};
      max-width: ${mobile ? '100%' : '440px'};
      width: ${mobile ? '100%' : '90%'};
      position: relative;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.3);
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t);

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 6px;
      font-size: ${mobile ? '22px' : '26px'};
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: ${t.foreground};
    `;

    const hint = document.createElement('p');
    hint.textContent = 'Scratch the panel to reveal your offer';
    hint.style.cssText = `margin:0 0 18px;font-size:14px;color:${t.muted};`;

    // Scratch stage: reward layer underneath + canvas foil on top
    const stage = document.createElement('div');
    const stageW = mobile ? 240 : 300;
    const stageH = 120;
    stage.style.cssText = `
      position: relative;
      width: ${stageW}px;
      height: ${stageH}px;
      margin: 0 auto 22px;
      border-radius: 14px;
      overflow: hidden;
      touch-action: none;
      user-select: none;
    `;

    const reward = document.createElement('div');
    reward.style.cssText = `
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: ${t.background};
      color: ${t.foreground};
    `;
    const rewardAmount = document.createElement('div');
    rewardAmount.textContent = props.amountText || props.amount || 'YOUR OFFER';
    rewardAmount.style.cssText = `
      font-size: ${mobile ? '38px' : '46px'};
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
      color: ${t.primary};
    `;
    const rewardSub = document.createElement('div');
    rewardSub.textContent = props.amountText ? 'OFF your order' : '';
    rewardSub.style.cssText =
      `font-size:12px;font-weight:600;letter-spacing:0.1em;color:${t.muted};margin-top:6px;`;
    reward.appendChild(rewardAmount);
    if (props.amountText) reward.appendChild(rewardSub);

    const canvas = document.createElement('canvas');
    canvas.width = stageW;
    canvas.height = stageH;
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;cursor:grab;';

    stage.appendChild(reward);
    stage.appendChild(canvas);

    // Paint the foil. Diagonal hatch + label so it reads as scratchable.
    const ctx = canvas.getContext('2d');
    const paintFoil = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#c7ccd1';
      ctx.fillRect(0, 0, stageW, stageH);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 6;
      for (let x = -stageH; x < stageW; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + stageH, stageH);
        ctx.stroke();
      }
      ctx.fillStyle = '#6b7280';
      ctx.font = '600 14px ' + t.fontFamily;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SCRATCH HERE', stageW / 2, stageH / 2);
    };
    paintFoil();

    let scratching = false;
    let revealed = false;
    const eraseAt = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * (stageW / rect.width);
      const y = (clientY - rect.top) * (stageH / rect.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fill();
    };
    const clearedRatio = () => {
      const data = ctx.getImageData(0, 0, stageW, stageH).data;
      let clear = 0;
      for (let i = 3; i < data.length; i += 4 * 80) {
        if (data[i] === 0) clear++;
      }
      return clear / (data.length / (4 * 80));
    };
    const maybeReveal = () => {
      if (revealed) return;
      if (clearedRatio() > 0.45) {
        revealed = true;
        canvas.style.transition = 'opacity 0.4s';
        canvas.style.opacity = '0';
        setTimeout(() => { canvas.style.display = 'none'; }, 400);
      }
    };
    const start = (e) => {
      scratching = true;
      canvas.style.cursor = 'grabbing';
      const p = e.touches ? e.touches[0] : e;
      eraseAt(p.clientX, p.clientY);
    };
    const move = (e) => {
      if (!scratching) return;
      e.preventDefault();
      const p = e.touches ? e.touches[0] : e;
      eraseAt(p.clientX, p.clientY);
    };
    const end = () => {
      if (!scratching) return;
      scratching = false;
      canvas.style.cursor = 'grab';
      maybeReveal();
    };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    const primaryCta = makePrimaryButton(props.cta, t);
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    modal.appendChild(headline);
    modal.appendChild(hint);
    modal.appendChild(stage);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // REGISTRY + DISPATCHER
  // ===========================================================================
  const TEMPLATES = {
    'classic-card': {
      id: 'classic-card',
      name: 'Classic Card',
      description: 'Centered, soft shadow',
      tier: 1,
      render: renderClassicCard
    },
    'top-banner': {
      id: 'top-banner',
      name: 'Top Banner',
      description: 'Slim, non-intrusive',
      tier: 1,
      render: renderTopBanner
    },
    'bottom-sheet': {
      id: 'bottom-sheet',
      name: 'Bottom Sheet',
      description: 'Mobile-first',
      tier: 1,
      render: renderBottomSheet
    },
    'coupon-ticket': {
      id: 'coupon-ticket',
      name: 'Coupon Ticket',
      description: 'Gamified, dashed edge',
      tier: 1,
      render: renderCouponTicket
    },
    'split-hero': {
      id: 'split-hero',
      name: 'Split Hero',
      description: 'Two-panel, bold offer',
      tier: 2,
      render: renderSplitHero
    },
    'timer-front': {
      id: 'timer-front',
      name: 'Timer Front',
      description: 'Live countdown urgency',
      tier: 2,
      render: renderTimerFront
    },
    'testimonial': {
      id: 'testimonial',
      name: 'Testimonial',
      description: 'Star rating + social proof',
      tier: 2,
      render: renderTestimonial
    },
    'scratch-reveal': {
      id: 'scratch-reveal',
      name: 'Scratch Reveal',
      description: 'Scratch-off to reveal',
      tier: 2,
      render: renderScratchReveal
    }
  };

  const DEFAULT_TEMPLATE_ID = 'classic-card';

  /**
   * Render a template by id. Returns DOM handles for the caller to wire up
   * click/show/hide lifecycle.
   *
   * @param {string} templateId
   * @param {Object} props - { headline, subhead, cta, secondaryCta, code,
   *                           amount, showSecondary, showPoweredBy }
   * @returns {{ overlay, modal, primaryCta, secondaryCta, closeBtn, templateId }}
   */
  function render(templateId, props) {
    const entry = TEMPLATES[templateId] || TEMPLATES[DEFAULT_TEMPLATE_ID];
    const out = entry.render(props || {});
    out.templateId = entry.id;

    // showProductImages gene: inject the thumbnail row above the primary CTA.
    // Single injection point — templates stay unaware of the gene.
    if (props && props.productImages && out.primaryCta && out.primaryCta.parentNode &&
        !NO_IMAGE_ROW_TEMPLATES.includes(entry.id)) {
      const row = makeProductImageRow(props.productImages, tokensFor(props.themeOverrides));
      if (row) out.primaryCta.parentNode.insertBefore(row, out.primaryCta);
    }
    return out;
  }

  function list() {
    return Object.values(TEMPLATES).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tier: t.tier
    }));
  }

  window.ResparqTemplates = {
    render,
    list,
    getThemeTokens,
    setThemeTokens,
    DEFAULT_TEMPLATE_ID
  };
})();
