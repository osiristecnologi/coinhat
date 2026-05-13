// ═══════════════════════════════════════════════
//  COINHAT DEX — Secure Frontend
//  Zero hardcoded API URLs, referrals, or secrets.
//  All data fetched from backend /api/* proxy.
// ═══════════════════════════════════════════════
const $ = id => document.getElementById(id);

// ── FORMAT ──
const fmt = {
  price(n) {
    if (!n && n !== 0) return '\u2014';
    n = parseFloat(n);
    if (n < 0.000001) return '$' + n.toExponential(2);
    if (n < 0.01) return '$' + n.toFixed(6);
    if (n < 1) return '$' + n.toFixed(4);
    if (n < 1000) return '$' + n.toFixed(3);
    return '$' + n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  },
  large(n) {
    if (!n) return '\u2014';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + parseFloat(n).toFixed(2);
  },
  pct(n) {
    if (n === undefined || n === null) return '\u2014';
    const v = parseFloat(n);
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  },
  addr(a) { return a ? a.slice(0, 6) + '\u2026' + a.slice(-5) : '\u2014'; }
};

// ── TOAST ──
function toast(msg, type = 'info') {
  const c = $('toasts'), t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── SAFE FETCH (all requests go to our backend) ──
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ── SPARKLINE ──
function sparkline(up, w = 120, h = 36) {
  const pts = [];
  let y = h / 2;
  for (let i = 0; i < 12; i++) {
    y += ((Math.random() - .44) * (up ? 1.2 : 1)) * 5;
    y = Math.max(4, Math.min(h - 4, y));
    pts.push({ x: i * (w / 11), y });
  }
  const line = 'M' + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');
  return { line, area: line + ` L ${w},${h} L 0,${h} Z` };
}

// ── SECTION ROUTER ──
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  $('sec-' + id)?.classList.add('active');
  document.querySelectorAll('.nav-item[data-sec]').forEach(n => {
    n.classList.toggle('active', n.dataset.sec === id);
  });
  document.querySelectorAll('.d-item[data-sec]').forEach(n => {
    n.classList.toggle('active', n.dataset.sec === id);
  });
  if (id === 'news') loadNews();
  if (id === 'airdrops') loadAirdrops();
  if (id === 'alpha') loadAlpha();
  if (id === 'partners') loadPartners();
}

// ── DRAWER ──
const drawerOverlay = $('drawer-overlay');
function openDrawer() { drawerOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeDrawer() { drawerOverlay.classList.remove('open'); document.body.style.overflow = ''; }
$('menu-btn').addEventListener('click', openDrawer);
$('drawer-close').addEventListener('click', closeDrawer);
$('drawer-bg').addEventListener('click', closeDrawer);
document.querySelectorAll('.d-item[data-sec]').forEach(el => {
  el.addEventListener('click', () => { showSection(el.dataset.sec); closeDrawer(); });
});

// ── BOTTOM NAV ──
document.querySelectorAll('.nav-item[data-sec]').forEach(el => {
  el.addEventListener('click', () => showSection(el.dataset.sec));
});
$('nav-swap-btn').addEventListener('click', openSwap);

// ── SEARCH (proxied through backend) ──
const searchWrap = $('search-wrap'), searchField = $('search-field'), searchDrop = $('search-drop');
let searchTimer, searchCache = {};

$('search-toggle').addEventListener('click', () => {
  if (searchWrap.classList.toggle('open')) searchField.focus();
  else { searchField.value = ''; searchDrop.classList.remove('vis'); }
});

searchField.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchField.value.trim();
  if (q.length < 2) { searchDrop.classList.remove('vis'); return; }
  searchTimer = setTimeout(() => doSearch(q), 380);
});

document.addEventListener('click', e => {
  if (!searchWrap.contains(e.target)) { searchDrop.classList.remove('vis'); searchWrap.classList.remove('open'); }
});

async function doSearch(q) {
  if (searchCache[q]) { renderSearch(searchCache[q]); return; }
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    searchCache[q] = data.pairs || [];
    renderSearch(searchCache[q]);
  } catch (e) { /* silent */ }
}

