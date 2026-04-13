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
    const results = await scrapeAliExpress(query);
    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (e) {
    console.error('AliExpress error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ results: [], error: e.message }) };
  }
};

async function scrapeAliExpress(query) {
  // Try AliExpress search API (mobile endpoint)
  const url = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&SortType=price_asc&page=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Referer': 'https://www.aliexpress.com/'
    }
  });

  const html = await res.text();

  // Extract the __INIT_DATA__ JSON blob AliExpress embeds in the page
  const match = html.match(/window\._dida_config_\s*=\s*({.+?});\s*<\/script>/s)
    || html.match(/window\.__INIT_DATA__\s*=\s*({.+?});\s*<\/script>/s)
    || html.match(/"mods"\s*:\s*\{.*?"itemList"\s*:\s*\{.*?"content"\s*:\s*(\[.*?\])\s*\}/s);

  if (match) {
    try {
      const raw = match[1];
      const data = JSON.parse(raw);
      const items = data?.data?.root?.fields?.mods?.itemList?.content
        || data?.mods?.itemList?.content
        || [];
      if (items.length > 0) return parseAliItems(items, query);
    } catch (e) {}
  }

  // Fallback: parse HTML product cards directly
  return parseAliHTML(html, query);
}

function parseAliItems(items, query) {
  return items.slice(0, 10).map(item => {
    const price = parseFloat(
      item.prices?.salePrice?.minPrice ||
      item.prices?.salePrice?.price ||
      item.price?.minAmount?.value || 0
    );
    const original = parseFloat(
      item.prices?.originalPrice?.minPrice ||
      item.prices?.originalPrice?.price || 0
    );
    const imgRaw = item.image?.imgUrl || item.productImage?.imgUrl || '';
    return {
      id: item.productId || item.itemId,
      title: item.title?.displayTitle || item.title?.seoTitle || query,
      price,
      originalPrice: original > price ? original : 0,
      currency: 'EUR',
      image: imgRaw ? (imgRaw.startsWith('//') ? 'https:' + imgRaw : imgRaw) : null,
      store: 'AliExpress',
      url: `https://es.aliexpress.com/item/${item.productId || item.itemId}.html`,
      rating: item.evaluation?.starRating || null,
      reviews: item.evaluation?.totalValidNum || null,
      sold: item.tradeDesc || null
    };
  }).filter(i => i.price > 0);
}

function parseAliHTML(html, query) {
  // Extract product data from embedded JSON scripts
  const results = [];
  const productPattern = /"productId"\s*:\s*"?(\d+)"?.*?"title"\s*:\s*"([^"]+)".*?"minAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/gs;
  let m;
  while ((m = productPattern.exec(html)) !== null && results.length < 10) {
    results.push({
      id: m[1],
      title: m[2],
      price: parseFloat(m[3]),
      originalPrice: 0,
      currency: 'EUR',
      image: null,
      store: 'AliExpress',
      url: `https://es.aliexpress.com/item/${m[1]}.html`
    });
  }

  if (results.length > 0) return results;

  // Last resort: return structured placeholder with direct search link
  return [{
    id: 'ali-search',
    title: `Resultados para "${query}" en AliExpress`,
    price: 0,
    originalPrice: 0,
    currency: 'EUR',
    image: null,
    store: 'AliExpress',
    url: `https://es.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&SortType=price_asc`,
    isSearchLink: true
  }];
}
