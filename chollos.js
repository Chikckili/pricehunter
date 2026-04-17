// chollos.js — Netlify Function
// Fetches Chollometro RSS and returns items sorted by: hottest, most commented, most recent

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=180' // 3 min cache
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    // Chollometro offers multiple RSS feeds
    const [hot, fresh, commented] = await Promise.allSettled([
      fetchRSS('https://www.chollometro.com/rss'),              // default = hottest
      fetchRSS('https://www.chollometro.com/nuevos/rss'),       // newest
      fetchRSS('https://www.chollometro.com/comentados/rss'),   // most commented
    ]);

    const hotItems       = hot.status       === 'fulfilled' ? hot.value       : [];
    const freshItems     = fresh.status     === 'fulfilled' ? fresh.value     : [];
    const commentedItems = commented.status === 'fulfilled' ? commented.value : [];

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        hot:       hotItems,
        fresh:     freshItems,
        commented: commentedItems,
        updated:   new Date().toISOString()
      })
    };
  } catch (e) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ hot: [], fresh: [], commented: [], error: e.message }) };
  }
};

async function fetchRSS(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PriceHunterBot/1.0; +https://pricehunter.app)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const xml = await res.text();
  return parseRSS(xml);
}

function parseRSS(xml) {
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

  for (const block of blocks.slice(0, 30)) {
    const title    = cdata(block, 'title');
    const link     = cdata(block, 'link') || cdata(block, 'guid');
    const desc     = cdata(block, 'description') || '';
    const pubDate  = cdata(block, 'pubDate') || '';
    const category = cdata(block, 'category') || 'General';
    const creator  = cdata(block, 'dc:creator') || '';

    if (!title || !link) continue;

    // Temperature/votes — Chollometro embeds it as °
    const tempM  = desc.match(/(\d+)\s*°/) || title.match(/(\d+)\s*°/);
    const votes  = tempM ? parseInt(tempM[1]) : 0;

    // Comments count
    const commM  = desc.match(/(\d+)\s*(?:comentarios?|comments?)/i);
    const comments = commM ? parseInt(commM[1]) : 0;

    // Price
    const priceM = (title + ' ' + desc).match(/([\d]+(?:[.,][\d]{2})?)\s*€/);
    const price  = priceM ? parsePrice(priceM[1]) : null;

    // Previous price (strikethrough in HTML)
    const prevM  = desc.match(/~~([\d]+(?:[.,][\d]{2})?)\s*€~~/)
      || desc.match(/antes[:\s]*([\d]+(?:[.,][\d]{2})?)\s*€/i)
      || desc.match(/<s>([\d]+(?:[.,][\d]{2})?)\s*€<\/s>/i);
    const prevPrice = prevM ? parsePrice(prevM[1]) : null;

    // Thumbnail
    const imgM  = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    const image = imgM ? imgM[1] : null;

    const cleanedTitle = title
      .replace(/\s*\|\s*Chollometro.*/i, '')
      .replace(/\s*\(\d+°\)/, '')
      .trim();

    items.push({
      title: cleanedTitle,
      link: link.trim(),
      price,
      prevPrice: (prevPrice && price && prevPrice > price) ? prevPrice : null,
      votes,
      comments,
      category: category.trim(),
      image,
      pubDate,
      timeAgo: timeAgo(pubDate),
      author: creator
    });
  }

  return items;
}

function cdata(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parsePrice(s) {
  if (!s) return null;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || null;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'reciente';
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60)    return 'hace ' + diff + 's';
    if (diff < 3600)  return 'hace ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + 'h';
    return 'hace ' + Math.floor(diff / 86400) + 'd';
  } catch (_) { return 'reciente'; }
}