function renderSearch(pairs) {
  const COLORS = ['#f7c600', '#1a6bff', '#16c784', '#ea3943', '#9945ff', '#ff6b2b', '#00d4ff'];
  if (!pairs.length) {
    searchDrop.innerHTML = '<div class="s-item" style="color:var(--t3);justify-content:center;padding:18px">Nenhum resultado</div>';
    searchDrop.classList.add('vis');
    return;
  }
  searchDrop.innerHTML = pairs.map((p, i) => {
    const col = COLORS[i % COLORS.length];
    const init = (p.symbol || '?').slice(0, 2).toUpperCase();
    const hasImg = p.imageUrl;
    return `<div class="s-item" data-idx="${i}">
      ${hasImg ? `<img src="${p.imageUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="s-fallback" style="background:${col};${hasImg ? 'display:none' : 'display:flex'}">${init}</div>
      <div><div class="s-name">${p.name}</div><div class="s-sym">${p.symbol}</div></div>
      <span class="s-price">${fmt.price(p.priceUsd)}</span>
    </div>`;
  }).join('');
  searchDrop.classList.add('vis');
  searchDrop.querySelectorAll('.s-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      openModal(pairs[i]);
      searchDrop.classList.remove('vis');
      searchWrap.classList.remove('open');
      searchField.value = '';
    });
  });
}

// ── COINS ──
const LOGO_COLORS = ['#9945ff', '#f7c600', '#1a6bff', '#16c784', '#ea3943', '#ff6b2b', '#00d4ff', '#ff2e7e', '#00c896', '#ffb800', '#3b82f6', '#10b981'];
let allCoins = [], filteredCoins = [];

async function loadCoins() {
  const grid = $('coin-grid');
  grid.innerHTML = Array(18).fill('<div class="skel"></div>').join('');
  try {
    const data = await api('/api/coins');
    allCoins = data.coins || [];
    filteredCoins = [...allCoins];
    renderCoins(filteredCoins);
    buildTicker(allCoins);
  } catch (e) {
    toast('Erro ao carregar coins', 'error');
    grid.innerHTML = '';
  }
}

function renderCoins(coins) {
  const grid = $('coin-grid');
  grid.innerHTML = '';
  coins.slice(0, 18).forEach((p, i) => {
    const price = parseFloat(p.priceUsd || 0);
    const chg = parseFloat(p.change24h || 0);
    const up = chg >= 0;
    const col = LOGO_COLORS[i % LOGO_COLORS.length];
    const hasImg = p.imageUrl;
    const spark = sparkline(up);
    const card = document.createElement('div');
    card.className = 'coin-card';
    card.style.animation = `fadeUp .38s ease ${i * 28}ms both`;
    card.innerHTML = `
      <div class="card-top">
        <div class="card-logo-wrap">
          ${hasImg
        ? `<img class="card-logo" src="${p.imageUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
          <div class="card-logo-fb" style="background:${col};display:${hasImg ? 'none' : 'flex'}">${(p.symbol || '?').slice(0, 2).toUpperCase()}</div>
          <div class="card-live-dot"></div>
        </div>
        <div class="card-chg-badge ${up ? 'up' : 'dn'}">${up ? '\u25B2' : '\u25BC'}${Math.abs(chg).toFixed(1)}%</div>
      </div>
      <div class="card-body">
        <div class="c-name">${p.name}</div>
        <div class="c-sym">${p.symbol}</div>
        <div class="c-price">${fmt.price(price)}</div>
        <div class="card-stats">
          <div class="cs-item"><div class="cs-lbl">Mkt Cap</div><div class="cs-val">${fmt.large(p.marketCap)}</div></div>
          <div class="cs-item"><div class="cs-lbl">Vol 24h</div><div class="cs-val">${fmt.large(p.volume24h)}</div></div>
        </div>
      </div>
      <div class="card-spark">
        <svg viewBox="0 0 120 36" preserveAspectRatio="none" style="width:100%;height:38px;display:block">
          <defs><linearGradient id="sg${i}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${up ? '#00c896' : '#ff4560'}" stop-opacity=".25"/>
            <stop offset="100%" stop-color="${up ? '#00c896' : '#ff4560'}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${spark.area}" fill="url(#sg${i})"/>
          <path d="${spark.line}" fill="none" stroke="${up ? '#00c896' : '#ff4560'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>`;
    card.addEventListener('click', () => openModal(p));
    grid.appendChild(card);
  });
}

// Filter tabs
document.querySelectorAll('.ftab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const f = tab.dataset.filter;
    let coins = [...allCoins];
    if (f === 'gainers') coins.sort((a, b) => parseFloat(b.change24h || 0) - parseFloat(a.change24h || 0));
    else if (f === 'losers') coins.sort((a, b) => parseFloat(a.change24h || 0) - parseFloat(b.change24h || 0));
    else if (f === 'volume') coins.sort((a, b) => parseFloat(b.volume24h || 0) - parseFloat(a.volume24h || 0));
    else if (f === 'new') coins.reverse();
    filteredCoins = coins;
    renderCoins(coins);
  });
});

