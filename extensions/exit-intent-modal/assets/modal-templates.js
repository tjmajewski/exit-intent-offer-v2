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

  // ===========================================================================
  // CONTRAST SAFETY (WCAG)
  // Sniffed theme tokens are picked independently, so pairs can collide (light
  // foreground on a white-fallback background, button text that matches the
  // button). These helpers let tokensFor validate the PAIRS and snap any unsafe
  // one to a readable value. parseRGB defers to the browser so it handles hex,
  // rgb(), hsl(), and named colors uniformly. Results cached.
  // ===========================================================================
  const _rgbCache = {};
  function parseRGB(color) {
    if (!color) return null;
    if (Object.prototype.hasOwnProperty.call(_rgbCache, color)) return _rgbCache[color];
    let out = null;
    try {
      const el = document.createElement('span');
      el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
      el.style.color = color;
      (document.body || document.documentElement).appendChild(el);
      const cs = getComputedStyle(el).color;
      el.parentNode.removeChild(el);
      const m = cs && cs.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(',').map((s) => parseFloat(s));
        out = { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
      }
    } catch (_) {}
    _rgbCache[color] = out;
    return out;
  }
  function _lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function relLum(rgb) { return 0.2126 * _lin(rgb.r) + 0.7152 * _lin(rgb.g) + 0.0722 * _lin(rgb.b); }
  function contrastRatio(a, b) {
    // Unparseable input -> return a passing ratio so we never override blindly.
    if (!a || !b) return 21;
    const L1 = relLum(a), L2 = relLum(b);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function readableTextOn(bg) {
    const rgb = typeof bg === 'string' ? parseRGB(bg) : bg;
    if (!rgb) return '#111111';
    const white = { r: 255, g: 255, b: 255 }, black = { r: 17, g: 17, b: 17 };
    return contrastRatio(rgb, white) >= contrastRatio(rgb, black) ? '#ffffff' : '#111111';
  }

  /**
   * Merge sniffed tokens with merchant-provided overrides (brand settings), then
   * enforce legibility. Precedence is unchanged — merchant CSS/brand settings
   * win, then sniffed theme tokens, then safe fallbacks — but every color pair
   * that can render illegibly is validated and snapped to a readable value.
   * Font and border-radius always defer to the theme (low risk, high native
   * feel). The CSS builder still overrides everything downstream of this.
   *
   * Caller passes brand settings as `{ primary, primaryText, background,
   * foreground }` — typically built from settings.brand* in the storefront.
   */
  function tokensFor(overrides) {
    const sniffed = getThemeTokens();
    const o = overrides || {};

    const primary = o.primary || sniffed.primary;
    const background = isSafeOpaqueColor(o.background) ? o.background
                     : isSafeOpaqueColor(sniffed.background) ? sniffed.background
                     : '#ffffff';
    const bgRGB = parseRGB(background);
    const primRGB = parseRGB(primary);

    // Body/foreground text must stay legible on the (opaque) background. Guard
    // the PAIR — a light sniffed foreground on a white-fallback background is
    // the classic "broken" case. Snap to readable only when it actually fails.
    let foreground = o.foreground || sniffed.foreground || '#1a1a1a';
    if (bgRGB && contrastRatio(parseRGB(foreground), bgRGB) < 4.5) {
      foreground = readableTextOn(bgRGB);
    }

    // Button label: derive from the button color by luminance instead of
    // sniffing it independently. Honor an explicit override only if it contrasts.
    let primaryText = o.primaryText;
    if (!primaryText || (primRGB && contrastRatio(parseRGB(primaryText), primRGB) < 4.5)) {
      primaryText = readableTextOn(primRGB || primary);
    }

    // Accent carries the offer emphasis (badge, timer cells, progress fill,
    // amount hero). It must be visibly distinct from the card background or the
    // offer disappears. If it's too close, fall back to the button color, then
    // the foreground.
    let accent = o.accent || sniffed.accent || primary;
    if (bgRGB && contrastRatio(parseRGB(accent), bgRGB) < 3) {
      accent = (primRGB && contrastRatio(primRGB, bgRGB) >= 3) ? primary : foreground;
    }
    const accentText = readableTextOn(accent);

    // Muted (subheads/captions): legible on the background, else fall back to
    // full foreground (loses the muted look but stays readable — only fires on
    // broken themes).
    let muted = o.muted || sniffed.muted || '#6b7280';
    if (bgRGB && contrastRatio(parseRGB(muted), bgRGB) < 2.2) {
      muted = foreground;
    }

    return {
      primary,
      primaryText,
      background,
      foreground,
      muted,
      accent,
      accentText,
      borderRadius: sniffed.borderRadius,
      fontFamily: o.fontFamily || sniffed.fontFamily
    };
  }

  // ===========================================================================
  // SHARED PRIMITIVES
  // ===========================================================================

  // Inject shared keyframes / focus-ring / reduced-motion rules once. The show
  // lifecycle flips display:none -> flex, which fires these entrance animations.
  // Individual overlays set --resparq-ring for the focus-ring color.
  function ensureBaseStyles() {
    if (document.getElementById('resparq-base-styles')) return;
    const s = document.createElement('style');
    s.id = 'resparq-base-styles';
    s.textContent = `
      @keyframes resparq-fade-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes resparq-pop-in {
        from { opacity: 0; transform: translateY(8px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes resparq-sheet-up {
        from { transform: translateY(100%); }
        to   { transform: translateY(0); }
      }
      @keyframes resparq-tick {
        0%   { transform: scale(1); }
        30%  { transform: scale(1.12); }
        100% { transform: scale(1); }
      }
      .resparq-overlay { animation: resparq-fade-in 0.22s ease-out; }
      .resparq-modal:not(.resparq-top-banner) {
        animation: resparq-pop-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .resparq-bottom-sheet {
        animation: resparq-sheet-up 0.34s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .resparq-overlay button:focus-visible {
        outline: 2px solid var(--resparq-ring, #1a1a1a);
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        .resparq-overlay,
        .resparq-modal,
        .resparq-bottom-sheet,
        .resparq-banner-overlay { animation: none !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function makeOverlay({ align = 'center', opaque = true } = {}) {
    ensureBaseStyles();
    const overlay = document.createElement('div');
    overlay.className = 'resparq-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: ${opaque ? 'rgba(0,0,0,0.6)' : 'transparent'};
      ${opaque ? 'backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);' : ''}
      display: none;
      justify-content: center;
      align-items: ${align};
      z-index: 9999;
      pointer-events: ${opaque ? 'auto' : 'none'};
    `;
    overlay.style.setProperty('--resparq-ring', getThemeTokens().primary);
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
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    `;
    btn.onmouseenter = () => {
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 6px 16px -4px rgba(0,0,0,0.25)';
    };
    btn.onmouseleave = () => {
      btn.style.transform = 'none';
      btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
    };
    btn.onmousedown = () => { btn.style.transform = 'translateY(0) scale(0.98)'; };
    btn.onmouseup = () => { btn.style.transform = 'translateY(-1px)'; };
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
      background: ${t.accent};
      color: ${t.accentText};
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    `;
    return el;
  }

  // Prominent discount amount, for layouts that lead with the offer (classic
  // card when a discount is present). Big accent figure + a small caption.
  // Returns null when there's no amount, so no-discount offers degrade cleanly.
  function makeAmountHero(amountText, t, { align = 'left' } = {}) {
    if (!amountText) return null;
    const el = document.createElement('div');
    el.style.cssText = `margin: 0 0 14px; text-align: ${align};`;
    const fig = document.createElement('div');
    fig.textContent = `${amountText} OFF`;
    fig.style.cssText = `
      font-size: 44px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
      color: ${t.accent};
    `;
    const cap = document.createElement('div');
    cap.textContent = 'your order';
    cap.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: ${t.muted};
      margin-top: 6px;
    `;
    el.appendChild(fig);
    el.appendChild(cap);
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

  /**
   * First-order subscription disclosure (spec 2.2). Fixed compliance line —
   * never a learning gene, always rendered when the cart carries subscription
   * lines and the decision mints a discount, so shoppers can rely on it 100%
   * of the time. `compact` is the shortened inline variant for slim layouts
   * (top-banner, scratch-reveal) where the full fine-print block doesn't fit —
   * the line is shortened, never dropped.
   */
  function makeDisclosureLine(t, compact) {
    const el = document.createElement('p');
    el.className = 'resparq-first-order-disclosure';
    el.textContent = compact ? 'First order only' : 'Discount applies to your first order.';
    el.style.cssText = compact
      ? 'margin:6px 0 0;text-align:center;font-size:11px;opacity:0.7;line-height:1.3;color:' + (t.foreground || '#333') + ';'
      : 'margin:10px 0 0;text-align:center;font-size:12px;opacity:0.7;line-height:1.4;color:' + (t.foreground || '#333') + ';';
    return el;
  }

  // Dedicated social-proof line. Merchant-controlled, resolved server-side to a
  // ready string (e.g. "500+ orders placed"). Rendered as its own trust line
  // just above the CTA via injectSocialProof — templates stay unaware of it.
  function makeSocialProof(text, t) {
    if (!text) return null;
    const el = document.createElement('p');
    el.className = 'resparq-social-proof';
    el.textContent = '✓ ' + text;
    el.style.cssText =
      'margin:0 0 12px;text-align:center;font-size:13px;font-weight:600;' +
      'line-height:1.4;letter-spacing:0.01em;color:' + (t.muted || '#555') + ';';
    return el;
  }

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
    // Lead with the discount amount as a hero when present; fall back to no
    // amount block for announcement-only offers.
    const amountHero = makeAmountHero(props.amountText, t, { align: 'left' });
    if (amountHero) modal.appendChild(amountHero);
    modal.appendChild(headline);
    modal.appendChild(subhead);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE: CART PRESERVATION
  // Recovery-native card. Leads with a "your cart is saved" reassurance chip and
  // the shopper's actual cart items (productImages), then the offer + CTA. Built
  // on the existing productImages plumbing — degrades to a strong reassurance
  // card when the cart has no imagery. Discount is optional (works with or
  // without an amount).
  // ===========================================================================
  function renderCartPreservation(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-cart-preservation';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      padding: ${mobile ? '30px 22px 22px' : '38px 34px 30px'};
      max-width: ${mobile ? '100%' : '460px'};
      width: ${mobile ? '100%' : '90%'};
      position: relative;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.3);
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t);

    // "Cart saved" reassurance chip — the identity of this layout.
    const chip = document.createElement('div');
    chip.innerHTML = '&#10003; Your cart is saved';
    chip.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(0,0,0,0.05);
      color: ${t.foreground};
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      margin-bottom: 16px;
    `;

    // Cart items as the hero (larger than the shared thumbnail row). Rendered
    // here with the shared class so the dispatcher's post-render injection
    // no-ops when items are already present at render time.
    let heroImages = null;
    const imgs = Array.isArray(props.productImages) ? props.productImages : [];
    if (imgs.length > 0) {
      heroImages = document.createElement('div');
      heroImages.className = 'resparq-product-images';
      heroImages.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: center;
        margin: 0 0 20px;
      `;
      imgs.slice(0, 3).forEach((item) => {
        if (!item || !item.image) return;
        const img = document.createElement('img');
        img.src = /^(https?:)?\/\//.test(item.image)
          ? item.image + (item.image.includes('?') ? '&' : '?') + 'width=160'
          : item.image;
        img.alt = item.title || '';
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; };
        img.style.cssText = `
          width: ${mobile ? '72px' : '84px'};
          height: ${mobile ? '72px' : '84px'};
          object-fit: cover;
          border-radius: ${t.borderRadius};
          border: 1px solid rgba(0,0,0,0.08);
          background: #ffffff;
          flex: 0 0 auto;
        `;
        heroImages.appendChild(img);
      });
      if (heroImages.children.length === 0) heroImages = null;
    }

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 10px;
      font-size: ${mobile ? '22px' : '26px'};
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
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
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    modal.appendChild(chip);
    if (heroImages) modal.appendChild(heroImages);
    const badge = makeDiscountBadge(props.amountText, t);
    if (badge) { badge.style.display = 'inline-block'; modal.appendChild(badge); }
    modal.appendChild(headline);
    if (props.subhead) modal.appendChild(subhead);
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
    ensureBaseStyles();
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
    overlay.style.setProperty('--resparq-ring', t.primary);

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
      cursor: grab;
    `;

    const closeBtn = makeCloseButton(t);

    // Drag-to-dismiss: the handle now does what it implies. Dragging the sheet
    // down past a threshold animates it away and fires the close handler; a
    // short drag snaps back. Starts on any non-button surface so the CTA stays
    // tappable. Skipped under reduced motion (no drag affordance change needed —
    // the close button and overlay still dismiss).
    (function enableDragDismiss() {
      let startY = null, dragging = false, curY = 0;
      const point = (e) => (e.touches && e.touches[0]) ? e.touches[0] : e;
      const onDown = (e) => {
        const tgt = e.target;
        if (tgt && tgt.closest && tgt.closest('button')) return;
        dragging = true;
        startY = point(e).clientY;
        curY = 0;
        modal.style.transition = 'none';
        handle.style.cursor = 'grabbing';
      };
      const onMove = (e) => {
        if (!dragging) return;
        curY = Math.max(0, point(e).clientY - startY);
        modal.style.transform = `translateY(${curY}px)`;
        if (e.cancelable) e.preventDefault();
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        handle.style.cursor = 'grab';
        modal.style.transition = 'transform 0.25s ease';
        if (curY > 100) {
          modal.style.transform = 'translateY(100%)';
          setTimeout(() => { if (closeBtn) closeBtn.click(); }, 220);
        } else {
          modal.style.transform = 'translateY(0)';
        }
      };
      modal.addEventListener('mousedown', onDown);
      modal.addEventListener('touchstart', onDown, { passive: true });
      window.addEventListener('mousemove', onMove);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchend', onUp);
    })();

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

    // Coupon body with real punched-out side notches (CSS mask) — reads as a
    // ticket rather than a plain dashed box. The mask cuts two transparent
    // semicircles at the sides so the backdrop shows through the notches. A
    // dashed perforation line sits at the same height between the two notches.
    const ticket = document.createElement('div');
    const notch = `
      -webkit-mask:
        radial-gradient(circle 12px at left 58%, transparent 12px, #000 12.5px),
        radial-gradient(circle 12px at right 58%, transparent 12px, #000 12.5px);
      -webkit-mask-composite: source-in;
      mask:
        radial-gradient(circle 12px at left 58%, transparent 12px, #000 12.5px),
        radial-gradient(circle 12px at right 58%, transparent 12px, #000 12.5px);
      mask-composite: intersect;
    `;
    ticket.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: 16px;
      padding: 28px 24px 24px;
      text-align: center;
      box-shadow: 0 20px 60px -20px rgba(0,0,0,0.35);
      position: relative;
      ${notch}
    `;

    // Dashed perforation aligned with the notch centers (58% down the ticket).
    const perforation = document.createElement('div');
    perforation.style.cssText = `
      position: absolute;
      top: 58%;
      left: 18px;
      right: 18px;
      border-top: 2px dashed rgba(0,0,0,0.14);
      pointer-events: none;
    `;
    ticket.appendChild(perforation);

    const tag = document.createElement('div');
    tag.textContent = 'EXCLUSIVE OFFER';
    tag.style.cssText = `
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: ${t.accent};
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

    // The close button sits top-right. On desktop that's over the light content
    // panel (needs a dark glyph); on mobile the hero panel stacks on top there
    // (needs a light glyph). A 'dark'-toned white × on the white desktop panel
    // was invisible — that's why there appeared to be no close button.
    const closeBtn = makeCloseButton(t, { tone: mobile ? 'dark' : 'light' });

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
          background: ${t.accent};
          color: ${t.accentText};
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
          `font-size:28px;font-weight:800;color:${t.accent};align-self:center;`;
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
      const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pulse = () => {
        if (reduceMotion) return;
        secCell.style.animation = 'none';
        void secCell.offsetWidth; // reflow so the animation restarts each tick
        secCell.style.animation = 'resparq-tick 0.45s ease-out';
      };
      // Interval clears itself when the modal is removed from the DOM.
      const tick = setInterval(() => {
        if (!document.body.contains(modal)) { clearInterval(tick); return; }
        paint();
        pulse();
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
    // Track cleared area with a coarse boolean grid instead of reading back the
    // whole canvas (getImageData) on every release — cheaper and dodges
    // canvas-fingerprinting heuristics in some privacy blockers.
    const GRID_COLS = 12;
    const GRID_ROWS = 6;
    const cellCleared = new Uint8Array(GRID_COLS * GRID_ROWS);
    let clearedCells = 0;
    const eraseRadius = 20;
    const markCells = (x, y) => {
      const cw = stageW / GRID_COLS;
      const ch = stageH / GRID_ROWS;
      const c0 = Math.max(0, Math.floor((x - eraseRadius) / cw));
      const c1 = Math.min(GRID_COLS - 1, Math.floor((x + eraseRadius) / cw));
      const r0 = Math.max(0, Math.floor((y - eraseRadius) / ch));
      const r1 = Math.min(GRID_ROWS - 1, Math.floor((y + eraseRadius) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * GRID_COLS + c;
          if (!cellCleared[idx]) { cellCleared[idx] = 1; clearedCells++; }
        }
      }
    };
    const eraseAt = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * (stageW / rect.width);
      const y = (clientY - rect.top) * (stageH / rect.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, eraseRadius, 0, Math.PI * 2);
      ctx.fill();
      markCells(x, y);
    };
    const clearedRatio = () => clearedCells / (GRID_COLS * GRID_ROWS);
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
  // TEMPLATE: EDITORIAL
  // Quiet, premium, gallery-minimal. Serif headline, generous whitespace, a
  // hairline rule, and a text-link CTA instead of a loud button. For considered
  // brands where the promo-heavy layouts feel cheap. No badge; any amount is
  // stated inline, softly.
  // ===========================================================================
  function renderEditorial(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();

    const overlay = makeOverlay({ align: mobile ? 'flex-end' : 'center' });

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-editorial';
    modal.style.cssText = `
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${mobile ? '20px 20px 0 0' : t.borderRadius};
      padding: ${mobile ? '44px 28px 30px' : '60px 56px 48px'};
      max-width: ${mobile ? '100%' : '480px'};
      width: ${mobile ? '100%' : '90%'};
      position: relative;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0,0,0,0.22);
      font-family: ${t.fontFamily};
    `;

    const closeBtn = makeCloseButton(t);

    const serif = "Georgia, 'Times New Roman', 'Iowan Old Style', serif";

    // Soft inline amount line (no badge). Only when a discount exists.
    let overline = null;
    if (props.amountText) {
      overline = document.createElement('div');
      overline.textContent = `${props.amountText} off, with our compliments`;
      overline.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: ${t.muted};
        margin-bottom: 18px;
      `;
    }

    const headline = document.createElement('h2');
    headline.textContent = props.headline;
    headline.style.cssText = `
      margin: 0 0 20px;
      font-family: ${serif};
      font-size: ${mobile ? '28px' : '34px'};
      font-weight: 500;
      line-height: 1.2;
      letter-spacing: -0.01em;
      color: ${t.foreground};
    `;

    const rule = document.createElement('div');
    rule.style.cssText = `
      width: 40px;
      height: 1px;
      background: ${t.foreground};
      opacity: 0.25;
      margin: 0 auto 20px;
    `;

    const subhead = document.createElement('p');
    subhead.textContent = props.subhead;
    subhead.style.cssText = `
      margin: 0 0 28px;
      font-size: 15px;
      line-height: 1.6;
      color: ${t.muted};
    `;

    // Text-link CTA rather than a filled button. Still a real <button> so the
    // lifecycle wiring (handleCTAClick) is unchanged.
    const primaryCta = document.createElement('button');
    primaryCta.type = 'button';
    primaryCta.textContent = props.cta;
    primaryCta.style.cssText = `
      background: transparent;
      color: ${t.foreground};
      border: none;
      padding: 6px 2px;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.02em;
      font-family: ${t.fontFamily};
      cursor: pointer;
      border-bottom: 2px solid ${t.accent};
      transition: opacity 0.15s;
      -webkit-tap-highlight-color: transparent;
    `;
    primaryCta.onmouseenter = () => { primaryCta.style.opacity = '0.7'; };
    primaryCta.onmouseleave = () => { primaryCta.style.opacity = '1'; };

    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    if (!props.showSecondary) secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    if (overline) modal.appendChild(overline);
    modal.appendChild(headline);
    modal.appendChild(rule);
    if (props.subhead) modal.appendChild(subhead);
    modal.appendChild(primaryCta);
    modal.appendChild(secondaryCta);
    modal.appendChild(makePoweredBy(props.showPoweredBy));

    overlay.appendChild(modal);
    return { overlay, modal, primaryCta, secondaryCta, closeBtn };
  }

  // ===========================================================================
  // TEMPLATE: CORNER TOAST
  // Low-intrusion pill anchored to the bottom-right. No dark overlay and the
  // page stays interactive (overlay is click-through; only the toast itself is
  // interactive). The quietest surface in the set.
  // ===========================================================================
  function renderCornerToast(props) {
    const t = tokensFor(props.themeOverrides);
    const mobile = isMobile();
    ensureBaseStyles();

    // Custom non-blocking overlay (not makeOverlay — this one is click-through).
    const overlay = document.createElement('div');
    overlay.className = 'resparq-overlay resparq-corner-overlay';
    overlay.style.cssText = `
      position: fixed;
      right: ${mobile ? '12px' : '20px'};
      bottom: ${mobile ? '12px' : '20px'};
      left: ${mobile ? '12px' : 'auto'};
      display: none;
      z-index: 9999;
      pointer-events: none;
    `;
    overlay.style.setProperty('--resparq-ring', t.primary);

    const modal = document.createElement('div');
    modal.className = 'resparq-modal resparq-corner-toast';
    modal.style.cssText = `
      pointer-events: auto;
      background: ${t.background};
      color: ${t.foreground};
      border-radius: ${t.borderRadius};
      padding: 16px 16px 16px 18px;
      max-width: ${mobile ? '100%' : '340px'};
      position: relative;
      box-shadow: 0 12px 36px -8px rgba(0,0,0,0.28);
      border: 1px solid rgba(0,0,0,0.06);
      font-family: ${t.fontFamily};
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;

    const closeBtn = makeCloseButton(t);
    closeBtn.style.top = '8px';
    closeBtn.style.right = '8px';
    closeBtn.style.width = '26px';
    closeBtn.style.height = '26px';
    closeBtn.style.fontSize = '18px';

    const text = document.createElement('div');
    text.style.cssText = 'padding-right: 22px;';
    const headline = document.createElement('div');
    headline.textContent = props.amountText
      ? `${props.amountText} off — ${props.headline}`
      : props.headline;
    headline.style.cssText = `
      font-size: 15px;
      font-weight: 700;
      line-height: 1.3;
      color: ${t.foreground};
    `;
    text.appendChild(headline);
    if (props.subhead) {
      const sub = document.createElement('div');
      sub.textContent = props.subhead;
      sub.style.cssText = `font-size: 13px; line-height: 1.4; color: ${t.muted}; margin-top: 3px;`;
      text.appendChild(sub);
    }

    const primaryCta = makePrimaryButton(props.cta, t, { full: true });
    primaryCta.style.minHeight = '40px';
    primaryCta.style.padding = '10px 16px';
    primaryCta.style.fontSize = '14px';

    // Corner toast has no room for a distinct secondary; keep a hidden one so
    // the handle contract (secondaryCta) stays consistent for the caller.
    const secondaryCta = makeSecondaryButton(props.secondaryCta || 'No thanks', t);
    secondaryCta.style.display = 'none';

    modal.appendChild(closeBtn);
    modal.appendChild(text);
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
    'cart-preservation': {
      id: 'cart-preservation',
      name: 'Cart Preservation',
      description: 'Shows saved cart items',
      tier: 1,
      render: renderCartPreservation
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
    'scratch-reveal': {
      id: 'scratch-reveal',
      name: 'Scratch Reveal',
      description: 'Scratch-off to reveal',
      tier: 2,
      render: renderScratchReveal
    },
    'editorial': {
      id: 'editorial',
      name: 'Editorial',
      description: 'Quiet, premium, minimal',
      tier: 2,
      render: renderEditorial
    },
    'corner-toast': {
      id: 'corner-toast',
      name: 'Corner Toast',
      description: 'Low-intrusion corner pill',
      tier: 1,
      render: renderCornerToast
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

    // showProductImages: inject the thumbnail row above the primary CTA.
    // Single injection point — templates stay unaware of the feature.
    if (props && props.productImages) {
      injectProductImages(out, props.productImages, props.themeOverrides);
    }
    // First-order subscription disclosure: compliance line below the CTA.
    if (props && props.firstOrderDisclosure) {
      injectDisclosureLine(out, props.themeOverrides);
    }
    // Merchant social-proof line: trust line just above the CTA. Sits below the
    // product-image row (injected first) when both are present.
    if (props && props.socialProof) {
      injectSocialProof(out, props.socialProof, props.themeOverrides);
    }
    return out;
  }

  /**
   * Insert the social-proof line directly above a rendered modal's primary CTA.
   * Anchors to primaryCta.parentNode so it lands correctly in every template's
   * layout. No-op when there's no text, no handle, or it's already injected.
   */
  function injectSocialProof(handles, text, themeOverrides) {
    if (!text) return false;
    if (!handles || !handles.primaryCta || !handles.primaryCta.parentNode) return false;
    if (handles.primaryCta.parentNode.querySelector('.resparq-social-proof')) return false;
    const line = makeSocialProof(text, tokensFor(themeOverrides));
    if (!line) return false;
    handles.primaryCta.parentNode.insertBefore(line, handles.primaryCta);
    return true;
  }

  /**
   * Insert the cart-thumbnail row above a rendered modal's primary CTA.
   * Exposed for callers that fetch cart data AFTER render (manual mode renders
   * synchronously, then injects when /cart.js resolves). No-op on layouts in
   * the skip list, missing handles, or an already-injected modal.
   */
  function injectProductImages(handles, images, themeOverrides) {
    if (!handles || !handles.primaryCta || !handles.primaryCta.parentNode) return false;
    if (NO_IMAGE_ROW_TEMPLATES.includes(handles.templateId)) return false;
    if (handles.primaryCta.parentNode.querySelector('.resparq-product-images')) return false;
    const row = makeProductImageRow(images, tokensFor(themeOverrides));
    if (!row) return false;
    handles.primaryCta.parentNode.insertBefore(row, handles.primaryCta);
    return true;
  }

  /**
   * Insert the first-order disclosure line below a rendered modal's primary CTA.
   * Compliance line — on skip-list layouts it renders a shortened inline variant
   * (never dropped). Idempotent per modal.
   */
  function injectDisclosureLine(handles, themeOverrides) {
    if (!handles || !handles.primaryCta || !handles.primaryCta.parentNode) return false;
    if (handles.primaryCta.parentNode.querySelector('.resparq-first-order-disclosure')) return false;
    const compact = NO_IMAGE_ROW_TEMPLATES.includes(handles.templateId);
    const line = makeDisclosureLine(tokensFor(themeOverrides), compact);
    handles.primaryCta.parentNode.insertBefore(line, handles.primaryCta.nextSibling);
    return true;
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
    injectProductImages,
    injectDisclosureLine,
    getThemeTokens,
    setThemeTokens,
    DEFAULT_TEMPLATE_ID
  };
})();
