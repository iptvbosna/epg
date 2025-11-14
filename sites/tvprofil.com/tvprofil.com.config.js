const axios = require('axios');
const dayjs = require('dayjs');

const WORKER_URL = 'https://sehara-tvprofil.seharavip15.workers.dev/'; // tvoj Cloudflare Worker

module.exports = {
  site: 'tvprofil.com',
  days: 2,
  url({ channel, date }) {
    const parts = channel.site_id.split('#');
    const query = buildQuery(parts[1], date);

    const targetUrl = `https://tvprofil.com/${parts[0]}/program/?${query}`;
    return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`;
  },
  request: {
    maxContentLength: 50000000,
    timeout: 30000
  },
  parser({ content }) {
    const cheerio = require('cheerio');
    const items = parseItems(content);
    const programs = [];

    items.forEach(item => {
      const $ = cheerio.load(item);
      $('div.row').each((_, el) => {
        const $item = $(el);
        const start = parseStart($item);
        const duration = parseDuration($item);

        programs.push({
          title: parseTitle($item),
          category: parseCategory($item),
          start,
          stop: start.add(duration, 's'),
          icon: parseImage($item)
        });
      });
    });

    return programs;
  },
  async channels() {
    const countries = {
      al: { channelsPath: '/al', progsPath: 'al/programacioni', lang: 'sq' },
      at: { channelsPath: '/at', progsPath: 'at/tvprogramm', lang: 'de' },
      ba: { channelsPath: '/ba', progsPath: 'ba/tvprogram', lang: 'bs' },
      bg: { channelsPath: '/bg', progsPath: 'bg/tv-programa', lang: 'bg' },
      ch: { channelsPath: '/ch', progsPath: 'ch/tv-programm', lang: 'de' },
      de: { channelsPath: '/de', progsPath: 'de/tvprogramm', lang: 'de' },
      es: { channelsPath: '/es', progsPath: 'es/programacion-tv', lang: 'es' },
      fr: { channelsPath: '/fr', progsPath: 'fr/programme-tv', lang: 'fr' },
      hr: { channelsPath: '',    progsPath: 'tvprogram', lang: 'hr' },
      hu: { channelsPath: '/hu', progsPath: 'hu/tvmusor', lang: 'hu' },
      ie: { channelsPath: '/ie', progsPath: 'ie/tvschedule', lang: 'en' },
      it: { channelsPath: '/it', progsPath: 'it/guida-tv', lang: 'it' },
      ks: { channelsPath: '/ks', progsPath: 'ks/programacioni', lang: 'sq' },
      me: { channelsPath: '/me', progsPath: 'me/tvprogram', lang: 'en' },
      mk: { channelsPath: '/mk', progsPath: 'mk/tv-raspored', lang: 'mk' },
      pl: { channelsPath: '/pl', progsPath: 'pl/program', lang: 'pl' },
      pt: { channelsPath: '/pt', progsPath: 'pt/programacao', lang: 'pt' },
      ro: { channelsPath: '/ro', progsPath: 'ro/program-tv', lang: 'ro' },
      rs: { channelsPath: '/rs', progsPath: 'rs/tvprogram', lang: 'sr' },
      si: { channelsPath: '/si', progsPath: 'si/tvspored', lang: 'sl' },
      tr: { channelsPath: '/tr', progsPath: 'tr/tv-rehberi', lang: 'tr' },
      uk: { channelsPath: '/gb', progsPath: 'gb/tvschedule', lang: 'en' },
    };

    let channels = [];

    for (let country in countries) {
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
  let data = (content.match(/^[^(]+\(([\s\S]*)\)$/) || [null,null])[1];
  if (!data) return [];
  const json = JSON.parse(data);
  return json?.data?.program ? [json.data.program] : [];
}
function buildQuery(site_id, date) {
  const query = { datum: date.format('YYYY-MM-DD'), kanal: site_id };
  let c = 4, a = query.datum + query.kanal, ua = query.kanal + query.datum;
  ua = ua || 'none';
  for (let j=0;j<ua.length;j++) c+=ua.charCodeAt(j);
  let i = a.length, b=2;
  while(i--) b+=(a.charCodeAt(i)+c*2)*i;
  b=b.toString();
  const lastCharCode = b.charCodeAt(b.length-1);
  query['callback'] = `tvprogramit${lastCharCode}`;
  query['b'+lastCharCode]=b;
  return new URLSearchParams(query).toString();
}
