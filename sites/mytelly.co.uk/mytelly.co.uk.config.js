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

const detailedGuide = true
const tz = 'Europe/London'

const requestHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 OPR/117.0.0.0',
  'Referer': 'https://www.mytelly.co.uk/tv-guide/',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.5'
}

module.exports = {
  site: 'mytelly.co.uk',
  days: 2,
  request: {
    headers: requestHeaders
  },
  url({ date, channel }) {
    return `https://www.mytelly.co.uk/tv-guide/listings/channel/${
      channel.site_id
    }.html?dt=${date.format('YYYY-MM-DD')}`
  },
  async parser({ content, date }) {
    const programs = []

    if (content) {
      const $ = cheerio.load(content)

      if (!detailedGuide) {
        $('table.table > tbody > tr')
          .toArray()
          .forEach(el => {
            const td = $(el).find('td:eq(1)')
            const title = td.find('h5 a')
            const subtitle = td.find('h6')
            const time = $(el).find('td:eq(0)')
            let start = parseTime(date, time.text().trim())
            const prev = programs[programs.length - 1]
            if (prev) {
              if (start.isBefore(prev.start)) {
                start = start.add(1, 'd')
                date = date.add(1, 'd')
              }
              prev.stop = start
            }
            const stop = start.add(30, 'm')
            programs.push({
              title: parseText(title),
              subTitle: parseText(subtitle),
              start,
              stop
            })
          })
        return programs
      }

      // Collect all programme URLs from the listing page
      const rows = $('table.table > tbody > tr').toArray()
      const queue = []

      rows.forEach(el => {
        const td = $(el).find('td:eq(1)')
        const link = td.find('h5 a')
        const href = link.attr('href')
        if (href) {
          queue.push(href)
        }
      })

      if (queue.length) {
        // Fetch all programme pages concurrently (max 5 at a time)
        const chunkSize = 5
        for (let i = 0; i < queue.length; i += chunkSize) {
          const chunk = queue.slice(i, i + chunkSize)
          const results = await Promise.allSettled(
            chunk.map(href => {
              const fullUrl = href.startsWith('http')
                ? href
                : `https://www.mytelly.co.uk${href}`
              debug(`Fetching: ${fullUrl}`)
              return axios.get(fullUrl, { headers: requestHeaders })
            })
          )

          results.forEach(result => {
            if (result.status !== 'fulfilled') {
              debug(`Failed to fetch programme: ${result.reason}`)
              return
            }
            const res = result.value.data
            if (!res) return

            const $p = cheerio.load(res)

            const timeText = $p('center > h5 > b').text().trim()
            if (!timeText) return

            const title = parseText($p('.inner-heading.sub h2'))
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
                const cast = { name: parseText($p(el).find('a')) }
                const match = $p(el).text().match(/\((.*?)\)/)
                if (match && match[1]) {
                  cast.role = match[1].trim()
                }
                return cast
              })
              .filter(c => c.name)

            const [start, stop] = parseStartStop(date, timeText)

            let subTitle = null
            let season, episode

            if (subTitleRaw) {
              // subTitle may be "Past and Pressure\nSeason 6, Episode 5" or "Past and Pressure Season 6, Episode 5"
              const cleaned = subTitleRaw.replace(/\s+/g, ' ').trim()
              const seMatch = cleaned.match(/Season\s+(\d+),\s+Episode\s+(\d+)/i)
              if (seMatch) {
                season = parseInt(seMatch[1])
                episode = parseInt(seMatch[2])
                // Remove season/episode from subtitle
                subTitle = cleaned.replace(/Season\s+\d+,\s+Episode\s+\d+/i, '').trim()
                if (!subTitle) subTitle = null
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
      }
    }

    // Sort programs by start time
    programs.sort((a, b) => a.start.valueOf() - b.start.valueOf())

    return programs
  },
  async channels() {
    const channels = {}

    try {
      // Step 1: Get providers from the form page
      const formRes = await axios.get('https://www.mytelly.co.uk/getform', {
        headers: requestHeaders
      })
      const $ = cheerio.load(formRes.data)
      const providers = $('#guide_provider option')
        .toArray()
        .map(el => $(el).attr('value'))
        .filter(Boolean)

      // Step 2: For each provider, get regions
      const regionPromises = providers.map(provider =>
        axios
          .get('https://www.mytelly.co.uk/getregions', {
            headers: { ...requestHeaders, provider }
          })
          .then(res => ({ provider, regions: res.data }))
          .catch(() => null)
      )
      const regionResults = await Promise.all(regionPromises)

      // Step 3: For each region, get schedule (POST)
      const schedulePromises = []
      const now = dayjs()

      for (const result of regionResults) {
        if (!result) continue
        const { provider, regions } = result
        if (!regions || typeof regions !== 'object') continue

        for (const r of Object.values(regions)) {
          const params = new URLSearchParams({
            provider,
            region: r.title,
            TVperiod: 'Night',
            date: now.format('YYYY-MM-DD'),
            st: 0,
            u_time: now.format('HHmm'),
            is_mobile: 1
          })
          schedulePromises.push(
            axios
              .post('https://www.mytelly.co.uk/tv-guide/schedule', params.toString(), {
                headers: {
                  ...requestHeaders,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-Requested-With': 'XMLHttpRequest'
                }
              })
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
  if (stop.isBefore(start)) {
    stop = stop.add(1, 'd')
  }
  return [start, stop]
}

function parseTime(date, time) {
  return dayjs.tz(`${date.format('YYYY-MM-DD')} ${time}`, 'YYYY-MM-DD h:mm a', tz)
}

function parseText($item) {
  if (!$item || !$item.text) return ''
  let text = $item.text().replace(/\t/g, '').replace(/\n/g, ' ').trim()
  while (text.includes('  ')) {
    text = text.replace(/  /g, ' ')
  }
  return text
}
