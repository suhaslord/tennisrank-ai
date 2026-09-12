(() => {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let dismiss = () => {};

  window.addEventListener('tennisrank:login-success', () => {
    dismiss();
    if (motion.matches || document.hidden) return;
    const arrival = document.createElement('div');
    arrival.className = 'login-arrival';
    arrival.setAttribute('aria-hidden', 'true');
    arrival.innerHTML = `<div class="login-arrival-mark">
      <svg viewBox="0 0 360 240" fill="none" focusable="false">
        <path class="arrival-court" pathLength="1" d="M40 45H320V195H40Z M40 65H320 M40 175H320 M110 65V175 M250 65V175 M110 120H250" />
        <path class="arrival-net" pathLength="1" d="M180 35V205" />
        <circle class="arrival-ball" cx="110" cy="155" r="5" />
      </svg>
      <span>You're on court.</span>
    </div>`;
    document.body.append(arrival);
    // Decoration never blocks navigation, focus, or a quick second action.
    let fallback;
    dismiss = () => {
      clearTimeout(fallback);
      arrival.remove();
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
    arrival.addEventListener('animationend', event => {
      if (event.target === arrival) dismiss();
    });
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    fallback = setTimeout(dismiss, 1000);
  });

  motion.addEventListener('change', () => { if (motion.matches) dismiss(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) dismiss(); });
})();