$('refresh-btn').addEventListener('click', () => {
  loadCoins();
  toast('Atualizando precos...', 'info');
});

// ── TICKER (proxied through backend) ──
async function buildTicker(coins) {
  let tickers = [];
  try {
    const data = await api('/api/ticker');
    tickers = data.tickers || [];
  } catch (e) { /* fallback empty */ }

  const items = [
    ...tickers,
    ...(coins || []).slice(0, 12).map(p => ({
      symbol: p.symbol || '?',
      price: parseFloat(p.priceUsd || 0),
      change: parseFloat(p.change24h || 0)
    }))
  ];

  const html = items.map(t => `
    <span class="t-item">
      <span class="t-sym">${t.symbol}</span>
      <span class="t-p">${fmt.price(t.price)}</span>
      <span class="t-c ${t.change >= 0 ? 'up' : 'dn'}">${t.change >= 0 ? '+' : ''}${(t.change || 0).toFixed(2)}%</span>
    </span>`).join('');
  $('ticker-track').innerHTML = html + html;
}

// ── TOKEN MODAL ──
let currentCoin = null;

function openModal(coin) {
  currentCoin = coin;
  const hasImg = coin.imageUrl;
  const logo = $('m-logo'), fb = $('m-logo-fb');
  if (hasImg) {
    logo.src = coin.imageUrl;
    logo.style.display = 'block';
    fb.style.display = 'none';
    logo.onerror = () => { logo.style.display = 'none'; fb.style.display = 'flex'; };
  } else {
    logo.style.display = 'none';
    fb.style.display = 'flex';
    fb.style.background = LOGO_COLORS[Math.floor(Math.random() * LOGO_COLORS.length)];
    fb.textContent = (coin.symbol || '?').slice(0, 2).toUpperCase();
  }

  $('m-name').textContent = coin.name || '\u2014';
  $('m-sym').textContent = coin.symbol || '';
  $('m-price').textContent = fmt.price(coin.priceUsd);

  const chg = parseFloat(coin.change24h || 0);
  const mchg = $('m-chg');
  mchg.textContent = fmt.pct(chg);
  mchg.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';

  $('m-mcap').textContent = fmt.large(coin.marketCap);
  $('m-vol').textContent = fmt.large(coin.volume24h);
  $('m-liq').textContent = fmt.large(coin.liquidity);

  const addr = coin.address || '';
  $('m-contract').textContent = addr ? fmt.addr(addr) : '\u2014';
  $('m-contract').title = addr;

  // Chart URL from backend
  if (coin.pairAddress) {
    api(`/api/chart-url/${coin.pairAddress}`)
      .then(d => { $('m-chart').src = d.url; })
      .catch(() => { });
  }

  // Links
  const links = [];
  if (coin.websites && coin.websites[0]) links.push({ icon: '\uD83C\uDF10', label: 'Site', url: coin.websites[0] });
  (coin.socials || []).forEach(s => {
    if (s.type === 'twitter') links.push({ icon: 'X', label: 'Twitter', url: s.url });
    if (s.type === 'telegram') links.push({ icon: 'T', label: 'Telegram', url: s.url });
  });
  $('m-links').innerHTML = links.map(l =>
    `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="link-chip">${l.icon} ${l.label}</a>`
  ).join('');

  $('token-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('token-modal').classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { $('m-chart').src = ''; }, 400);
}

$('modal-close').addEventListener('click', closeModal);
$('modal-bg').addEventListener('click', closeModal);
$('modal-swap-btn').addEventListener('click', () => { closeModal(); openSwap(); });

$('copy-btn').addEventListener('click', () => {
  const addr = currentCoin?.address || '';
  if (!addr) return;
  navigator.clipboard?.writeText(addr)
    .then(() => toast('Endereco copiado!', 'success'))
    .catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = addr; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        toast('Copiado!', 'success');
      } catch (e) { }
    });
});

