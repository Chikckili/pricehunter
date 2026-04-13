exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const query = event.queryStringParameters?.q;
  if (!query) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing query' }) };
  }

  try {
    const results = await scrapeMiravia(query);
    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (e) {
    console.error('Miravia error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ results: [], error: e.message }) };
  }
};

async function scrapeMiravia(query) {
  // Miravia uses the same backend as Lazada (Alibaba group)
  // Try their search API endpoint
  const apiUrl = `https://www.miravia.es/search.htm?q=${encodeURIComponent(query)}&ajax=true`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': 'https://www.miravia.es/',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });

  // Try JSON response first
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    const items = data?.rgn?.listItems || data?.items || data?.data?.items || [];
    if (items.length > 0) return parseMiraviaItems(items, query);
  }

  // Fall back to HTML scraping
  const htmlRes = await fetch(`https://www.miravia.es/search.htm?q=${encodeURIComponent(query)}&sort=priceasc`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': 'https://www.miravia.es/'
    }
  });

  const html = await htmlRes.text();
  return parseMiraviaHTML(html, query);
}

function parseMiraviaItems(items, query) {
  return items.slice(0, 10).map(item => {
    const price = parseFloat(item.price || item.salePrice || item.priceShow?.replace(/[^0-9.]/g,'') || 0);
    const original = parseFloat(item.originalPrice || item.originalPriceShow?.replace(/[^0-9.]/g,'') || 0);
    return {
      id: item.itemId || item.nid,
      title: item.name || item.title || query,
      price,
      originalPrice: original > price ? original : 0,
      currency: 'EUR',
      image: item.image || item.mainImage || null,
      store: 'Miravia',
      url: item.itemUrl ? `https://www.miravia.es${item.itemUrl}` : `https://www.miravia.es/search.htm?q=${encodeURIComponent(query)}`,
      rating: item.ratingScore || null,
      reviews: item.review || null
    };
  }).filter(i => i.price > 0);
}

function parseMiraviaHTML(html, query) {
  const results = [];

  // Try to extract from embedded __moduleData__ or window.pageData
  const jsonMatch = html.match(/window\.__moduleData__\s*=\s*({.+?});\s*(?:window|<\/script>)/s)
    || html.match(/"listItems"\s*:\s*(\[.+?\])\s*[,}]/s);

  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[1]);
      const items = raw?.data?.listItems || raw?.listItems || (Array.isArray(raw) ? raw : []);
      if (items.length > 0) return parseMiraviaItems(items, query);
    } catch (e) {}
  }

  // Extract price patterns from HTML
  const pricePattern = /class="[^"]*price[^"]*"[^>]*>\s*([€\d.,\s]+)/gi;
  const titlePattern = /class="[^"]*(?:title|name)[^"]*"[^>]*>\s*([^<]{10,100})/gi;
  const titles = [...html.matchAll(titlePattern)].map(m => m[1].trim()).filter(t => t.length > 5);
  const prices = [...html.matchAll(pricePattern)].map(m => parseFloat(m[1].replace(/[^0-9.]/g,''))).filter(p => p > 0);

  for (let i = 0; i < Math.min(titles.length, prices.length, 8); i++) {
    results.push({
      id: `miravia-${i}`,
      title: titles[i],
      price: prices[i],
      originalPrice: 0,
      currency: 'EUR',
      image: null,
      store: 'Miravia',
      url: `https://www.miravia.es/search.htm?q=${encodeURIComponent(query)}&sort=priceasc`
    });
  }

  if (results.length > 0) return results;

  return [{
    id: 'miravia-search',
    title: `Resultados para "${query}" en Miravia`,
    price: 0,
    originalPrice: 0,
    currency: 'EUR',
    image: null,
    store: 'Miravia',
    url: `https://www.miravia.es/search.htm?q=${encodeURIComponent(query)}&sort=priceasc`,
    isSearchLink: true
  }];
}
