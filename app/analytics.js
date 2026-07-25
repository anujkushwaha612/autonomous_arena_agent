'use strict';
/**
 * analytics.js — click recording and analytics for Linkly.
 *
 * Exports:
 *   recordClick(code, { referrer, userAgent, ip })
 *   getStats(code)
 *   getTopLinks(limit = 10)
 *
 * Storage:
 *   - clicks store: { [code]: [ { timestamp, referrer, userAgent, ip }, ... ] }
 *   - links store: links.clicks counter incremented on each click.
 */

const store = require('./store');
const links = require('./links');

function maskIp(ip) {
  if (!ip) return 'unknown';
  const str = String(ip).trim();
  const firstIp = str.split(',')[0].trim().split(':')[0];
  if (firstIp.includes('.')) {
    const parts = firstIp.split('.');
    const oct1 = parts[0] || 'x';
    const oct2 = parts[1] || 'x';
    return `${oct1}.${oct2}.x.x`;
  }
  if (firstIp.includes(':')) {
    const parts = firstIp.split(':').filter(Boolean);
    const p1 = parts[0] || 'x';
    const p2 = parts[1] || 'x';
    return `${p1}:${p2}::x`;
  }
  return 'x.x.x.x';
}

function recordClick(code, { referrer, userAgent, ip } = {}) {
  if (!code) return null;
  const targetCode = String(code);

  const clicksStore = store.read('clicks');
  if (!clicksStore[targetCode]) {
    clicksStore[targetCode] = [];
  }

  const truncatedUserAgent = userAgent ? String(userAgent).slice(0, 200) : '';
  const maskedIp = maskIp(ip);
  const cleanReferrer = referrer ? String(referrer) : '';

  const clickRecord = {
    timestamp: new Date().toISOString(),
    referrer: cleanReferrer,
    userAgent: truncatedUserAgent,
    ip: maskedIp,
  };

  clicksStore[targetCode].push(clickRecord);
  store.write('clicks', clicksStore);

  // Increment link's clicks counter
  const linksStore = store.read('links');
  if (linksStore[targetCode]) {
    linksStore[targetCode].clicks = (linksStore[targetCode].clicks || 0) + 1;
    store.write('links', linksStore);
  }

  return clickRecord;
}

function getStats(code) {
  if (!code) return { total: 0, byDay: {}, topReferrers: [], recent: [] };
  const targetCode = String(code);
  const clicksStore = store.read('clicks');
  const clickList = clicksStore[targetCode] || [];

  const total = clickList.length;
  const byDay = {};
  const refCounts = {};

  for (const c of clickList) {
    if (c.timestamp) {
      const day = c.timestamp.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    const ref = c.referrer !== undefined ? c.referrer : '';
    refCounts[ref] = (refCounts[ref] || 0) + 1;
  }

  const topReferrers = Object.entries(refCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([referrer, count]) => ({ referrer, count }));

  // Last 10 clicks, most recent first
  const recent = clickList.slice().reverse().slice(0, 10);

  return {
    total,
    byDay,
    topReferrers,
    recent,
  };
}

function getTopLinks(limit = 10) {
  const allLinks = links.listLinks();
  const lim = Number.isInteger(limit) && limit > 0 ? limit : 10;
  return allLinks
    .sort((a, b) => {
      const ca = (b.clicks || 0) - (a.clicks || 0);
      if (ca !== 0) return ca;
      const ta = a && a.createdAt ? a.createdAt : '';
      const tb = b && b.createdAt ? b.createdAt : '';
      if (ta === tb) return 0;
      return ta < tb ? 1 : -1;
    })
    .slice(0, lim);
}

module.exports = {
  recordClick,
  getStats,
  getTopLinks,
};
