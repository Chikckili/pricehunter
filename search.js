// search.js — Netlify Function
// Uses Google Shopping RSS + AliExpress affiliate API + Amazon product search
// All are server-side so no CORS issues

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const q = (event.queryStringParameters || {}).q || '';
  if (!q.trim()) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'No query' }) };

  try {
    // Run all sources in parallel, take whatever succeeds
    const [googleResults, aliResults, amazonResults, ebayResults] = await Promise.allSettled([
      searchGoogleShopping(q),
      searchAliExpress(q),
      searchAmazon(q),
      searchEbay(q)
    ]);

    const all = [
      ...(googleResults.status === 'fulfilled' ? googleResults.value : []),
      ...(aliResults.status    === 'fulfilled' ? aliResults.value    : []),
      ...(amazonResults.status === 'fulfilled' ? amazonResults.value : []),
      ...(ebayResults.status   === 'fulfilled' ? ebayResults.value   : []),
    ];

    // Deduplicate and sort by price
    const seen = new Set();
    const unique = all.filter(i => {
      const k = i.store + ':' + i.title.substring(0, 20).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.price - b.price);

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ results: unique }) };
  } catch (e) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ results: [], error: e.message }) };
  }
};

// ── GOOGLE SHOPPING RSS ──────────────────────────────────────────────────────
// Public RSS feed, no API key needed
async function searchGoogleShopping(query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop&hl=es&gl=ES&output=rss`;
  const res = await fetchWithHeaders(url, {
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
  });
  const xml = await res.text();
  return parseGoogleShoppingRSS(xml, query);
}

function parseGoogleShoppingRSS(xml, query) {
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

  for (const block of blocks.slice(0, 15)) {
    const title = cdataOrText(block, 'title');
    const link  = cdataOrText(block, 'link') || cdataOrText(block, 'g:link');
    const priceRaw = cdataOrText(block, 'g:price') || cdataOrText(block, 'price') || '';
    const condition = cdataOrText(block, 'g:condition') || 'new';
    const merchant  = cdataOrText(block, 'g:store') || cdataOrText(block, 'author') || 'Tienda';
    const imgUrl    = cdataOrText(block, 'g:image_link') || cdataOrText(block, 'enclosure');

    const price = parsePrice(priceRaw);
    if (!title || price <= 0) continue;

    items.push({
      title: cleanTitle(title),
      price,
      originalPrice: 0,
      store: merchant,
      url: link || `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop`,
      image: imgUrl || null,
      condition
    });
  }
  return items;
}

// ── ALIEXPRESS — Affiliate public endpoint ───────────────────────────────────
async function searchAliExpress(query) {
  // AliExpress has a public product feed / WAP endpoint
  const url = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&SortType=price_asc&shipCountry=es&currency=EUR`;
  const res = await fetchWithHeaders(url, {
    'Accept': 'text/html',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Referer': 'https://www.aliexpress.com/'
  });
  const html = await res.text();
  return parseAliExpressHTML(html, query);
}

function parseAliExpressHTML(html, query) {
  const results = [];

  // AliExpress embeds product data in a window.__INIT_DATA__ script
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    // Look for the data blob
    const m = script.match(/"mods"\s*:\s*\{[\s\S]*?"itemList"\s*:\s*\{[\s\S]*?"content"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (m) {
      try {
        const items = JSON.parse(m[1]);
        for (const item of items.slice(0, 10)) {
          const price = parseFloat(
            item?.prices?.salePrice?.minPrice ||
            item?.prices?.salePrice?.price ||
            item?.price?.minAmount?.value || 0
          );
          if (price <= 0) continue;
          const img = item?.image?.imgUrl || '';
          results.push({
            title: item?.title?.displayTitle || item?.title?.seoTitle || query,
            price,
            originalPrice: parseFloat(item?.prices?.originalPrice?.minPrice || 0),
            store: 'AliExpress',
            url: `https://es.aliexpress.com/item/${item.productId}.html`,
            image: img ? (img.startsWith('//') ? 'https:' + img : img) : null
          });
        }
        if (results.length > 0) return results;
      } catch (_) {}
    }
  }

  // Fallback: regex scan
  const re = /"productId"\s*:\s*"?(\d+)"?[^}]*"(?:displayTitle|seoTitle)"\s*:\s*"([^"]+)"[^}]*"minPrice"\s*:\s*"?([\d.]+)"?/g;
  let m2;
  while ((m2 = re.exec(html)) && results.length < 8) {
    results.push({
      title: m2[2],
      price: parseFloat(m2[3]),
      originalPrice: 0,
      store: 'AliExpress',
      url: `https://es.aliexpress.com/item/${m2[1]}.html`,
      image: null
    });
  }

  // Always add a search shortcut card so user can go directly
  results.push({
    title: `Ver todos los resultados en AliExpress`,
    price: 0,
    originalPrice: 0,
    store: 'AliExpress',
    url: `https://es.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&SortType=price_asc`,
    image: null,
    isLink: true
  });

  return results;
}

