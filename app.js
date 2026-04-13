'use strict';

// ── CASHBACK DATA ────────────────────────────────────────────────────────────
const CASHBACK_DATA = [
  { name: 'iGraal',      logo: '🎁', store: 'AliExpress', pct: 4.5, url: 'https://es.igraal.com/codes-promo/AliExpress' },
  { name: 'iGraal',      logo: '🎁', store: 'Miravia',    pct: 3.0, url: 'https://es.igraal.com' },
  { name: 'TopCashback', logo: '💎', store: 'AliExpress', pct: 3.8, url: 'https://www.topcashback.es' },
  { name: 'TopCashback', logo: '💎', store: 'Amazon',     pct: 1.5, url: 'https://www.topcashback.es' },
  { name: 'Rakuten',     logo: '🔴', store: 'AliExpress', pct: 2.5, url: 'https://www.rakuten.es' },
  { name: 'Rakuten',     logo: '🔴', store: 'eBay',       pct: 1.0, url: 'https://www.rakuten.es' },
  { name: 'BeRuby',      logo: '🟢', store: 'AliExpress', pct: 2.2, url: 'https://www.beruby.com' },
  { name: 'Cashrewards', logo: '💰', store: 'AliExpress', pct: 5.0, url: 'https://www.cashrewards.com.au' },
];

// ── STATE ────────────────────────────────────────────────────────────────────
let currentTab    = 'search';
let searchResults = [];
let chollosData   = [];
let chollosLoaded = false;
let alerts = JSON.parse(localStorage.getItem('ph_alerts') || '[]');

// ── DOM ──────────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('searchInput');
const searchBtn   = document.getElementById('searchBtn');
const tabBtns     = document.querySelectorAll('.tab-btn');
const bnavBtns    = document.querySelectorAll('.bnav-item');
const toastEl     = document.getElementById('toast');

// ── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2800);
}

// ── NAVIGATION ───────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  bnavBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('hidden', p.id !== 'panel-' + tab)
  );
  if (tab === 'chollos' && !chollosLoaded) loadChollos();
  if (tab === 'cashback') renderCashback();
  if (tab === 'alerts')   renderAlerts();
}

tabBtns.forEach(b  => b.addEventListener('click', () => switchTab(b.dataset.tab)));
bnavBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ── SEARCH ───────────────────────────────────────────────────────────────────
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  switchTab('search');
  renderLoading('panel-search', `Buscando "${q}" en todas las tiendas...`);
  searchBtn.classList.add('loading');

  try {
    // Llamamos a las Netlify Functions en paralelo
    const [aliRes, mirRes] = await Promise.allSettled([
      callFunction('search-aliexpress', { q }),
      callFunction('search-miravia',    { q })
    ]);

    const aliItems = aliRes.status === 'fulfilled' ? (aliRes.value?.results || []) : [];
    const mirItems = mirRes.status === 'fulfilled' ? (mirRes.value?.results || []) : [];

    const all = [...aliItems, ...mirItems];
    searchResults = mergeAndSort(all);
    renderSearchResults(q);

    // Info sobre fuentes
    const sources = [];
    if (aliItems.length) sources.push(`AliExpress (${aliItems.filter(i=>!i.isSearchLink).length} productos)`);
    if (mirItems.length) sources.push(`Miravia (${mirItems.filter(i=>!i.isSearchLink).length} productos)`);
    if (sources.length)  showToast('✅ ' + sources.join(' · '));

  } catch (e) {
    renderError('panel-search', 'Error al buscar. Comprueba tu conexión.');
  } finally {
    searchBtn.classList.remove('loading');
  }
}

