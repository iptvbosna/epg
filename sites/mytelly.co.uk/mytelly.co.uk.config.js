const cheerio = require('cheerio')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const axios = require('axios')
const debug = require('debug')('site:mytelly.co.uk')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const tz = 'Europe/London'
const WORKER_URL = 'https://mytelly.seharavip15.workers.dev'

function proxyUrl(targetUrl) {
  return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`
}

module.exports = {
  site: 'mytelly.co.uk',
  days: 2,
  request: {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 OPR/117.0.0.0'
    }
  },
  url({ date, channel }) {
    return proxyUrl(
      `https://www.mytelly.co.uk/tv-guide/listings/channel/${channel.site_id}.html?dt=${date.format('YYYY-MM-DD')}`
    )
  },
  async parser({ content, date }) {
    const programs = []

    if (!content) return programs

    const $ = cheerio.load(content)
    const rows = $('table.table > tbody > tr').toArray()
    if (!rows.length) return programs

    const queue = []
    rows.forEach(el => {
      const href = $(el).find('td:eq(1) h5 a').attr('href')
      if (href) queue.push(href)
    })

    if (!queue.length) return programs

    // SMANJEN CHUNK SIZE SA 5 NA 1
    const chunkSize = 1
    for (let i = 0; i < queue.length; i += chunkSize) {
      const chunk = queue.slice(i, i + chunkSize)
      
      // PAUZA OD 1 SEKUNDE ZA ZAOBILAŽENJE AWS WAF BLOKADA
      await new Promise(r => setTimeout(r, 1000));

      const results = await Promise.allSettled(
        chunk.map(href => {
          const fullUrl = href.startsWith('http')
            ? href
            : `https://www.mytelly.co.uk${href}`
          debug(`Fetching: ${fullUrl}`)
          return axios.get(proxyUrl(fullUrl))
        })
      )

      results.forEach(result => {
        if (result.status !== 'fulfilled') {
          debug(`Failed: ${result.reason}`)
          return
        }
        
        const res = result.value.data
        if (!res) return

        const $p = cheerio.load(res)

        const timeText = $p('center > h5 > b').text().trim()
        if (!timeText) return

        const title = parseText($p('.inner-heading.sub h2'))
        if (!title) return

        const subTitleRaw = parseText($p('.tab-pane > h5 > strong'))
        const description = parseText($p('.tab-pane > .tvbody > p'))
        const image = $p('.program-media-image img').attr('src')
        const category = $p('.schedule-attributes-genres span')
          .toArray()
          .map(el => $p(el).text().trim())
          .filter(Boolean)

        const casts = $p('.single-cast-head:not([id])')
          .toArray()
          .map(el => {
            const name = parseText($p(el).find('a'))
            const match = $p(el).text().match(/\((.*?)\)/)
            const role = match ? match[1].trim() : null
            return { name, role }
          })
          .filter(c => c.name)

        const [start, stop] = parseStartStop(date, timeText)

        let subTitle = null
        let season, episode

        if (subTitleRaw) {
          const cleaned = subTitleRaw.replace(/\s+/g, ' ').trim()
          const seMatch = cleaned.match(/Season\s+(\d+),\s+Episode\s+(\d+)/i)
          if (seMatch) {
            season = parseInt(seMatch[1])
            episode = parseInt(seMatch[2])
            subTitle = cleaned.replace(/Season\s+\d+,\s+Episode\s+\d+/i, '').trim() || null
          } else {
            subTitle = cleaned
          }
        }

        programs.push({
          title,
          subTitle,
          description,
          image,
          category,
          season,
          episode,
          actor: casts.filter(c => c.role === 'Actor').map(c => c.name),
          director: casts.filter(c => c.role === 'Director').map(c => c.name),
          presenter: casts.filter(c => c.role === 'Presenter').map(c => c.name),
          start,
          stop
        })
      })
    }

    programs.sort((a, b) => a.start.valueOf() - b.start.valueOf())
    return programs
  },
  async channels() {
    const channels = {}

    try {
      const formRes = await axios.get(proxyUrl('https://www.mytelly.co.uk/getform'))
      const $ = cheerio.load(formRes.data)
      const providers = $('#guide_provider option')
        .toArray()
        .map(el => $(el).attr('value'))
        .filter(Boolean)

      const regionResults = await Promise.all(
        providers.map(provider =>
          axios
            .get(proxyUrl(`https://www.mytelly.co.uk/getregions?provider=${encodeURIComponent(provider)}`))
            .then(res => ({ provider, regions: res.data }))
            .catch(() => null)
        )
      )

      const now = dayjs()
      const schedulePromises = []

      for (const result of regionResults) {
        if (!result || !result.regions || typeof result.regions !== 'object') continue
        for (const r of Object.values(result.regions)) {
          const params = new URLSearchParams({
            provider: result.provider,
            region: r.title,
            TVperiod: 'Night',
            date: now.format('YYYY-MM-DD'),
            st: 0,
            u_time: now.format('HHmm'),
            is_mobile: 1
          })
          schedulePromises.push(
            axios
              .post(
                proxyUrl('https://www.mytelly.co.uk/tv-guide/schedule'),
                params.toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
              )
              .then(res => res.data)
              .catch(() => null)
          )
        }
      }

      const scheduleResults = await Promise.all(schedulePromises)

      for (const html of scheduleResults) {
        if (!html) continue
        const $s = cheerio.load(html)
        $s('.channelname').each((i, el) => {
          const name = $s(el).find('center > a:eq(1)').text().trim()
          const url = $s(el).find('center > a:eq(1)').attr('href')
          if (!url) return
          const match = url.match(/\/(\d+)\/(.*)\.html$/)
          if (!match) return
          const [, number, slug] = match
          const site_id = `${number}/${slug}`
          if (!channels[site_id]) {
            channels[site_id] = { lang: 'en', site_id, name }
          }
        })
      }
    } catch (err) {
      debug(`channels() error: ${err.message}`)
    }

    return Object.values(channels)
  }
}

function parseStartStop(date, time) {
  const [s, e] = time.split(' - ')
  const start = parseTime(date, s.trim())
  let stop = parseTime(date, e.trim())
  if (stop.isBefore(start)) stop = stop.add(1, 'd')
  return [start, stop]
}

function parseTime(date, time) {
  return dayjs.tz(`${date.format('YYYY-MM-DD')} ${time}`, 'YYYY-MM-DD h:mm a', tz)
}

function parseText($item) {
  if (!$item || !$item.text) return ''
  let text = $item.text().replace(/\t/g, '').replace(/\n/g, ' ').trim()
  while (text.includes('  ')) text = text.replace(/  /g, ' ')
  return text
}
