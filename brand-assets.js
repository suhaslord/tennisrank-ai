(() => {
  'use strict';

  const MARK_SVG = `
    <svg viewBox="0 0 96 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="tr-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset=".52" stop-color="#eef1f5"/>
          <stop offset="1" stop-color="#cfd5dd"/>
        </linearGradient>
        <linearGradient id="tr-orange" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffb000"/>
          <stop offset="1" stop-color="#f36b21"/>
        </linearGradient>
      </defs>
      <path d="M8 13h56c13 0 22 8 22 19 0 10-7 18-18 20l16 13H66L47 50h17c6 0 10-4 10-9s-4-9-10-9H43L28 65H13l16-33H8z" fill="url(#tr-silver)" stroke="#cbd1d9" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M48 50l18 15h18L65 49z" fill="url(#tr-orange)" opacity=".96"/>
      <circle cx="48" cy="37" r="10.5" fill="url(#tr-orange)" stroke="#fff" stroke-width="2.2"/>
      <path d="M39.5 35.5c4.6-4 8.9-4.1 12.9-.2 3.4 3.3 6.2 3.7 8.8 2.4M35.5 39c3.6 2.8 6.4 3 9.5.5 4.1-3.3 8.7-3.4 13.7-.3" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>
    </svg>`;

  const STYLE_ID = 'tr-brand-assets-style';

  function markHtml(className = '') {
    return `<span class="tr-logo-mark ${className}" aria-hidden="true">${MARK_SVG}</span>`;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tr-logo-mark{display:inline-grid;place-items:center;flex:0 0 auto;line-height:0}
      .tr-logo-mark svg{display:block;width:100%;height:100%;overflow:visible}
      .tr-logo-wordmark{display:inline-flex;align-items:center;gap:8px;min-width:0;white-space:nowrap}
      .tr-logo-wordmark .tr-logo-mark{width:34px;height:28px}
      .tr-logo-wordmark-text{display:inline-flex;align-items:baseline;color:#171a20;font-size:15px;font-weight:680;letter-spacing:-.045em}
      .tr-logo-wordmark-text b{margin-left:3px;color:#f36b21;font-weight:720}
      .topbar>.brand-mark.tr-logo-link{height:42px;padding:0;gap:0;color:#171a20;opacity:1}
      .topbar>.brand-mark.tr-logo-link:hover{opacity:.68}
      .auth-brand-lockup .brand-mark.tr-logo-auth{display:inline-flex;align-items:center;gap:8px;color:#fff;letter-spacing:-.035em}
      .auth-brand-lockup .tr-logo-mark{width:30px;height:25px}
      .auth-brand-lockup .tr-logo-auth-text{color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 14px rgba(0,0,0,.24)}
      .auth-brand-lockup .tr-logo-auth-text b{color:#ff7a00;font-weight:760}
      .account-avatar.tr-logo-avatar{display:grid;place-items:center;overflow:hidden;padding:1px;background:#fff;border:1px solid rgba(23,26,32,.10)}
      .account-avatar.tr-logo-avatar .tr-logo-mark{width:100%;height:100%}
      @media (max-width:780px){
        .tr-logo-wordmark-text{display:none}
        .tr-logo-wordmark .tr-logo-mark{width:36px;height:30px}
        .topbar>.brand-mark.tr-logo-link{width:38px;min-width:38px}
      }
    `;
    document.head.appendChild(style);
  }

  function installFavicon() {
    const compact = MARK_SVG.replace(/\s{2,}/g, ' ').trim();
    const url = `data:image/svg+xml,${encodeURIComponent(compact)}`;
    let icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.type = 'image/svg+xml';
    icon.href = url;

    let apple = document.querySelector('link[rel="apple-touch-icon"]');
    if (!apple) {
      apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      document.head.appendChild(apple);
    }
    apple.href = url;

    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.content = '#f5f5f7';
  }

  function installTopbar() {
    const brand = document.querySelector('.topbar > .brand-mark');
    if (!brand || brand.dataset.trLogoReady === 'true') return;
    brand.dataset.trLogoReady = 'true';
    brand.classList.add('tr-logo-link');
    brand.innerHTML = `<span class="tr-logo-wordmark">${markHtml()}<span class="tr-logo-wordmark-text">TennisRank <b>AI</b></span></span>`;
  }

  function installAuthBrand() {
    const brand = document.querySelector('.auth-brand-lockup .brand-mark');
    if (!brand || brand.dataset.trLogoReady === 'true') return;
    brand.dataset.trLogoReady = 'true';
    brand.classList.add('tr-logo-auth');
    brand.innerHTML = `${markHtml()}<span class="tr-logo-auth-text">TennisRank <b>AI</b></span>`;
  }

  function installAccountAvatar() {
    const avatar = document.querySelector('#accountAvatar');
    if (!avatar || avatar.dataset.trLogoReady === 'true') return;
    avatar.dataset.trLogoReady = 'true';
    avatar.classList.add('tr-logo-avatar');
    avatar.innerHTML = markHtml();
  }

  function applyBrand() {
    installStyles();
    installFavicon();
    installTopbar();
    installAuthBrand();
    installAccountAvatar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBrand, { once: true });
  else applyBrand();
  window.addEventListener('tennisrank:auth-ready', applyBrand);
})();
