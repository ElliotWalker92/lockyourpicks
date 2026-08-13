// ============================================================
//  WC2026 — Shared UI Utilities
// ============================================================

// ---- Toast notifications ----
const Toast = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  },

  show(message, type = 'info', duration = 3500) {
    this.init();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'slideInRight 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error', 5000); },
  info(msg)    { this.show(msg, 'info'); }
};

// ---- Navigation ----
const Nav = {
  async render(activePage = '') {
    const session = await DB.getSession();
    const navEl = document.getElementById('main-nav');
    if (!navEl) return;

    // Detect location: pages/ siblings use '' prefix, root uses 'pages/' prefix
    const inPages = window.location.pathname.replace(/\\/g, '/').includes('/pages/');
    const p = inPages ? '' : 'pages/';
    const homeHref = inPages ? '../index.html' : 'index.html';

    let profile = null;
    let adminLink = '';

    if (session) {
      profile = await DB.getProfile(session.user.id);
      if (profile?.is_admin) {
        adminLink = `<li><a href="${p}admin.html" ${activePage === 'admin' ? 'class="active"' : ''}><i class="ti ti-settings"></i> Admin</a></li>`;
      }
    }

    const initials = profile?.display_name
      ? profile.display_name.charAt(0).toUpperCase()
      : '?';
    const avatarColor = profile?.avatar_color || '#c8f135';

    navEl.innerHTML = `
      <a class="nav-brand" href="${homeHref}"><span class="lime">WC</span> 2026</a>

      <ul class="nav-links" id="navLinks">
        <li><a href="${homeHref}" ${activePage === 'home' ? 'class="active"' : ''}><i class="ti ti-home"></i> Home</a></li>
        ${session ? `
        <li><a href="${p}leaderboard.html" ${activePage === 'leaderboard' ? 'class="active"' : ''}><i class="ti ti-trophy"></i> Leaderboard</a></li>
        <li><a href="${p}predictions.html" ${activePage === 'predictions' ? 'class="active"' : ''}><i class="ti ti-pencil"></i> Predictions</a></li>
        <li><a href="${p}matches.html" ${activePage === 'matches' ? 'class="active"' : ''}><i class="ti ti-ball-football"></i> Matches</a></li>
        <li><a href="${p}standings.html" ${activePage === 'standings' ? 'class="active"' : ''}><i class="ti ti-table"></i> Standings</a></li>
        <li><a href="${p}my-predictions.html" ${activePage === 'mypreds' ? 'class="active"' : ''}><i class="ti ti-list-check"></i> My Picks</a></li>
        <li><a href="${p}leagues.html" ${activePage === 'leagues' ? 'class="active"' : ''}><i class="ti ti-users-group"></i> Leagues</a></li>
        <li><a href="${p}calculator.html" ${activePage === 'calculator' ? 'class="active"' : ''}><i class="ti ti-chart-treemap"></i> Calculator</a></li>
        ${adminLink}
        ` : ''}
      </ul>

      <button class="nav-hamburger" id="navToggle" aria-label="Menu"><i class="ti ti-menu-2"></i></button>

      <div class="nav-user">
        ${session ? `
          <a href="${p}profile.html" class="nav-avatar-link" title="Profile">${renderAvatar(profile, 'avatar', '', profile?.display_name || '')}</a>
          <span class="nav-username">${profile?.display_name || session.user.email}</span>
          <button class="btn btn-ghost btn-sm" id="signOutBtn">Sign out</button>
        ` : `
          <a href="${p}auth.html" class="btn btn-lime btn-sm">Sign In</a>
        `}
      </div>
    `;

    // Footer
    let footerEl = document.getElementById('main-footer');
    if (!footerEl) {
      footerEl = document.createElement('footer');
      footerEl.id = 'main-footer';
      footerEl.className = 'site-footer';
      document.body.appendChild(footerEl);
    }
    footerEl.innerHTML = `<a href="${p}privacy-policy.html">Privacy Policy</a>`;

    // Mobile toggle
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    if (toggle && links) {
      toggle.addEventListener('click', () => links.classList.toggle('open'));
    }

    // Sign out
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await DB.signOut();
        window.location.href = inPages ? 'auth.html' : 'pages/auth.html';
      });
    }
  }
};

// ---- Auth guard ----
async function requireAuth() {
  const session = await DB.getSession();
  if (!session) {
    window.location.href = 'auth.html';
    return null;
  }
  return session;
}

async function requireAuthFromPages() {
  const session = await DB.getSession();
  if (!session) {
    window.location.href = '/pages/auth.html';
    return null;
  }
  return session;
}

// ---- Avatar colors ----
const AVATAR_COLORS = [
  '#c8f135', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899',
  '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#f97316'
];

function getRandomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

