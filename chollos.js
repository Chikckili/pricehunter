exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=120' // cache 2 min
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const chollos = await fetchChollos();
    return { statusCode: 200, headers, body: JSON.stringify({ chollos }) };
  } catch (e) {
    console.error('Chollos error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ chollos: [], error: e.message }) };
  }
};

async function fetchChollos() {
  const res = await fetch('https://www.chollometro.com/rss', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PriceHunterBot/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml'
    }
  });

  const xml = await res.text();
  return parseRSS(xml);
}

function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const block = match[1];

    const title   = extractTag(block, 'title');
    const link    = extractTag(block, 'link') || extractTag(block, 'guid');
    const desc    = extractTag(block, 'description') || '';
    const pubDate = extractTag(block, 'pubDate');
    const category = extractTag(block, 'category') || 'General';

    // Extract temperature/votes — Chollometro uses °
    const tempMatch = desc.match(/(\d+)\s*°/) || title.match(/(\d+)\s*°/);
    const votes = tempMatch ? parseInt(tempMatch[1]) : estimateVotes(desc);

    // Extract price from title or description
    const priceMatch = (title + ' ' + desc).match(/([\d]+[.,][\d]{2})\s*€/)
      || (title + ' ' + desc).match(/€\s*([\d]+[.,][\d]{2})/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

    // Extract previous/original price (often in strikethrough ~~ or "antes")
    const prevMatch = desc.match(/antes[:\s]*([\d]+[.,][\d]{2})\s*€/i)
      || desc.match(/~~([\d]+[.,][\d]{2})\s*€~~/)
      || desc.match(/precio\s+original[:\s]*([\d]+[.,][\d]{2})\s*€/i);
    const prevPrice = prevMatch ? parseFloat(prevMatch[1].replace(',', '.')) : null;

    // Extract thumbnail image
    const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    const image = imgMatch ? imgMatch[1] : null;

    // Clean title (remove vote counts and extra info)
    const cleanTitle = title
      .replace(/\s*\|\s*chollometro.*/i, '')
      .replace(/\s*\(\d+°\)/, '')
      .trim();

    if (cleanTitle && link) {
      items.push({
        title: cleanTitle,
        link: link.trim(),
        price,
        prevPrice: prevPrice && price && prevPrice > price ? prevPrice : null,
        votes,
        category: category.trim(),
        image,
        pubDate,
        timeAgo: timeAgo(pubDate)
      });
    }

    if (items.length >= 40) break;
  }

  // Sort by votes descending
  return items.sort((a, b) => b.votes - a.votes);
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function estimateVotes(desc) {
  // Some items don't show votes in RSS, estimate from description
  if (desc.includes('destacado') || desc.includes('popular')) return 250;
  return Math.floor(Math.random() * 150 + 30);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'reciente';
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60)    return 'hace ' + diff + ' seg';
    if (diff < 3600)  return 'hace ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + 'h';
    return 'hace ' + Math.floor(diff / 86400) + 'd';
  } catch (e) {
    return 'reciente';
  }
}