// ── SWAP (URL generated server-side with referral) ──
async function openSwap() {
  try {
    const output = currentCoin?.address || '';
    const params = output ? `?output=${output}` : '';
    const data = await api(`/api/swap-url${params}`);
    $('jupiter-iframe').src = data.url;
  } catch (e) {
    toast('Erro ao abrir swap', 'error');
  }
  $('swap-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSwap() {
  $('swap-modal').classList.remove('open');
  document.body.style.overflow = '';
}

$('swap-close').addEventListener('click', closeSwap);
$('swap-bg').addEventListener('click', closeSwap);

// ── NEWS (from backend JSON) ──
let newsLoaded = false;
async function loadNews() {
  if (newsLoaded) return;
  newsLoaded = true;
  try {
    const data = await api('/api/noticias');
    const items = data.items || [];
    $('news-grid').innerHTML = items.map((n, i) => `
      <div class="news-card" style="animation:fadeUp .38s ease ${i * 55}ms both" onclick="window.open('${n.url}','_blank')">
        <div class="news-thumb">${n.emoji}</div>
        <div class="news-content">
          <div class="news-src">${n.src}</div>
          <div class="news-ttl">${n.title}</div>
          <div class="news-foot">
            <span>${n.time}</span>
            <span class="news-read">Ler <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
          </div>
        </div>
      </div>`).join('');
  } catch (e) { toast('Erro ao carregar noticias', 'error'); }
}

// ── AIRDROPS (from backend JSON, referral injected server-side) ──
let airLoaded = false;
async function loadAirdrops() {
  if (airLoaded) return;
  airLoaded = true;
  try {
    const data = await api('/api/airdrops');
    const items = data.items || [];
    $('airdrops-content').innerHTML = items.map((a, i) => `
      <div class="content-card" style="animation:fadeUp .38s ease ${i * 60}ms both" onclick="window.open('${a.url}','_blank')">
        <div class="cc-icon-wrap">${a.icon}</div>
        <div class="cc-title">${a.title}</div>
        <div class="cc-desc">${a.desc}</div>
        <span class="cc-cta">${a.btn} \u2192</span>
      </div>`).join('');
  } catch (e) { toast('Erro ao carregar airdrops', 'error'); }
}

// ── ALPHA (from backend JSON) ──
let alphaLoaded = false;
async function loadAlpha() {
  if (alphaLoaded) return;
  alphaLoaded = true;
  try {
    const data = await api('/api/alphas');
    const items = data.items || [];
    $('alpha-content').innerHTML = items.map((a, i) => `
      <div class="alpha-item" style="animation:fadeUp .38s ease ${i * 55}ms both">
        <div class="alpha-tag">${a.tag}</div>
        <div class="alpha-text">${a.text}</div>
        <div class="alpha-time">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${a.time}
        </div>
      </div>`).join('');
  } catch (e) { toast('Erro ao carregar alpha', 'error'); }
}

// ── PARTNERS (from backend JSON, referral injected server-side) ──
let partLoaded = false;
async function loadPartners() {
  if (partLoaded) return;
  partLoaded = true;
  try {
    const data = await api('/api/parceiros');
    const items = data.items || [];
    $('partners-grid').innerHTML = items.map((p, i) => `
      <div class="partner-card" style="animation:fadeUp .38s ease ${i * 55}ms both" onclick="window.open('${p.url}','_blank')">
        <div class="pc-icon-wrap">${p.icon}</div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-desc">${p.desc}</div>
        <span class="pc-tag">${p.tag}</span>
      </div>`).join('');
  } catch (e) { toast('Erro ao carregar parceiros', 'error'); }
}

// ── KEYBOARD ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeSwap(); closeDrawer(); }
});

// ── AUTO REFRESH ──
setInterval(() => { loadCoins(); }, 60000);

// ── INIT ──
loadCoins();