// ── AMAZON — Product Advertising (public search page parse) ──────────────────
async function searchAmazon(query) {
  const url = `https://www.amazon.es/s?k=${encodeURIComponent(query)}&s=price-asc-rank`;
  const res = await fetchWithHeaders(url, {
    'Accept': 'text/html',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Referer': 'https://www.amazon.es/'
  });
  const html = await res.text();
  return parseAmazonHTML(html, query);
}

function parseAmazonHTML(html, query) {
  const results = [];

  // Amazon embeds product JSON in data-component-props attributes
  const re = /data-component-props="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) && results.length < 8) {
    try {
      const props = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      const price = parseFloat(props?.price?.current_price || props?.currentPrice || 0);
      const title = props?.asin_metadata?.title || props?.title || '';
      const asin  = props?.asin || props?.asin_metadata?.asin || '';
      const img   = props?.imageUrl || props?.asin_metadata?.main_image?.hiRes || '';
      if (price > 0 && title) {
        results.push({
          title: cleanTitle(title),
          price,
          originalPrice: parseFloat(props?.price?.previous_price || 0),
          store: 'Amazon',
          url: `https://www.amazon.es/dp/${asin}`,
          image: img || null
        });
      }
    } catch (_) {}
  }

  // Alternative: look for price spans
  if (!results.length) {
    const titleRe = /class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{10,120})</g;
    const priceRe  = /class="[^"]*a-price-whole[^"]*"[^>]*>([^<]{1,10})</g;
    const titles = [...html.matchAll(titleRe)].map(x => x[1].trim()).filter(x => x.length > 5);
    const prices = [...html.matchAll(priceRe)].map(x => parseFloat(x[1].replace(/\./g,'').replace(',','.'))).filter(x => x > 0);
    for (let i = 0; i < Math.min(titles.length, prices.length, 6); i++) {
      results.push({ title: cleanTitle(titles[i]), price: prices[i], originalPrice: 0, store: 'Amazon', url: `https://www.amazon.es/s?k=${encodeURIComponent(query)}`, image: null });
    }
  }

  results.push({
    title: 'Ver todos los resultados en Amazon',
    price: 0, originalPrice: 0, store: 'Amazon',
    url: `https://www.amazon.es/s?k=${encodeURIComponent(query)}&s=price-asc-rank`,
    image: null, isLink: true
  });
  return results;
}

// ── EBAY ─────────────────────────────────────────────────────────────────────
async function searchEbay(query) {
  // eBay has a public RSS/search feed
  const url = `https://www.ebay.es/sch/i.html?_nkw=${encodeURIComponent(query)}&_sop=15`; // sort by price
  const res = await fetchWithHeaders(url, {
    'Accept': 'text/html',
    'Accept-Language': 'es-ES,es;q=0.9'
  });
  const html = await res.text();
  return parseEbayHTML(html, query);
}

function parseEbayHTML(html, query) {
  const results = [];
  // eBay item blocks
  const re = /s-item__title[^>]*>([^<]{5,100})<[\s\S]{0,500}?s-item__price[^>]*>([\d,. €$£]+)</g;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    const price = parsePrice(m[2]);
    if (price <= 0) continue;
    results.push({
      title: cleanTitle(m[1]),
      price,
      originalPrice: 0,
      store: 'eBay',
      url: `https://www.ebay.es/sch/i.html?_nkw=${encodeURIComponent(query)}&_sop=15`,
      image: null
    });
  }
  results.push({ title: 'Ver resultados en eBay', price: 0, originalPrice: 0, store: 'eBay', url: `https://www.ebay.es/sch/i.html?_nkw=${encodeURIComponent(query)}&_sop=15`, image: null, isLink: true });
  return results;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function fetchWithHeaders(url, extraHeaders = {}) {
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      ...extraHeaders
    },
    redirect: 'follow'
  });
}

function cdataOrText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parsePrice(str) {
  if (!str) return 0;
  // Handle "12.345,67 EUR" and "1,234.56 USD" and "€ 12.99"
  const clean = str.replace(/[^0-9.,]/g, '');
  if (!clean) return 0;
  // If comma before 2 decimals at end: European format
  if (/,\d{2}$/.test(clean)) return parseFloat(clean.replace('.', '').replace(',', '.'));
  return parseFloat(clean.replace(',', ''));
}

function cleanTitle(t) {
  return t.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}
