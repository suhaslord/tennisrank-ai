(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COPY = [
    ['#authTitle', 'Welcome back.'],
    ['.auth-copy', 'Sign in to see your team.'],
    ['label[for="loginEmail"]', 'Email'],
    ['label[for="loginPassword"]', 'Password'],
    ['#forgotPassword', 'Forgot your password?'],
    ['#showBootstrap', 'Set up first admin'],
    ['#bootstrapForm .auth-divider span', 'First admin setup'],
    ['label[for="bootstrapEmail"]', 'Admin email'],
    ['label[for="bootstrapToken"]', 'Admin setup code'],
    ['label[for="bootstrapPassword"]', 'Create a password'],
    ['#bootstrapButton span', 'Create admin account'],
    ['.auth-footnote', 'Team data is only available to invited accounts.'],

    ['.hero-section .eyebrow', 'River Islands tennis'],
    ['.hero-copy', 'Check rankings, recent results, and player stats. Coaches can update everything from the same sheet the team already uses.'],
    ['#heroRankings span', 'See rankings'],
    ['#heroData span', 'Update team data'],
    ['#heroSourceLabel', 'Ready to import'],
    ['#heroRowCount', 'No rows yet'],
    ['.visual-topline > span:first-child', 'Season snapshot'],
    ['.visual-status', 'Ready'],
    ['.visual-label', 'Match difference'],
    ['#heroDiffDetail', 'Waiting for results'],
    ['#heroMatchCount', 'No matches yet'],
    ['#heroUpdateState', 'No data yet'],

    ['#playerDashboard .eyebrow', 'Your season'],
    ['#playerDashboardTitle', 'How you’re doing'],
    ['#playerDashboard .role-pill', 'Player view'],
    ['.player-history-card .eyebrow', 'Recent results'],
    ['.player-history-card h3', 'Your matches'],

    ['#rankingsSection .eyebrow', 'Team rankings'],
    ['#rankingsSection h2', 'Current rankings'],
    ['#lastUpdated', 'No results yet'],
    ['button[data-gender="all"]', 'Everyone'],
    ['button[data-division="all"]', 'Singles & doubles'],
    ['#statsSection .eyebrow', 'Full team'],
    ['#statsSection h2', 'All players'],
    ['#statsSection .record-note', 'Sorted by record'],
    ['.recent-heading .eyebrow', 'Recent results'],
    ['.recent-heading h2', 'Latest matches'],

    ['#settingsPanel .eyebrow', 'Coach tools'],
    ['#settingsPanel h2', 'Update team data'],
    ['#settingsPanel .panel-copy', 'Connect a Google Sheet, upload a CSV, or paste rows here. We’ll check the columns first so you can review everything before it goes live.'],
    ['#tabSheet', 'Google Sheet'],
    ['#tabCsv', 'CSV or file'],
    ['label[for="sheetUrl"]', 'Google Sheet link'],
    ['#connectSheet span', 'Connect sheet'],
    ['#sheetSource .helper-text', 'Make sure the sheet is shared as “Anyone with the link – Viewer.” We’ll show you what we found before saving anything.'],
    ['label[for="csvFile"]', 'Upload a CSV'],
    ['label[for="csvText"]', 'Or paste rows here'],
    ['#useCsv span', 'Preview pasted data'],
    ['.analyzer-kicker', 'Quick check'],
    ['#analyzerTitle', 'We’ll check your data before anything changes'],
    ['#analyzerConfidence', 'WAITING'],
    ['#analyzerNote', 'Add a sheet or CSV and we’ll show you what we recognized.'],
    ['label[for="refreshRate"]', 'Auto-refresh'],
    ['#refreshNow span', 'Refresh now'],
    ['.backend-row label', 'Saved team data'],
    ['#backendStatus', 'Checking connection…'],
    ['#saveBackend span', 'Save this version'],
    ['.format-guide strong', 'Common columns we recognize'],
    ['.format-guide span', 'We also handle common variations, title rows, Boys/Girls sections, Singles/Doubles sections, and simple W/L match rows.'],

    ['#accountsPanel .eyebrow', 'Team access'],
    ['#accountsPanel h2', 'Player accounts'],
    ['#accountsPanel .role-pill', 'Coach only'],
    ['#accountsPanel .panel-copy', 'Choose a player, add their email, and send them a setup link. Player accounts can view the team but can’t change results.'],
    ['label[for="inviteEmail"]', 'Player email'],
    ['label[for="inviteFullName"]', 'Display name'],
    ['label[for="invitePlayerName"]', 'Name in your sheet'],
    ['label[for="inviteRole"]', 'Role'],
    ['label[for="inviteDelivery"]', 'How should they get access?'],
    ['label[for="invitePassword"]', 'Temporary password'],
    ['#inviteButton span', 'Create account'],

    ['.season-gallery-heading .eyebrow', 'From the court'],
    ['#seasonGalleryTitle', 'More than rankings.'],
    ['.season-gallery-heading > p:last-child', 'The people, matches, and moments behind the season.'],
  ];

  const HTML_COPY = [
    ['.hero-content h1', 'See the team.<br />Track the season.<br /><span>Stay current.</span>'],
  ];

  const SELECT_COPY = {
    '#inviteRole': {
      player: 'Player — view only',
      admin: 'Admin — can update the team',
    },
    '#inviteDelivery': {
      email: 'Email a setup link',
      manual: 'Use a temporary password',
    },
  };

  const EXACT = new Map([
    ['Choose your password.', 'Choose your password.'],
    ['For security, choose a new password before opening your dashboard.', 'Before you continue, set a new password.'],
    ['This password link is invalid or has expired. Request a new link using Forgot password.', 'That password link expired or isn’t valid. Use “Forgot your password?” to get a new one.'],
    ['Invitation accepted. Choose a password to finish your account.', 'You’re in. Create a password to finish setting up your account.'],
    ['Choose a new password for your account.', 'Create a new password for your account.'],
    ['Signing in...', 'Signing in…'],
    ['Password saved. Loading your dashboard...', 'Password saved. Opening your dashboard…'],
    ['Enter your email first, then choose Forgot password.', 'Enter your email first, then choose “Forgot your password?”'],
    ['If an account exists for this email, a password reset link has been requested. Check your inbox and spam folder.', 'Your password reset link has been requested. Check your inbox and spam folder.'],
    ['Too many email requests. Please wait before trying again.', 'Too many email requests right now. Try again in a little while.'],
    ['The email service could not send a reset link. Ask your coach to check email delivery settings.', 'We couldn’t send the reset email. Ask your coach to check the email setup.'],
    ['Creating the first admin account...', 'Creating the admin account…'],
    ['Admin account created. Sign in with the email and password you just chose.', 'Admin account created. You can sign in now.'],
    ['Login is not configured yet.', 'Sign-in isn’t set up yet.'],
    ['Authentication failed.', 'We couldn’t sign you in.'],
    ['Your account is not connected to a team profile yet.', 'This account isn’t linked to the team yet.'],

    ['Import safety check', 'Quick import check'],
    ['Preview before publishing', 'Check this before it goes live'],
    ['Publish changes', 'Publish updates'],
    ['Review before publishing', 'Take a quick look'],
    ['No import warnings detected.', 'Everything looks good from this check.'],
    ['New entries', 'New players'],
    ['Removed / inactive', 'Removed or inactive'],
    ['Rank changes', 'Ranking changes'],
    ['Detected boards', 'Team sections found'],
    ['No new players or teams.', 'No new players or teams.'],
    ['Nobody removed.', 'No one is being removed.'],
    ['No existing rank changes.', 'No ranking changes.'],
    ['No boards detected.', 'No team sections found.'],
    ['Finish or cancel the current import before starting another one.', 'Finish or cancel this import before starting another.'],
    ['No spreadsheet rows are ready to publish.', 'There’s nothing ready to publish yet.'],
    ['No usable tennis players or teams were found. Check the sheet before publishing. The saved board was not changed.', 'No usable tennis players or teams were found in that sheet. Check the data and try again — nothing changed.'],
    ['Import cancelled. The live board was not changed.', 'Import cancelled. Nothing changed.'],
    ['Could not reload saved data. Reconnect and refresh the board.', 'We couldn’t reload the saved team data. Reconnect, then refresh.'],
    ['Preview this import before publishing it.', 'Preview the import before publishing it.'],
    ['Only an admin can change team data.', 'Only a coach/admin can update team data.'],
    ['Coach/admin access is required.', 'You need coach access for that.'],
    ['Live team data changed since this preview. Preview the latest board again before publishing.', 'The team data changed while you were reviewing this. Preview it again before publishing.'],
  ]);

  const STATUS_RULES = [
    [/^Database connected\s*[·•]\s*(\d+) rows published with rollback history$/i, 'Saved · $1 rows live · Undo available'],
    [/^Request failed \((\d+)\)\.$/i, 'That didn’t work ($1). Try again.'],
    [/^Import saved, but official ladder sync failed:\s*(.+)$/i, 'Import saved, but official ladder sync failed. The ladder didn’t finish updating: $1'],
    [/^No ranked tennis players or teams were detected\. Publishing this would empty the visible rankings\.$/i, 'We couldn’t find any ranked players or teams. Publishing this would clear the rankings.'],
    [/^(\d+) existing ranked entries would disappear\. Confirm the spreadsheet is complete before publishing\.$/i, '$1 current ranking entries would disappear. Make sure the sheet is complete before publishing.'],
    [/^(Boys|Girls) (Singles|Doubles) was not detected in this import\.$/i, 'We didn’t find $1 $2 in this import.'],
    [/^This file matches the latest saved import\. Publishing it will create a new history point but will not change the data\.$/i, 'This matches the latest saved version, so publishing won’t change the team data.'],
  ];

  const STATUS_SELECTORS = [
    '#authStatus', '#statusMessage', '#backendStatus', '#inviteStatus', '#analyzerNote', '#analyzerTitle',
    '.coach-empty', '.coach-more', '.coach-warning-box li', '.coach-safe-box span', '.status-message', '[role="status"]'
  ].join(',');

  function humanizeText(value) {
    const original = String(value == null ? '' : value);
    const trimmed = original.trim();
    if (!trimmed) return original;
    if (EXACT.has(trimmed)) return EXACT.get(trimmed);
    for (const [pattern, replacement] of STATUS_RULES) {
      if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement);
    }
    return original;
  }

  function setText(doc, selector, value) {
    const el = doc.querySelector(selector);
    if (!el) return;
    if (!el.children.length) {
      el.textContent = value;
      return;
    }
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 3) node.remove();
    }
    el.appendChild(doc.createTextNode(` ${value}`));
  }

  function applyStaticCopy(doc) {
    for (const [selector, value] of COPY) setText(doc, selector, value);
    for (const [selector, value] of HTML_COPY) {
      const el = doc.querySelector(selector);
      if (el) el.innerHTML = value;
    }
    for (const [selector, options] of Object.entries(SELECT_COPY)) {
      const select = doc.querySelector(selector);
      if (!select) continue;
      for (const option of select.options || []) {
        if (Object.prototype.hasOwnProperty.call(options, option.value)) option.textContent = options[option.value];
      }
    }
  }

  function humanizeElement(el) {
    if (!el || el.nodeType !== 1) return;
    const current = String(el.textContent || '').trim();
    if (!current) return;
    const next = humanizeText(current);
    if (next !== current) {
      if (!el.children.length) el.textContent = next;
      else {
        for (const node of [...el.childNodes]) if (node.nodeType === 3) node.remove();
        el.appendChild(el.ownerDocument.createTextNode(` ${next}`));
      }
    }
  }

  function humanizeStatusArea(doc, root) {
    if (!root) return;
    if (root.matches?.(STATUS_SELECTORS)) humanizeElement(root);
    root.querySelectorAll?.(STATUS_SELECTORS).forEach(humanizeElement);

    root.querySelectorAll?.('button span, h2, h3, .eyebrow, .coach-preview-summary span, .coach-preview-source span').forEach(el => {
      const current = String(el.textContent || '').trim();
      if (EXACT.has(current)) el.textContent = EXACT.get(current);
    });
  }

  function install(win) {
    const doc = win.document;
    if (win.__tennisrankHumanCopyInstalled) return;
    win.__tennisrankHumanCopyInstalled = true;

    const apply = () => {
      applyStaticCopy(doc);
      humanizeStatusArea(doc, doc.body);
    };

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', apply, { once: true });
    else apply();

    const observer = new win.MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
        if (target) humanizeStatusArea(doc, target);
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === 1) humanizeStatusArea(doc, node);
        }
      }
    });
    if (doc.documentElement) observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

    win.addEventListener('tennisrank:auth-ready', () => applyStaticCopy(doc));
  }

  return { COPY, HTML_COPY, SELECT_COPY, EXACT, STATUS_RULES, humanizeText, applyStaticCopy, install };
});
