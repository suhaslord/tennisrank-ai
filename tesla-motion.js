(() => {
  'use strict';

  const root = document.documentElement;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet();
  let observer = null;

  const SELECTOR_GROUPS = [
    ['.auth-card-topline,.auth-card>.eyebrow,#authTitle,.auth-copy,#loginForm,.text-button,.auth-footnote', true],
    ['.hero-content>.eyebrow,.hero-content>h1,.hero-copy,.hero-actions,.hero-note', true],
    ['.section-heading,.summary-grid,.insight-strip,.story-card,.spotlight-card,.table-card,.matches-card,.data-panel,.accounts-panel', false],
    ['.ladder-intro,.ladder-tabs,.ladder-stage,.ladder-board,.challenge-center,.coach-ladder-console', false],
    ['.ranking-card,.ladder-row,.match-row,.challenge-item,.approval-item,.coach-roster-row', false],
  ];

  function reduced() {
    return motionQuery.matches;
  }

  function setMode() {
    root.dataset.trMotion = reduced() ? 'reduced' : 'enabled';
    if (reduced()) {
      document.querySelectorAll('.tr-motion-item').forEach(el => el.classList.add('is-tr-visible'));
    }
  }

  function mark(el, delay = 0, kind = 'rise', immediate = false) {
    if (!el || seen.has(el)) return;
    seen.add(el);
    el.classList.add('tr-motion-item');
    el.dataset.trMotionKind = kind;
    el.style.setProperty('--tr-delay', `${Math.min(delay, 220)}ms`);

    if (reduced() || immediate) {
      requestAnimationFrame(() => el.classList.add('is-tr-visible'));
      return;
    }
    observer?.observe(el);
  }

  function markGroup(selector, immediate = false, scope = document) {
    const nodes = [...scope.querySelectorAll(selector)];
    nodes.forEach((el, index) => mark(el, index * 45, index === 0 ? 'fade' : 'rise', immediate));
  }

  function scan(scope = document) {
    for (const [selector, immediate] of SELECTOR_GROUPS) markGroup(selector, immediate, scope);
  }

  function setupObserver() {
    observer?.disconnect();
    if (reduced()) return;
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-tr-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }

  function setHeroReady() {
    const hero = document.querySelector('.hero-section');
    if (!hero) return;
    requestAnimationFrame(() => hero.classList.add('tr-hero-ready'));
  }

  function syncTopbar() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    topbar.classList.toggle('is-scrolled', window.scrollY > 18);
  }

  function setupMutationObserver() {
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLDialogElement && record.target.open) {
          record.target.classList.add('tr-dialog-open');
          continue;
        }
        record.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          scan(node);
          if (node.matches?.('.ranking-card,.ladder-row,.match-row,.challenge-item,.approval-item,.coach-roster-row')) {
            mark(node, 0, 'rise', false);
          }
        });
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  }

  function boot() {
    setMode();
    setupObserver();
    scan();
    requestAnimationFrame(() => {
      root.classList.add('tr-motion-booted');
      setHeroReady();
    });
    setupMutationObserver();
    syncTopbar();
    window.addEventListener('scroll', syncTopbar, { passive: true });
    window.addEventListener('tennisrank:auth-ready', () => {
      scan();
      setHeroReady();
      syncTopbar();
    });
    window.addEventListener('tennisrank:ladder-rendered', () => scan());
    window.addEventListener('tennisrank:ladder-workflow-ready', () => scan());
  }

  motionQuery.addEventListener?.('change', () => {
    setMode();
    setupObserver();
    scan();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
