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

  function ensureLayoutFixCss() {
    if (document.querySelector('link[data-tennisrank-layout-fix]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/layout-fix.css';
    link.dataset.tennisrankLayoutFix = 'true';
    document.head.appendChild(link);
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
      document.body.classList.remove('coach-modal-open');
      document.body.removeAttribute('data-modal-stale');
    }
    if (!accountVisible) document.documentElement.classList.remove('tr-account-open');

    if (!previewVisible && !accountVisible) {
      clearInlineLock(document.documentElement);
      clearInlineLock(document.body);
      document.documentElement.removeAttribute('data-scroll-locked');
      document.body.removeAttribute('data-scroll-locked');

      const shell = document.querySelector('#appShell');
      const main = document.querySelector('main#top');
      clearInlineLock(shell);
      clearInlineLock(main);
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
    if (!modalIsVisible(modal)) return;

    setTextIfChanged(modal.querySelector('.coach-modal-head .eyebrow'), 'Quick import check');
    setTextIfChanged(modal.querySelector('#importPreviewTitle'), 'Check this before it goes live');

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

  function polishRankings() {
    const shell = document.querySelector('#ladderExperience');
    if (!shell) return;
    setTextIfChanged(shell.querySelector('#ladderExperienceTitle'), 'Team rankings');
    setTextIfChanged(shell.querySelector('.ladder-intro-copy'), 'One board at a time. Switch between singles, doubles, and mixed. Official challenges stay on the boys and girls singles ladders.');
  }

  function onMutations() {
    repairScrollLocks();
    polishPreview();
    polishRankings();
  }

  function install() {
    if (window.__tennisrankUICohesionInstalled) return;
    window.__tennisrankUICohesionInstalled = true;
    ensureLayoutFixCss();

    const observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'],
    });

    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-preview-cancel],[data-preview-confirm],.coach-modal-backdrop,[data-account-close],[data-account-signout]')) {
        setTimeout(repairScrollLocks, 0);
        setTimeout(repairScrollLocks, 80);
        setTimeout(repairScrollLocks, 240);
      }
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        setTimeout(repairScrollLocks, 0);
        setTimeout(repairScrollLocks, 80);
        setTimeout(repairScrollLocks, 240);
      }
    }, true);

    window.addEventListener('pageshow', repairScrollLocks);
    window.addEventListener('focus', repairScrollLocks);
    window.addEventListener('resize', repairScrollLocks);
    window.addEventListener('tennisrank:auth-ready', () => setTimeout(() => { repairScrollLocks(); polishRankings(); }, 0));
    window.addEventListener('tennisrank:coach-data-changed', () => setTimeout(repairScrollLocks, 0));
    window.addEventListener('tennisrank:ladder-rendered', () => { polishRankings(); repairScrollLocks(); });

    // Safety net for stale classes/styles left behind by interrupted preview/account flows.
    window.setInterval(repairScrollLocks, 1000);

    repairScrollLocks();
    polishPreview();
    polishRankings();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
