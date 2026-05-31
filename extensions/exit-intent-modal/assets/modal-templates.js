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
    const t = getThemeTokens();
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
  function renderTopBanner(props) {
    const t = getThemeTokens();
    const mobile = isMobile();

    // Banner doesn't use a dark overlay — it's non-intrusive by design.
    // We still wrap in an overlay div for show/hide consistency.
    const overlay = document.createElement('div');
    overlay.className = 'resparq-overlay resparq-banner-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
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
    headlineSpan.textContent = props.headline;
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
    const t = getThemeTokens();

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
    const t = getThemeTokens();
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
    if (props.amount) {
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
