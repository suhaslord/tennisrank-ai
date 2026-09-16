(() => {
  'use strict';

  const UNLOCK_PROPS = [
    'overflow', 'overflow-x', 'overflow-y', 'position', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'max-height', 'touch-action', 'overscroll-behavior', 'overscroll-behavior-y',
  ];

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function setTextIfChanged(node, value) {
    if (!node) return false;
    const next = String(value ?? '');
    if (node.textContent === next) return false;
    node.textContent = next;
    return true;
  }

  function ensureStyle(href, dataName) {
    if (document.querySelector(`link[${dataName}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(dataName, 'true');
    document.head.appendChild(link);
  }

  function ensureReviewStyles() {
    ensureStyle('/layout-fix.css', 'data-tennisrank-layout-fix');
    ensureStyle('/review-fixes.css', 'data-tennisrank-review-fixes');
  }

  function hasMixedBoard() {
    try {
      return Array.isArray(state?.rankings) && state.rankings.some(item => String(item?.gender || '').toLowerCase() === 'mixed' && String(item?.division || '').toLowerCase() === 'doubles');
    } catch {
      return false;
    }
  }

  function modalIsVisible(modal) {
    if (!modal || modal.hidden || modal.getAttribute('aria-hidden') === 'true') return false;
    try {
      const style = getComputedStyle(modal);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return modal.getClientRects().length > 0;
    } catch {
      return true;
    }
  }

  function clearInlineLock(node) {
    if (!node?.style) return;
    UNLOCK_PROPS.forEach(prop => {
      if (node.style.getPropertyValue(prop)) node.style.removeProperty(prop);
    });
  }

  function repairScrollLocks() {
    const preview = document.querySelector('#importPreviewModal');
    const account = document.querySelector('#trAccountSettingsShell');
    const previewVisible = modalIsVisible(preview);
    const accountVisible = modalIsVisible(account);

    if (!previewVisible) {
      if (document.body.classList.contains('coach-modal-open')) document.body.classList.remove('coach-modal-open');
      if (document.body.hasAttribute('data-modal-stale')) document.body.removeAttribute('data-modal-stale');
    }
    if (!accountVisible && document.documentElement.classList.contains('tr-account-open')) {
      document.documentElement.classList.remove('tr-account-open');
    }

    if (!previewVisible && !accountVisible) {
      clearInlineLock(document.documentElement);
      clearInlineLock(document.body);
      document.documentElement.removeAttribute('data-scroll-locked');
      document.body.removeAttribute('data-scroll-locked');
      clearInlineLock(document.querySelector('#appShell'));
      clearInlineLock(document.querySelector('main#top'));
    }
  }

  function removeMissingBoardWarnings(modal) {
    const warning = modal.querySelector('.coach-warning-box');
    if (!warning) return;
    const list = warning.querySelector('.coach-change-list');
    if (!list) return;

    [...list.querySelectorAll('li')].forEach(item => {
      const text = clean(item.textContent);
      if (/^(We didn.t find )?(Boys|Girls|Mixed) (Singles|Doubles) (was not detected|wasn.t found|was not found|wasn.t detected|in this import)/i.test(text)
        || /^We didn.t find (Boys|Girls|Mixed) (Singles|Doubles) in this import\.?$/i.test(text)) item.remove();
    });

    if (!list.querySelector('li')) {
      const safe = document.createElement('div');
      safe.className = 'coach-safe-box';
      safe.innerHTML = '<i class="ph ph-shield-check" aria-hidden="true"></i><span>No structural issues found. Review the boards below, then publish.</span>';
      warning.replaceWith(safe);
      return;
    }

    setTextIfChanged(warning.querySelector(':scope > strong'), 'Needs a quick look');
  }

  function polishPreview() {
    const modal = document.querySelector('#importPreviewModal');
    if (!modalIsVisible(modal)) return;

    setTextIfChanged(modal.querySelector('.coach-modal-head .eyebrow'), 'Quick import check');
    setTextIfChanged(modal.querySelector('#importPreviewTitle'), 'Check this before it goes live');

    const articles = [...modal.querySelectorAll('.coach-preview-grid article')];
    const labels = ['New players', 'Removed or inactive', 'Ranking changes', 'Boards in this import'];
    articles.forEach((article, index) => {
      if (labels[index]) setTextIfChanged(article.querySelector('h3'), labels[index]);
    });

    if (hasMixedBoard()) {
      modal.querySelectorAll('.coach-preview-grid li b').forEach(node => {
        if (clean(node.textContent) === 'Unknown Doubles') setTextIfChanged(node, 'Mixed Doubles');
      });
    }
    removeMissingBoardWarnings(modal);
  }

  function polishRankings() {
    const shell = document.querySelector('#ladderExperience');
    if (!shell) return;
    setTextIfChanged(shell.querySelector('#ladderExperienceTitle'), 'Team rankings');
    setTextIfChanged(shell.querySelector('.ladder-intro-copy'), 'One board at a time. Switch between singles, doubles, and mixed. Official challenges stay on the boys and girls singles ladders.');
    document.querySelectorAll('a[href="#rankingsSection"]').forEach(link => link.setAttribute('href', '#ladderExperience'));
  }

  function refreshUi() {
    repairScrollLocks();
    polishPreview();
    polishRankings();
  }

  function scheduleRefresh() {
    for (const delay of [0, 30, 80, 180, 360]) setTimeout(refreshUi, delay);
  }

  function attachPreviewWatcher(modal) {
    if (!modal || modal.dataset.cohesionWatched === 'true') return;
    modal.dataset.cohesionWatched = 'true';
    const body = modal.querySelector('#importPreviewBody');
    if (!body || !('MutationObserver' in window)) return;
    const observer = new MutationObserver(() => {
      // Scoped child-list observer only. It cannot feed back through global
      // class/style mutations and exists solely to clean preview copy before paint.
      polishPreview();
    });
    observer.observe(body, { childList: true });
    polishPreview();
  }

  function installPreviewWatcher() {
    const existing = document.querySelector('#importPreviewModal');
    if (existing) { attachPreviewWatcher(existing); return; }
    if (!document.body || !('MutationObserver' in window)) return;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node?.nodeType === 1 && node.id === 'importPreviewModal') {
            observer.disconnect();
            attachPreviewWatcher(node);
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
  }

  function scrollToRankings() {
    const target = document.querySelector('#ladderExperience');
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  function install() {
    if (window.__tennisrankUICohesionInstalled) return;
    window.__tennisrankUICohesionInstalled = true;
    ensureReviewStyles();
    installPreviewWatcher();

    // Deliberately avoid a document-wide MutationObserver here. This layer changes
    // classes/styles/text itself, so observing those same mutations can create a
    // synchronous feedback loop during startup.
    document.addEventListener('click', event => {
      const rankingTrigger = event.target?.closest?.('#heroRankings,#navRankings');
      if (rankingTrigger && scrollToRankings()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.target?.closest?.(
        '[data-preview-cancel],[data-preview-confirm],.coach-modal-backdrop,[data-account-close],[data-account-signout],#accountMenu,#useCsv,#connectSheet,#refreshNow,#saveBackend,[data-ladder-board]'
      )) scheduleRefresh();
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') scheduleRefresh();
    }, true);

    window.addEventListener('pageshow', scheduleRefresh);
    window.addEventListener('focus', repairScrollLocks);
    window.addEventListener('resize', repairScrollLocks);
    window.addEventListener('tennisrank:auth-ready', scheduleRefresh);
    window.addEventListener('tennisrank:coach-data-changed', scheduleRefresh);
    window.addEventListener('tennisrank:ladder-rendered', scheduleRefresh);

    window.setInterval(refreshUi, 1000);
    scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
