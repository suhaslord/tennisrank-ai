(() => {
  'use strict';

  const STYLE_ID = 'tr-essential-ui-style';
  const BAR_ID = 'trEssentialBar';

  function installStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.tr-essential .hero-section,
      html.tr-essential #summaryGrid,
      html.tr-essential #insightStrip,
      html.tr-essential .recent-heading,
      html.tr-essential #matchesList,
      html.tr-essential .season-gallery,
      html.tr-essential .bottom-nav{display:none!important}

      html.tr-admin-essential #coachOpsDashboard{display:none!important}
      html.tr-admin-essential .topbar .live-pill,
      html.tr-admin-essential #openSettings,
      html.tr-admin-essential .topbar-links a[href="#statsSection"]{display:none!important}

      html.tr-admin-essential #settingsPanel,
      html.tr-admin-essential #accountsPanel{display:none!important}
      html.tr-admin-essential #settingsPanel.tr-essential-open,
      html.tr-admin-essential #accountsPanel.tr-essential-open{display:block!important}

      html.tr-admin-essential #settingsPanel .refresh-controls,
      html.tr-admin-essential #settingsPanel .backend-row,
      html.tr-admin-essential #settingsPanel .format-guide{display:none!important}

      html.tr-admin-essential main{padding-top:18px}
      html.tr-admin-essential #rankingsSection{margin-top:12px}

      .tr-essential-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin:12px 0 26px;padding:18px 20px;border:1px solid rgba(23,26,32,.10);border-radius:18px;background:#fff;box-shadow:0 10px 30px rgba(23,26,32,.05)}
      .tr-essential-copy{display:grid;gap:3px}
      .tr-essential-copy small{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#6d797f;font-weight:700}
      .tr-essential-copy strong{font-size:24px;letter-spacing:-.04em;color:#171a20}
      .tr-essential-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .tr-essential-actions button{min-height:42px}
      .tr-remove-data{border-color:rgba(180,40,40,.25)!important;color:#a92222!important;background:#fff!important}
      .tr-remove-data:hover{background:#fff4f4!important}
      .tr-essential-note{margin:0 0 18px;color:#6d797f;font-size:13px}
      #settingsPanel.tr-essential-open,#accountsPanel.tr-essential-open{margin-top:18px}

      @media(max-width:700px){
        .tr-essential-bar{align-items:stretch;padding:15px}
        .tr-essential-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}
        .tr-essential-actions button{width:100%;justify-content:center}
        .tr-essential-actions .tr-remove-data{grid-column:1/-1}
      }
    `;
    doc.head.appendChild(style);
  }

  function role(win) {
    return String(win.TennisRankAuth?.getProfile?.()?.role || '').toLowerCase();
  }

  function closePanels(doc) {
    doc.querySelector('#settingsPanel')?.classList.remove('tr-essential-open');
    doc.querySelector('#accountsPanel')?.classList.remove('tr-essential-open');
  }

  function scrollTo(doc, selector) {
    const target = doc.querySelector(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showLeaderboard(win) {
    closePanels(win.document);
    scrollTo(win.document, '#rankingsSection');
  }

  function showData(win) {
    const panel = win.document.querySelector('#settingsPanel');
    if (!panel) return;
    closePanels(win.document);
    panel.classList.add('tr-essential-open');
    const title = panel.querySelector('.panel-heading h2');
    const copy = panel.querySelector('.panel-copy');
    if (title) title.textContent = 'Update data';
    if (copy) copy.textContent = 'Paste a Google Sheet link or upload a file. TennisRank checks the data before anything is published.';
    scrollTo(win.document, '#settingsPanel');
    win.setTimeout?.(() => win.document.querySelector('#sheetUrl')?.focus(), 250);
  }

  function showAccounts(win) {
    const panel = win.document.querySelector('#accountsPanel');
    if (!panel) return;
    closePanels(win.document);
    panel.classList.add('tr-essential-open');
    scrollTo(win.document, '#accountsPanel');
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
    button.innerHTML = busy ? `<i class="ph ph-circle-notch" aria-hidden="true"></i><span>${label || 'Working…'}</span>` : button.dataset.originalText;
  }

  async function removeData(win, button) {
    const confirmed = win.confirm('Remove all imported match data and clear the live leaderboard? Player accounts will stay. A rollback snapshot is kept in Import History.');
    if (!confirmed) return;
    setBusy(button, true, 'Removing…');
    try {
      const response = await win.TennisRankAuth.fetch('/api/records', {
        method: 'POST',
        body: JSON.stringify({ action: 'clear' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not remove data (${response.status}).`);
      try {
        win.localStorage?.removeItem('tennisRankDataSnapshotV1');
        win.localStorage?.removeItem('tennisRankSheetUrl');
      } catch {}
      if (typeof win.clearBoard === 'function') win.clearBoard();
      const status = win.document.querySelector('#statusMessage');
      if (status) {
        status.textContent = payload.message || 'Imported data removed.';
        status.classList.remove('error');
      }
      win.setTimeout?.(() => win.location.reload(), 350);
    } catch (error) {
      win.alert(error.message || 'The data could not be removed.');
      setBusy(button, false);
    }
  }

  function makeAction(doc, label, icon, className, handler) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `secondary-button ${className || ''}`.trim();
    button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>`;
    button.addEventListener('click', handler);
    return button;
  }

  function installBar(win) {
    const doc = win.document;
    if (doc.getElementById(BAR_ID)) return;
    const rankings = doc.querySelector('#rankingsSection');
    if (!rankings?.parentNode) return;

    const bar = doc.createElement('section');
    bar.id = BAR_ID;
    bar.className = 'tr-essential-bar admin-only';
    bar.setAttribute('aria-label', 'Coach essentials');
    bar.innerHTML = `<div class="tr-essential-copy"><small>Coach essentials</small><strong>Team leaderboard</strong></div>`;

    const actions = doc.createElement('div');
    actions.className = 'tr-essential-actions';
    actions.append(
      makeAction(doc, 'Leaderboard', 'ph-ranking', '', () => showLeaderboard(win)),
      makeAction(doc, 'Update data', 'ph-upload-simple', '', () => showData(win)),
      makeAction(doc, 'Player accounts', 'ph-users-three', '', () => showAccounts(win)),
    );
    const remove = makeAction(doc, 'Remove data', 'ph-trash', 'tr-remove-data', () => removeData(win, remove));
    actions.append(remove);
    bar.append(actions);
    rankings.parentNode.insertBefore(bar, rankings);
  }

  function bindExistingControls(win) {
    const doc = win.document;
    const dataLink = doc.querySelector('.topbar-links a[href="#settingsPanel"]');
    if (dataLink && dataLink.dataset.essentialBound !== 'true') {
      dataLink.dataset.essentialBound = 'true';
      dataLink.addEventListener('click', event => {
        event.preventDefault();
        showData(win);
      });
    }
    const rankingsLink = doc.querySelector('.topbar-links a[href="#rankingsSection"]');
    if (rankingsLink && rankingsLink.dataset.essentialBound !== 'true') {
      rankingsLink.dataset.essentialBound = 'true';
      rankingsLink.addEventListener('click', event => {
        event.preventDefault();
        showLeaderboard(win);
      });
    }
    const close = doc.querySelector('#closeSettings');
    if (close && close.dataset.essentialBound !== 'true') {
      close.dataset.essentialBound = 'true';
      close.addEventListener('click', () => showLeaderboard(win));
    }
  }

  function apply(win) {
    const doc = win.document;
    if (!doc) return;
    installStyles(doc);
    const currentRole = role(win);
    doc.documentElement.classList.add('tr-essential');
    doc.documentElement.classList.toggle('tr-admin-essential', currentRole === 'admin');
    doc.documentElement.classList.toggle('tr-player-essential', currentRole === 'player');

    if (currentRole === 'admin') {
      installBar(win);
      bindExistingControls(win);
      const title = doc.querySelector('#settingsPanel .panel-heading h2');
      const copy = doc.querySelector('#settingsPanel .panel-copy');
      if (title) title.textContent = 'Update data';
      if (copy) copy.textContent = 'Paste a Google Sheet link or upload a file. TennisRank checks the data before anything is published.';
    }
  }

  function boot(win) {
    apply(win);
    for (const delay of [50, 150, 400, 900, 1800]) win.setTimeout?.(() => apply(win), delay);
  }

  if (typeof window !== 'undefined' && window.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(window), { once: true });
    else boot(window);
    window.addEventListener('tennisrank:auth-ready', () => boot(window));
    window.addEventListener('tennisrank:coach-data-changed', () => apply(window));
  }
})();