// Llama a una Netlify Function por nombre
async function callFunction(name, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/.netlify/functions/${name}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Function ${name} returned ${res.status}`);
  return res.json();
}

// ── MERGE & SORT ─────────────────────────────────────────────────────────────
function mergeAndSort(items) {
  const groups = {};
  items.forEach(item => {
    if (item.isSearchLink) return; // skip placeholder links
    const key = normalizeTitle(item.title);
    if (!groups[key]) {
      groups[key] = {
        ...item,
        stores: [{ store: item.store, price: item.price, url: item.url }]
      };
    } else {
      groups[key].stores.push({ store: item.store, price: item.price, url: item.url });
      if (item.price < groups[key].price) {
        groups[key].price = item.price;
        groups[key].url   = item.url;
        if (item.image)  groups[key].image = item.image;
      }
    }
  });

  // Also add search-link items if no real results for that store
  const hasAli = items.some(i => i.store === 'AliExpress' && !i.isSearchLink);
  const hasMir = items.some(i => i.store === 'Miravia'    && !i.isSearchLink);
  if (!hasAli) { const l = items.find(i => i.store === 'AliExpress' && i.isSearchLink); if (l) groups['ali-link'] = { ...l, stores: [] }; }
  if (!hasMir) { const l = items.find(i => i.store === 'Miravia'    && i.isSearchLink); if (l) groups['mir-link'] = { ...l, stores: [] }; }

  return Object.values(groups).sort((a, b) => {
    if (a.isSearchLink) return 1;
    if (b.isSearchLink) return -1;
    return a.price - b.price;
  });
}

function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 35);
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderLoading(id, msg = 'Cargando...') {
  document.getElementById(id).innerHTML =
    `<div class="loading-wrap"><div class="spinner"></div><span>${msg}</span></div>`;
}

function renderError(id, msg) {
  document.getElementById(id).innerHTML =
    `<div class="empty-state"><div class="empty-icon">⚠️</div>
     <div class="empty-title">Algo salió mal</div>
     <div class="empty-sub">${msg}</div></div>`;
}

function renderSearchResults(query) {
  const panel = document.getElementById('panel-search');

  const real = searchResults.filter(i => !i.isSearchLink);
  const links = searchResults.filter(i => i.isSearchLink);
  const maxCB = Math.max(...CASHBACK_DATA.map(c => c.pct));

  if (!real.length && !links.length) {
    panel.innerHTML =
      `<div class="empty-state"><div class="empty-icon">🔍</div>
       <div class="empty-title">Sin resultados</div>
       <div class="empty-sub">No se encontraron productos para "<strong>${query}</strong>".</div></div>`;
    return;
  }

  let html = `<div class="alert-bar">💰 Activa cashback antes de comprar · hasta ${maxCB}% de vuelta</div>`;

  if (real.length) {
    html += `<div class="section-title">${real.length} productos encontrados · ${query}</div>`;
    real.forEach((item, i) => {
      const disc = item.originalPrice > item.price
        ? Math.round((1 - item.price / item.originalPrice) * 100) : null;
      const storeCBs = CASHBACK_DATA.filter(c => (item.stores||[{store:item.store}]).some(s => s.store === c.store));
      const bestCB   = storeCBs.length ? Math.max(...storeCBs.map(c => c.pct)) : null;

      const chips = (item.stores || [{ store: item.store, price: item.price, url: item.url }])
        .sort((a, b) => a.price - b.price)
        .map((s, si) =>
          `<span class="store-chip ${si === 0 ? 'best' : ''}" onclick="openLink('${s.url}')">
             ${si === 0 ? '✓ ' : ''}${s.store} ${s.price > 0 ? formatPrice(s.price) : ''}
           </span>`
        ).join('');

      html += `
        <div class="card">
          <div class="product-card">
            <div class="product-thumb">
              ${item.image
                ? `<img src="${item.image}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='📦'">`
                : '📦'}
            </div>
            <div class="product-body">
              <div class="product-title">${item.title}</div>
              <div class="price-row">
                <span class="price-main">${formatPrice(item.price)}</span>
                ${item.originalPrice > item.price ? `<span class="price-original">${formatPrice(item.originalPrice)}</span>` : ''}
                ${disc   ? `<span class="badge badge-discount">-${disc}%</span>` : ''}
                ${bestCB ? `<span class="badge badge-cashback">+${bestCB}% CB</span>` : ''}
                ${i === 0 ? `<span class="badge badge-best">🏆 Más barato</span>` : ''}
              </div>
              <div class="stores-row">${chips}</div>
              ${item.reviews ? `<div style="font-size:10px;color:var(--text3);margin-top:4px">⭐ ${item.rating || '?'} · ${item.reviews} opiniones</div>` : ''}
            </div>
          </div>
        </div>`;
    });
  }

  // Show search-link cards for stores with no direct results
  if (links.length) {
    html += `<div class="section-title" style="margin-top:4px">Buscar directamente en</div>`;
    links.forEach(item => {
      html += `
        <div class="card" style="cursor:pointer" onclick="openLink('${item.url}')">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:500;font-size:13px;color:var(--text)">${item.store}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">Ver resultados en ${item.store} →</div>
            </div>
            <span style="font-size:20px">${item.store === 'AliExpress' ? '🛒' : '🛍️'}</span>
          </div>
        </div>`;
    });
  }

  html += `<div class="fetch-status">Datos obtenidos via servidor · ${new Date().toLocaleTimeString('es-ES')}</div>`;
  panel.innerHTML = html;
}

// ── CASHBACK ─────────────────────────────────────────────────────────────────
function renderCashback() {
  const panel = document.getElementById('panel-cashback');
  let html = `
    <div class="alert-bar">💡 Activa el cashback ANTES de entrar a la tienda para que se registre</div>
    <div class="section-title">Mejores cashbacks ahora</div>
    <div class="card">`;

  CASHBACK_DATA.sort((a, b) => b.pct - a.pct).forEach(c => {
    html += `
      <div class="cashback-item">
        <div class="cb-left">
          <div class="cb-logo">${c.logo}</div>
          <div>
            <div class="cb-name">${c.name}</div>
            <div class="cb-store">${c.store}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="cb-pct">${c.pct}%</div>
          <a class="cb-link" href="${c.url}" target="_blank" rel="noopener">Activar →</a>
        </div>
      </div>`;
  });

  html += `</div>
    <div class="section-title" style="margin-top:8px">Cómo funciona</div>
    <div class="card" style="font-size:12px;color:var(--text2);line-height:1.9">
      <div>1. Pulsa <strong style="color:var(--text)">Activar</strong> en la plataforma que prefieras</div>
      <div>2. Te redirige a la tienda (AliExpress, etc.)</div>
      <div>3. Compra con normalidad — el cashback se registra solo</div>
      <div>4. El reembolso llega en 30–90 días a tu cuenta</div>
    </div>
    <div class="card" style="margin-top:8px;font-size:12px;color:var(--text2)">
      💡 <strong style="color:var(--text)">Truco:</strong> combina el mejor precio de AliExpress con iGraal (4.5%) para el máximo ahorro total.
    </div>`;

  panel.innerHTML = html;
}

// ── CHOLLOS ───────────────────────────────────────────────────────────────────
async function loadChollos() {
  renderLoading('panel-chollos', 'Cargando chollos calientes...');
  chollosLoaded = true;

  try {
    const data = await callFunction('chollos');
    chollosData = data.chollos || [];
    if (!chollosData.length) throw new Error('empty');
    renderChollos();
  } catch (e) {
    chollosData = demoCholllos();
    renderChollos();
    showToast('Mostrando datos de ejemplo');
  }
}

function renderChollos() {
  const panel  = document.getElementById('panel-chollos');
  const hot    = chollosData.filter(c => c.votes >= 200);

  let html = '';
  if (hot.length) html += `<div class="alert-bar">🔥 ${hot.length} chollos con +200° ahora mismo</div>`;
  html += `<div class="section-title">Más votados · Tiempo real</div>`;

  chollosData.slice(0, 25).forEach(c => {
    const disc = c.price && c.prevPrice ? Math.round((1 - c.price / c.prevPrice) * 100) : null;
    html += `
      <div class="card chollo-card">
        ${c.votes >= 300 ? `<div class="chollo-hot">🔥 HOT</div>` : ''}
        ${c.image ? `<img src="${c.image}" style="width:100%;height:80px;object-fit:cover;border-radius:8px;margin-bottom:8px" loading="lazy" onerror="this.remove()">` : ''}
        <div class="chollo-title">${c.title}</div>
        <div class="chollo-meta">
          ${c.price ? `<span class="chollo-price">${formatPrice(c.price)}</span>` : ''}
          ${c.prevPrice ? `<span class="chollo-prev">${formatPrice(c.prevPrice)}</span>` : ''}
          ${disc ? `<span class="badge badge-discount">-${disc}%</span>` : ''}
          <div class="votes-wrap">
            <span class="vote-icon">🌡️</span>
            <span class="vote-count">${c.votes}°</span>
          </div>
        </div>
        <div class="chollo-time">
          <span>🕐 ${c.timeAgo}</span>
          <span style="color:var(--border2)">·</span>
          <span>${c.category}</span>
          <a href="${c.link}" target="_blank" rel="noopener" style="margin-left:auto;color:var(--accent);font-size:11px">Ver chollo →</a>
        </div>
      </div>`;
  });

  html += `
    <button onclick="reloadChollos()" style="width:100%;padding:11px;background:var(--card2);border:1px solid var(--border2);color:var(--text2);border-radius:var(--radius);font-size:13px;cursor:pointer;margin-top:4px">
      🔄 Actualizar chollos
    </button>
    <div class="fetch-status">Datos de chollometro.com</div>`;

  panel.innerHTML = html;
}

async function reloadChollos() {
  chollosLoaded = false;
  await loadChollos();
}

// ── ALERTS ────────────────────────────────────────────────────────────────────
function renderAlerts() {
  const panel = document.getElementById('panel-alerts');
  let html = `<div class="section-title">Mis alertas de precio</div>`;

  if (!alerts.length) {
    html += `<div class="empty-state">
      <div class="empty-icon">🔔</div>
      <div class="empty-title">Sin alertas</div>
      <div class="empty-sub">Guarda productos para saber cuándo bajan de precio.</div>
    </div>`;
  } else {
    html += `<div class="card">`;
    alerts.forEach((a, i) => {
      html += `
        <div class="alert-item">
          <div class="alert-dot ${a.active ? '' : 'inactive'}"></div>
          <div class="alert-info">
            <div class="alert-name">${a.product}</div>
            <div class="alert-status">Objetivo: ${a.targetPrice ? formatPrice(a.targetPrice) : 'cualquier bajada'}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="alert-toggle ${a.active ? 'on' : ''}" onclick="toggleAlert(${i})"></div>
            <span onclick="deleteAlert(${i})" style="cursor:pointer;color:var(--text3);font-size:16px">🗑</span>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  html += `<button class="add-alert-btn" onclick="addAlertPrompt()">+ Nueva alerta de precio</button>`;

  // Chollos top 3 como sugerencias
  const top3 = (chollosData.length ? chollosData : demoCholllos()).slice(0, 3);
  if (top3.length) {
    html += `<div class="section-title" style="margin-top:12px">🔥 Chollos del momento</div><div class="card">`;
    top3.forEach(c => {
      html += `<div class="alert-item">
        <span style="font-size:16px">🔥</span>
        <div class="alert-info">
          <div class="alert-name" style="font-size:12px">${c.title.substring(0,55)}${c.title.length>55?'…':''}</div>
          <div class="alert-status">${c.votes}° · ${c.timeAgo}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  panel.innerHTML = html;
}

function toggleAlert(i) {
  alerts[i].active = !alerts[i].active;
  saveAlerts(); renderAlerts();
}

function deleteAlert(i) {
  alerts.splice(i, 1);
  saveAlerts(); renderAlerts();
  showToast('Alerta eliminada');
}

function addAlertPrompt() {
  const product = searchInput.value.trim() || prompt('¿Qué producto quieres vigilar?');
  if (!product) return;
  const priceStr = prompt(`Precio objetivo para "${product}" (deja vacío para cualquier bajada):`);
  const targetPrice = priceStr ? parseFloat(priceStr.replace(',', '.')) : null;
  alerts.unshift({ product, targetPrice, active: true, created: Date.now() });
  saveAlerts(); renderAlerts();
  showToast(`✅ Alerta creada para "${product}"`);
}

function saveAlerts() {
  localStorage.setItem('ph_alerts', JSON.stringify(alerts));
}

// ── DEMO DATA ─────────────────────────────────────────────────────────────────
function demoCholllos() {
  return [
    { title: 'Xiaomi Redmi Note 13 Pro 256GB por 199€', link: 'https://www.chollometro.com', price: 199, prevPrice: 329, votes: 847, timeAgo: 'hace 12 min', category: 'Móviles', image: null },
    { title: 'AirPods Pro 2 — precio mínimo histórico', link: 'https://www.chollometro.com', price: 189, prevPrice: 279, votes: 623, timeAgo: 'hace 34 min', category: 'Audio', image: null },
    { title: 'Dyson V15 Detect aspirador inalámbrico', link: 'https://www.chollometro.com', price: 399, prevPrice: 649, votes: 512, timeAgo: 'hace 1h', category: 'Hogar', image: null },
    { title: 'SSD Samsung 990 Pro 2TB NVMe M.2', link: 'https://www.chollometro.com', price: 89, prevPrice: 149, votes: 401, timeAgo: 'hace 2h', category: 'PC', image: null },
    { title: 'Nintendo Switch OLED bundle Mario Kart', link: 'https://www.chollometro.com', price: 299, prevPrice: 349, votes: 387, timeAgo: 'hace 3h', category: 'Gaming', image: null },
  ];
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function formatPrice(n) {
  if (!n && n !== 0) return '';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);
}

function openLink(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ── INIT ──────────────────────────────────────────────────────────────────────
switchTab('search');
