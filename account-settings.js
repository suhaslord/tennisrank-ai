(() => {
  'use strict';

  const SHELL_ID = 'trAccountSettingsShell';

  function roleLabel(role) {
    const value = String(role || '').trim().toLowerCase();
    if (value === 'admin') return 'Administrator';
    if (value === 'player') return 'Player';
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Member';
  }

  function clean(value, fallback = '') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text || fallback;
  }

  function initials(value) {
    const parts = clean(value, 'TR').split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map(part => part[0] || '').join('').toUpperCase() || 'TR';
  }

  function ensureShell(win) {
    const doc = win.document;
    let shell = doc.getElementById(SHELL_ID);
    if (shell) return shell;

    shell = doc.createElement('div');
    shell.id = SHELL_ID;
    shell.className = 'tr-account-shell';
    shell.hidden = true;
    shell.innerHTML = `
      <button class="tr-account-backdrop" type="button" data-account-close aria-label="Close account settings"></button>
      <section class="tr-account-sheet" role="dialog" aria-modal="true" aria-labelledby="trAccountSettingsTitle">
        <div class="tr-account-accent" aria-hidden="true"></div>
        <div class="tr-account-heading">
          <div>
            <p>Team access</p>
            <h2 id="trAccountSettingsTitle">Account settings</h2>
          </div>
          <button type="button" class="tr-account-icon-close" data-account-close aria-label="Close account settings"><i class="ph ph-x" aria-hidden="true"></i></button>
        </div>
        <div class="tr-account-identity">
          <span class="tr-account-avatar" data-account-avatar>TR</span>
          <div class="tr-account-person">
            <strong data-account-name>Account</strong>
            <span data-account-role>Member</span>
          </div>
          <span class="tr-account-status"><i class="ph-fill ph-check-circle" aria-hidden="true"></i> Signed in</span>
        </div>
        <p class="tr-account-help">You’re signed in to the private River Islands tennis workspace.</p>
        <div class="tr-account-actions">
          <button type="button" class="tr-account-signout" data-account-signout><i class="ph ph-sign-out" aria-hidden="true"></i><span>Sign out</span></button>
          <button type="button" class="tr-account-close" data-account-close>Close</button>
        </div>
      </section>`;
    doc.body.appendChild(shell);
    return shell;
  }

  function fillIdentity(win, shell) {
    const profile = win.TennisRankAuth?.getProfile?.() || {};
    const domName = clean(win.document.querySelector('#accountName')?.textContent);
    const name = clean(profile.full_name || profile.player_name || domName, 'Account');
    const role = roleLabel(profile.role || win.document.querySelector('#accountRole')?.textContent);
    const avatar = shell.querySelector('[data-account-avatar]');
    const nameNode = shell.querySelector('[data-account-name]');
    const roleNode = shell.querySelector('[data-account-role]');
    if (avatar) avatar.textContent = initials(name);
    if (nameNode) nameNode.textContent = name;
    if (roleNode) roleNode.textContent = role;
  }

  function close(win, restoreFocus = true) {
    const shell = win.document.getElementById(SHELL_ID);
    if (!shell || shell.hidden) return;
    shell.hidden = true;
    win.document.documentElement.classList.remove('tr-account-open');
    if (restoreFocus) win.document.querySelector('#accountMenu')?.focus?.();
  }

  function open(win) {
    const shell = ensureShell(win);
    fillIdentity(win, shell);
    shell.hidden = false;
    win.document.documentElement.classList.add('tr-account-open');
    shell.querySelector('[data-account-signout]')?.focus?.();
  }

  function requestSignout(win) {
    close(win, false);
    win.__tennisrankAccountSignoutBypass = true;
    const account = win.document.querySelector('#accountMenu');
    if (account) account.click();
    else {
      try { win.localStorage?.removeItem?.('tennisRankAuthSessionV1'); } catch {}
      win.location.assign('/');
    }
  }

  function install(win) {
    if (!win?.document || win.__tennisrankAccountSettingsInstalled) return;
    win.__tennisrankAccountSettingsInstalled = true;
    const doc = win.document;
    ensureShell(win);

    doc.addEventListener('click', event => {
      const account = event.target?.closest?.('#accountMenu');
      if (!account) return;
      if (win.__tennisrankAccountSignoutBypass) {
        win.__tennisrankAccountSignoutBypass = false;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      open(win);
    }, true);

    doc.addEventListener('click', event => {
      if (event.target?.closest?.('[data-account-signout]')) {
        event.preventDefault();
        requestSignout(win);
        return;
      }
      if (event.target?.closest?.('[data-account-close]')) {
        event.preventDefault();
        close(win);
      }
    });

    doc.addEventListener('keydown', event => {
      const shell = doc.getElementById(SHELL_ID);
      if (!shell || shell.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close(win);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...shell.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
        .filter(element => element.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    const account = doc.querySelector('#accountMenu');
    if (account) {
      account.setAttribute('aria-label', 'Open account settings');
      account.setAttribute('aria-haspopup', 'dialog');
      const icon = account.querySelector('i');
      if (icon) {
        icon.className = 'ph ph-caret-down';
        icon.setAttribute('aria-hidden', 'true');
      }
    }

    win.addEventListener?.('tennisrank:auth-ready', () => {
      const shell = ensureShell(win);
      fillIdentity(win, shell);
    });
  }

  if (typeof window !== 'undefined' && window.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(window), { once: true });
    else install(window);
  }
})();
