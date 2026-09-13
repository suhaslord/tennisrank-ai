(function () {
  'use strict';

  function explicitGid(url) {
    return url.hash.match(/(?:^|[&#])gid=(\d+)/)?.[1] || url.searchParams.get('gid') || '';
  }

  function googleCsvTarget(input) {
    let url;
    try { url = new URL(String(input || '').trim()); }
    catch { throw new Error('Enter a valid spreadsheet link.'); }

    const host = url.hostname.toLowerCase();
    const gid = explicitGid(url);
    const gidSuffix = gid ? `&gid=${encodeURIComponent(gid)}` : '';

    if (host === 'docs.google.com') {
      const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)/i);
      if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gidSuffix}`;

      const standard = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/i);
      if (standard) return `https://docs.google.com/spreadsheets/d/${standard[1]}/export?format=csv${gidSuffix}`;
    }

    if (host === 'drive.google.com') {
      const id = url.searchParams.get('id');
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gidSuffix}`;
    }

    return url.href;
  }

  function googleCsvProxy(input) {
    const target = googleCsvTarget(input);
    const parsed = new URL(target);
    return parsed.hostname.toLowerCase() === 'docs.google.com'
      ? `/api/sheet-proxy?url=${encodeURIComponent(target)}`
      : target;
  }

  function installSheetLinkFix(win) {
    win.googleCsvUrl = googleCsvProxy;
    if (win.TennisRankImportV2) {
      win.TennisRankImportV2.googleCsvUrl = googleCsvTarget;
      win.TennisRankImportV2.googleCsvProxyUrl = googleCsvProxy;
    }
  }

  function installDataGuide(win) {
    const guide = win.document.querySelector('.format-guide');
    if (!guide || guide.dataset.matchFormatReady === 'true') return;
    guide.dataset.matchFormatReady = 'true';
    const strong = guide.querySelector('strong');
    const code = guide.querySelector('code');
    const note = guide.querySelector('span');
    if (strong) strong.textContent = 'Expected match columns';
    if (code) code.textContent = 'Name · Gender · Division · Player 1 · Player 2 · Winner · Loser · Score · Date';
    if (note) note.textContent = 'For each match, include Gender, Division, Player 1, Player 2, Winner, and Loser. Score and Date are optional but recommended. Doubles teams should use the same “Name & Name” text throughout.';
  }

  function scrollTo(win, selector) {
    const target = win.document.querySelector(selector);
    if (!target) return false;
    if (target.hidden) target.hidden = false;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  function button(label, icon, action) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'secondary-button coach-quick-action';
    el.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>`;
    el.addEventListener('click', action);
    return el;
  }

  function install(win) {
    installSheetLinkFix(win);
    installDataGuide(win);

    const dashboard = win.document.querySelector('#coachOpsDashboard');
    if (!dashboard || dashboard.dataset.polished === 'true') return false;
    dashboard.dataset.polished = 'true';

    const heading = dashboard.querySelector('.coach-ops-heading');
    if (heading) {
      const existingRefresh = heading.querySelector('#refreshCoachOps');
      const actions = win.document.createElement('div');
      actions.className = 'coach-heading-actions';
      actions.append(
        button('Import results', 'ph-upload-simple', () => {
          const opener = win.document.querySelector('#openSettings');
          if (opener) opener.click();
          win.setTimeout(() => scrollTo(win, '#settingsPanel'), 50);
        }),
        button('Player accounts', 'ph-users-three', () => scrollTo(win, '#accountsPanel')),
        button('Rankings', 'ph-ranking', () => scrollTo(win, '#rankingsSection')),
      );
      if (existingRefresh) actions.append(existingRefresh);
      heading.append(actions);
    }

    const guide = win.document.createElement('div');
    guide.className = 'coach-workflow-guide';
    guide.setAttribute('aria-label', 'Coach workflow');
    guide.innerHTML = `
      <div><b>1</b><span><strong>Import</strong><small>Connect the latest team results.</small></span></div>
      <div><b>2</b><span><strong>Review</strong><small>Check warnings and rank changes.</small></span></div>
      <div><b>3</b><span><strong>Publish</strong><small>Save only after the preview looks right.</small></span></div>
      <div><b>4</b><span><strong>Approve</strong><small>Handle pending scores and challenges.</small></span></div>`;
    const attention = dashboard.querySelector('#coachAttentionGrid');
    if (attention) {
      attention.setAttribute('aria-live', 'polite');
      attention.parentNode.insertBefore(guide, attention);
    }

    const needsAttention = dashboard.querySelector('#coachNeedsAttention');
    if (needsAttention) needsAttention.setAttribute('aria-live', 'polite');
    return true;
  }

  function boot(win) {
    installSheetLinkFix(win);
    installDataGuide(win);
    if (install(win)) return;
    let attempts = 0;
    const timer = win.setInterval(() => {
      attempts += 1;
      installSheetLinkFix(win);
      installDataGuide(win);
      if (install(win) || attempts >= 80) win.clearInterval(timer);
    }, 100);
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { explicitGid, googleCsvTarget, googleCsvProxy };
  }

  if (typeof window !== 'undefined' && window.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(window), { once: true });
    else boot(window);
    window.addEventListener('tennisrank:auth-ready', () => boot(window));
    window.addEventListener('tennisrank:coach-data-changed', () => boot(window));
  }
})();