// ---- Date/time formatters ----
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(timeStr) {
  // timeStr is UTC HH:MM
  const [h, m] = timeStr.split(':');
  const d = new Date();
  d.setUTCHours(parseInt(h), parseInt(m), 0, 0);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function formatCountdown(isoDate) {
  const diff = new Date(isoDate) - new Date();
  if (diff <= 0) return 'Locked';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---- Loading helpers ----
function showLoading(containerId, message = 'Loading...') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner"></div>
      <span>${message}</span>
    </div>
  `;
}

function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-error"><i class="ti ti-alert-triangle"></i> ${message}</div>`;
}

// ---- Score display helpers ----
function renderMatchScore(actual, prediction) {
  if (!actual || actual.home_score === null) {
    return prediction
      ? `<span class="text-muted">${prediction.home} – ${prediction.away}</span>`
      : '<span class="text-muted">– : –</span>';
  }

  const actH = actual.home_score, actA = actual.away_score;
  if (!prediction) return `<strong>${actH} – ${actA}</strong>`;

  const predH = parseInt(prediction.home), predA = parseInt(prediction.away);
  let cls = 'pred-wrong', label = '<i class="ti ti-x"></i> Wrong';
  if (predH === actH && predA === actA) { cls = 'pred-correct'; label = '<i class="ti ti-check"></i> Exact!'; }
  else if (Math.sign(predH - predA) === Math.sign(actH - actA)) { cls = 'pred-correct'; label = '<i class="ti ti-check"></i> Result'; }

  return `
    <div>
      <div class="match-score" style="font-size:1.2rem">${actH} – ${actA}</div>
      <div class="${cls}">${label} (${predH}–${predA})</div>
    </div>
  `;
}

// ---- Team select dropdown ----
function buildTeamSelect(id, value = '', placeholder = 'Select team...') {
  const opts = TEAMS_LIST
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `<option value="${t.code}" ${t.code === value ? 'selected' : ''}>${t.flag} ${t.name}</option>`)
    .join('');
  return `
    <select id="${id}" name="${id}" class="form-control">
      <option value="">${placeholder}</option>
      ${opts}
    </select>
  `;
}

// ---- Team flag image (flagcdn.com, renders on Windows) ----
function teamFlagImg(code) {
  const t = TEAMS_LIST.find(t => t.code === code);
  if (!t || !t.cc) return `<span class="flag-img" style="background:var(--grey-300)"></span>`;
  return `<img src="https://flagcdn.com/h20/${t.cc}.png" srcset="https://flagcdn.com/h40/${t.cc}.png 2x" alt="${t.name}" class="flag-img" loading="lazy">`;
}

// ---- Avatar renderer ----
// Renders a photo <img> if profile.avatar_url is set; otherwise a colour+initial <div>.
// cls: CSS class applied to both variants  style: extra inline CSS  title: tooltip/alt text
function isAiPlayer(profile) {
  return profile?.display_name === 'Claude';
}

function renderAvatar(profile, cls = 'avatar', style = '', title = '', extraCls = '') {
  const initial   = (profile?.display_name || '?').charAt(0).toUpperCase();
  const color     = profile?.avatar_color || '#c8f135';
  const titleAttr = title ? ` title="${title}"` : '';
  const styleBase = style ? `;${style}` : '';
  const aiCls     = isAiPlayer(profile) ? ' ai-avatar' : '';
  const xCls      = extraCls ? ` ${extraCls}` : '';
  if (profile?.avatar_url) {
    return `<img src="${profile.avatar_url}" class="${cls}${aiCls}${xCls}"${titleAttr} alt="${title}" style="object-fit:cover;flex-shrink:0${styleBase}">`;
  }
  return `<div class="${cls}${aiCls}${xCls}"${titleAttr} style="background:${color};color:#0d0d0d;flex-shrink:0${styleBase}">${initial}</div>`;
}

// ---- Points badge ----
function ptsBadge(pts) {
  if (!pts && pts !== 0) return '<span class="text-muted">—</span>';
  return `<span class="points-badge">${pts}</span>`;
}

// ---- Round bracket readiness (shared by home page and predictions page) ----
const ROUND_TO_KO = {
  round4: 'round32', round5: 'round16',
  round6: 'quarterfinals', round7: 'semifinals', round8: 'final',
};

function bracketReady(id) {
  const key = ROUND_TO_KO[id];
  if (!key) return true; // rounds 1-3 have no KO bracket — always ready
  const ms = KNOCKOUT_ROUNDS[key]?.matches || [];
  if (ms.length === 0) return false;
  // R32 seeds all at once (group stage completes) — require every slot filled.
  // R16 onwards seeds per-match as each feeder finishes — open as soon as one match has both teams.
  if (id === 'round4') return ms.every(m => m.home_team && m.away_team);
  return ms.some(m => m.home_team && m.away_team);
}

window.Toast = Toast;
window.Nav = Nav;
window.requireAuth = requireAuth;
window.requireAuthFromPages = requireAuthFromPages;
window.getRandomAvatarColor = getRandomAvatarColor;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.formatCountdown = formatCountdown;
window.showLoading = showLoading;
window.showError = showError;
window.renderMatchScore = renderMatchScore;
window.buildTeamSelect = buildTeamSelect;
window.teamFlagImg = teamFlagImg;
window.ptsBadge = ptsBadge;
window.isAiPlayer = isAiPlayer;
window.renderAvatar = renderAvatar;
window.ROUND_TO_KO = ROUND_TO_KO;
window.bracketReady = bracketReady;
window.AVATAR_COLORS = AVATAR_COLORS;
