const cheerio = require('cheerio');
const dayjs = require('dayjs');

const WORKER_URL = 'https://sehara-tvprofil.seharavip15.workers.dev/';

module.exports = {
  site: 'tvprofil.com',
  days: 2,

  // Funkcija za testove vraća direktan URL
  url({ channel, date, useWorker = false }) {
    const parts = channel.site_id.split('#');
    const query = buildQuery(parts[1], date);
    const directUrl = `https://tvprofil.com/${parts[0]}/program/?${query}`;
    return useWorker ? `${WORKER_URL}?url=${encodeURIComponent(directUrl)}` : directUrl;
  },

  request: {
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      'referer': 'https://tvprofil.com/tvprogram/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    }
  },

  parser({ content }) {
    const programs = [];
    const items = parseItems(content);

    items.forEach(item => {
      const $ = cheerio.load(item);
      $('div.row').each((_, el) => {
        const $item = $(el);
        programs.push({
          title: parseTitle($item),
          category: parseCategory($item),
          start: parseStart($item),
          stop: parseStart($item).add(parseDuration($item), 's'),
          icon: parseImage($item)
        });
      });
    });

    return programs;
  },

  async channels() {
    // Runtime fetch preko Worker-a
    const axios = require('axios');
    const countries = { bg: { channelsPath: '/bg', progsPath: 'bg/tv-programa', lang: 'bg' } };
    const channels = [];

    for (const country in countries) {
      const cfg = countries[country];
      const url = `${WORKER_URL}?url=${encodeURIComponent(`https://tvprofil.com${cfg.channelsPath}/channels/getChannels/`)}`;
      const cb = await axios.get(url).then(r => r.data).catch(() => null);
      if (!cb) continue;

      const [, json] = cb.match(/^cb\((.*)\)$/i) || [];
      if (!json) continue;
      const data = JSON.parse(json);

      data.data.forEach(group => {
        group.channels.forEach(item => {
          channels.push({
            lang: cfg.lang,
            site_id: `${cfg.progsPath}#${item.urlID}`,
            xmltv_id: `${item.title.replace(/[ '&]/g, '')}.${country}`,
            name: item.title
          });
        });
      });
    }

    return channels;
  }
};

// --- Helper functions ---
function parseImage($item) { return $item.attr('data-image') || null; }
function parseDuration($item) { return parseInt($item.attr('data-len')); }
function parseStart($item) { return dayjs.unix(parseInt($item.attr('data-ts'))); }
function parseCategory($item) { return $item.find('.col:nth-child(2) > small').text() || null; }
function parseTitle($item) {
  let title = $item.find('.col:nth-child(2) > a').text();
  title += $item.find('.col:nth-child(2)').clone().children().remove().end().text();
  return title.replace('®','').trim().replace(/,$/,'');
}
function parseItems(content) {
  const data = (content.match(/^[^(]+\(([\s\S]*)\)$/) || [null, null])[1];
  if (!data) return [];
  const json = JSON.parse(data);
  return json?.data?.program ? [json.data.program] : [];
}
function buildQuery(site_id, date) {
  const query = { datum: date.format('YYYY-MM-DD'), kanal: site_id };
  let c = 4, a = query.datum + query.kanal, ua = query.kanal + query.datum;
  ua = ua || 'none';
  for (let j = 0; j < ua.length; j++) c += ua.charCodeAt(j);
  let i = a.length, b = 2;
  while (i--) b += (a.charCodeAt(i) + c * 2) * i;
  b = b.toString();
  const lastCharCode = b.charCodeAt(b.length - 1);
  query['callback'] = `tvprogramit${lastCharCode}`;
  query['b' + lastCharCode] = b;
  return new URLSearchParams(query).toString();
}
