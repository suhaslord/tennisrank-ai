(() => {
  'use strict';

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

  function hasMixedBoard() {
    try {
      return Array.isArray(state?.rankings) && state.rankings.some(item => String(item?.gender || '').toLowerCase() === 'mixed' && String(item?.division || '').toLowerCase() === 'doubles');
    } catch {
      return false;
    }
  }

  function modalIsVisible(modal) {
    if (!modal || modal.hidden) return false;
    try { return getComputedStyle(modal).display !== 'none'; }
    catch { return true; }
  }

  function repairScrollLocks() {
    const preview = document.querySelector('#importPreviewModal');
    const previewVisible = modalIsVisible(preview);
    if (!previewVisible) {
      if (document.body.classList.contains('coach-modal-open')) document.body.classList.remove('coach-modal-open');
      if (document.body.hasAttribute('data-modal-stale')) document.body.removeAttribute('data-modal-stale');
    }

    const account = document.querySelector('#trAccountSettingsShell');
    const accountVisible = modalIsVisible(account);
    if (!accountVisible && document.documentElement.classList.contains('tr-account-open')) {
      document.documentElement.classList.remove('tr-account-open');
    }

    if (!previewVisible && !accountVisible) {
      if (document.documentElement.style.getPropertyValue('overflow')) document.documentElement.style.removeProperty('overflow');
      if (document.body.style.getPropertyValue('overflow')) document.body.style.removeProperty('overflow');
      if (document.body.style.getPropertyValue('overflow-y')) document.body.style.removeProperty('overflow-y');
    }
  }

  function removeMissingBoardWarnings(modal) {
    const warning = modal.querySelector('.coach-warning-box');
    if (!warning) return;
    const list = warning.querySelector('.coach-change-list');
    if (!list) return;

    [...list.querySelectorAll('li')].forEach(item => {
      const text = clean(item.textContent);
      if (/^(Boys|Girls|Mixed) (Singles|Doubles) (was not detected|wasn.t found|was not found|wasn.t detected)/i.test(text)) item.remove();
    });

    if (!list.querySelector('li')) {
      const safe = document.createElement('div');
      safe.className = 'coach-safe-box';
      safe.innerHTML = '<i class="ph ph-shield-check" aria-hidden="true"></i><span>No structural issues found. Review the boards below, then publish.</span>';
      warning.replaceWith(safe);
      return;
    }

    const heading = warning.querySelector(':scope > strong');
    setTextIfChanged(heading, 'Needs a quick look');
  }

  function polishPreview() {
    const modal = document.querySelector('#importPreviewModal');
    // Some historical markup hides this modal with CSS instead of the `hidden`
    // attribute. Treat computed visibility as authoritative so the observer does
    // not rewrite hidden modal text forever during DOMContentLoaded.
    if (!modalIsVisible(modal)) return;

    const eyebrow = modal.querySelector('.coach-modal-head .eyebrow');
    const title = modal.querySelector('#importPreviewTitle');
    setTextIfChanged(eyebrow, 'Quick import check');
    setTextIfChanged(title, 'Check this before it goes live');

    const articles = [...modal.querySelectorAll('.coach-preview-grid article')];
    const labels = ['New players', 'Removed or inactive', 'Ranking changes', 'Boards in this import'];
    articles.forEach((article, index) => {
      const heading = article.querySelector('h3');
      if (heading && labels[index]) setTextIfChanged(heading, labels[index]);
    });

    if (hasMixedBoard()) {
      modal.querySelectorAll('.coach-preview-grid li b').forEach(node => {
        if (clean(node.textContent) === 'Unknown Doubles') setTextIfChanged(node, 'Mixed Doubles');
      });
    }

    removeMissingBoardWarnings(modal);
  }

  function onMutations() {
    repairScrollLocks();
    polishPreview();
  }

  function install() {
    if (window.__tennisrankUICohesionInstalled) return;
    window.__tennisrankUICohesionInstalled = true;

    const observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });

    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-preview-cancel],[data-preview-confirm],.coach-modal-backdrop,[data-account-close],[data-account-signout]')) {
        setTimeout(repairScrollLocks, 0);
        setTimeout(repairScrollLocks, 80);
      }
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        setTimeout(repairScrollLocks, 0);
        setTimeout(repairScrollLocks, 80);
      }
    }, true);

    window.addEventListener('pageshow', repairScrollLocks);
    window.addEventListener('tennisrank:auth-ready', () => setTimeout(repairScrollLocks, 0));
    window.addEventListener('tennisrank:coach-data-changed', () => setTimeout(repairScrollLocks, 0));

    repairScrollLocks();
    polishPreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();