// cashback.js — Netlify Function
// Scrapes real cashback rates daily from iGraal, TopCashback, Rakuten, BeRuby
// Results are cached for 6 hours via Netlify CDN headers

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=21600' // 6 hour cache - cashback doesn't change by the minute
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const [igraal, topcb, rakuten, beruby] = await Promise.allSettled([
    scrapeIGraal(),
    scrapeTopCashback(),
    scrapeRakuten(),
    scrapeBeRuby()
  ]);

  const all = [
    ...(igraal.status   === 'fulfilled' ? igraal.value   : fallbackIGraal()),
    ...(topcb.status    === 'fulfilled' ? topcb.value     : fallbackTopCB()),
    ...(rakuten.status  === 'fulfilled' ? rakuten.value   : fallbackRakuten()),
    ...(beruby.status   === 'fulfilled' ? beruby.value    : fallbackBeRuby()),
  ];

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ cashback: all, updated: new Date().toISOString() })
  };
};

// ── iGraal ────────────────────────────────────────────────────────────────────
async function scrapeIGraal() {
  const results = [];

  // iGraal has a public merchant search API endpoint
  const url = 'https://es.igraal.com/api/merchants/search?query=aliexpress&limit=5';
  try {
    const res = await fetch(url, { headers: UA() });
    if (res.ok) {
      const data = await res.json();
      const merchants = data?.merchants || data?.data || data || [];
      for (const m of merchants.slice(0, 5)) {
        const pct = extractPct(m.cashback_rate || m.rate || m.cashbackRate || m.commission || '');
        if (pct > 0) results.push({ name: 'iGraal', icon: '🎁', store: m.name || m.merchant_name || 'Tienda', pct, url: `https://es.igraal.com/codes-promo/${(m.slug||m.name||'tienda').toLowerCase()}`, source: 'live' });
      }
      if (results.length > 0) return results;
    }
  } catch (_) {}

  // Fallback: scrape the merchant page directly
  const stores = ['AliExpress', 'Amazon', 'eBay', 'Miravia'];
  for (const store of stores) {
    try {
      const res = await fetch(`https://es.igraal.com/codes-promo/${store.toLowerCase()}`, { headers: UA() });
      const html = await res.text();
      // Look for cashback percentage patterns
      const m = html.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?(?:cashback|reembolso|devolución)/i)
        || html.match(/cashback[^<]{0,50}?(\d+(?:[.,]\d+)?)\s*%/i)
        || html.match(/"cashback_rate"\s*:\s*"?([\d.]+)"?/i);
      if (m) {
        const pct = parseFloat(m[1].replace(',', '.'));
        if (pct > 0) results.push({ name: 'iGraal', icon: '🎁', store, pct, url: `https://es.igraal.com/codes-promo/${store.toLowerCase()}`, source: 'live' });
      }
    } catch (_) {}
  }

  return results.length > 0 ? results : fallbackIGraal();
}

// ── TopCashback ───────────────────────────────────────────────────────────────
async function scrapeTopCashback() {
  const results = [];
  const stores = ['aliexpress', 'amazon', 'ebay'];

  for (const store of stores) {
    try {
      const res = await fetch(`https://www.topcashback.es/tiendas/${store}/`, { headers: UA() });
      const html = await res.text();
      const m = html.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (m) {
        const pct = parseFloat(m[1].replace(',', '.'));
        if (pct > 0) {
          const prettyStore = store.charAt(0).toUpperCase() + store.slice(1);
          results.push({ name: 'TopCashback', icon: '💎', store: prettyStore, pct, url: `https://www.topcashback.es/tiendas/${store}/`, source: 'live' });
        }
      }
    } catch (_) {}
  }

  return results.length > 0 ? results : fallbackTopCB();
}

// ── Rakuten ───────────────────────────────────────────────────────────────────
async function scrapeRakuten() {
  const results = [];
  try {
    const res = await fetch('https://www.rakuten.es/stores/', { headers: UA() });
    const html = await res.text();
    // Parse store list with cashback
    const re = /href="([^"]+)"[^>]*>[^<]*(?:AliExpress|Amazon|eBay)[^<]*<[\s\S]{0,300}?(\d+(?:[.,]\d+)?)\s*%/gi;
    let m;
    while ((m = re.exec(html)) && results.length < 4) {
      const pct = parseFloat(m[2].replace(',', '.'));
      const nameM = m[0].match(/AliExpress|Amazon|eBay/i);
      if (pct > 0 && nameM) {
        results.push({ name: 'Rakuten', icon: '🔴', store: nameM[0], pct, url: `https://www.rakuten.es${m[1]}`, source: 'live' });
      }
    }
  } catch (_) {}
  return results.length > 0 ? results : fallbackRakuten();
}

// ── BeRuby ────────────────────────────────────────────────────────────────────
async function scrapeBeRuby() {
  const results = [];
  try {
    const res = await fetch('https://www.beruby.com/cashback-tiendas', { headers: UA() });
    const html = await res.text();
    const re = /(AliExpress|Amazon|eBay)[\s\S]{0,200}?(\d+(?:[.,]\d+)?)\s*%/gi;
    let m;
    while ((m = re.exec(html)) && results.length < 3) {
      const pct = parseFloat(m[2].replace(',', '.'));
      if (pct > 0) results.push({ name: 'BeRuby', icon: '🟢', store: m[1], pct, url: 'https://www.beruby.com', source: 'live' });
    }
  } catch (_) {}
  return results.length > 0 ? results : fallbackBeRuby();
}

// ── FALLBACKS (used only if all scraping fails) ───────────────────────────────
// These are marked as estimated, not presented as current rates
function fallbackIGraal()   { return [{ name:'iGraal',      icon:'🎁', store:'AliExpress', pct: 2.0, url:'https://es.igraal.com/codes-promo/aliexpress', source:'estimated' }]; }
function fallbackTopCB()    { return [{ name:'TopCashback',  icon:'💎', store:'AliExpress', pct: 2.5, url:'https://www.topcashback.es/tiendas/aliexpress/', source:'estimated' }]; }
function fallbackRakuten()  { return [{ name:'Rakuten',      icon:'🔴', store:'AliExpress', pct: 1.5, url:'https://www.rakuten.es', source:'estimated' }]; }
function fallbackBeRuby()   { return [{ name:'BeRuby',       icon:'🟢', store:'AliExpress', pct: 1.8, url:'https://www.beruby.com', source:'estimated' }]; }

function UA() {
  return { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' };
}

function extractPct(val) {
  if (!val) return 0;
  const m = String(val).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}
