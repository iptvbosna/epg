const cheerio = require('cheerio')
const dayjs = require('dayjs')
const axios = require('axios')
const WORKER_URL = 'https://red-water-3fc9.seharavip15.workers.dev'

// Helper za retry sa delay-om
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url, options)
      return response.data
    } catch (error) {
      if (i === maxRetries - 1) throw error
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, i) * 1000
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

module.exports = {
  site: 'tvprofil.com',
  days: 2,
  url: function ({ channel, date }) {
    const parts = channel.site_id.split('#')
    const query = buildQuery(parts[1], date)
    const targetUrl = `https://tvprofil.com/${parts[0]}/program/?${query}`
    
    return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`
  },
  request: {
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'referer': 'https://tvprofil.com/tvprogram/',
      'accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
      'accept-language': 'en-US,en;q=0.9,bs;q=0.8,hr;q=0.7',
    }
  },
  parser: function ({ content }) {
    let programs = []
    const items = parseItems(content)
    items.forEach(item => {
      const $ = cheerio.load(item)
      $('div.row').each((_, el) => {
        const $item = $(el)
        const title = parseTitle($item)
        const category = parseCategory($item)
        const start = parseStart($item)
        const duration = parseDuration($item)
        const stop = start.add(duration, 's')
        const icon = parseImage($item)

        programs.push({ title, category, start, stop, icon })
      })
    })

    return programs
  },
  async channels() {
    // prettier-ignore
    const countries = {
      ba: { channelsPath: '/ba', progsPath: 'ba/tvprogram', lang: 'bs' },
      hr: { channelsPath: '',    progsPath: 'tvprogram', lang: 'hr' },
      rs: { channelsPath: '/rs', progsPath: 'rs/tvprogram', lang: 'sr' },
      me: { channelsPath: '/me', progsPath: 'me/tvprogram', lang: 'en' },
      si: { channelsPath: '/si', progsPath: 'si/tvspored', lang: 'sl' },
      mk: { channelsPath: '/mk', progsPath: 'mk/tv-raspored', lang: 'mk' },
      al: { channelsPath: '/al', progsPath: 'al/programaconi', lang: 'sq' },
      bg: { channelsPath: '/bg', progsPath: 'bg/tv-programa', lang: 'bg' },
      ro: { channelsPath: '/ro', progsPath: 'ro/program-tv', lang: 'ro' },
      // Dodaj druge zemlje po potrebi
    }

    let channels = []
    for (let country in countries) {
      const config = countries[country]
      const lang = config.lang

      const targetUrl = `https://tvprofil.com${config.channelsPath}/channels/getChannels/`
      const url = `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}&callback=cb`

      console.log(`Fetching channels for ${country}...`)

      try {
        const cb = await fetchWithRetry(url, {
          headers: {
            'x-requested-with': 'XMLHttpRequest',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'referer': 'https://tvprofil.com/programtv/',
            'accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
            'accept-language': 'en-US,en;q=0.9',
          }
        })

        if (!cb) {
          console.error(`No data for ${country}`)
          continue
        }

        const [, json] = cb.match(/^cb\((.*)\)$/i) || [null, null]
        if (!json) {
          console.error(`Invalid callback format for ${country}`)
          continue
        }

        const data = JSON.parse(json)

        if (data.data && Array.isArray(data.data)) {
          data.data.forEach(group => {
            if (group.channels && Array.isArray(group.channels)) {
              group.channels.forEach(item => {
                channels.push({
                  lang,
                  site_id: `${config.progsPath}#${item.urlID}`,
                  xmltv_id: `${item.title.replaceAll(/[ '&]/g, '')}.${country}`,
                  name: item.title
                })
              })
            }
          })
        }

        console.log(`✓ Found ${data.data?.length || 0} groups for ${country}`)
        
      } catch (err) {
        console.error(`Failed to fetch ${country}:`, err.message)
      }

      // Delay između requesta (500ms-1s)
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500))
    }

    return channels
  }
}

function parseImage($item) {
  return $item.attr('data-image') || null
}

function parseDuration($item) {
  return parseInt($item.attr('data-len'))
}

function parseStart($item) {
  const timestamp = parseInt($item.attr('data-ts'))
  return dayjs.unix(timestamp)
}

function parseCategory($item) {
  return $item.find('.col:nth-child(2) > small').text() || null
}

function parseTitle($item) {
  let title = $item.find('.col:nth-child(2) > a').text()
  title += $item.find('.col:nth-child(2)').clone().children().remove().end().text()

  return title.replace('®', '').trim().replace(/,$/, '')
}

function parseItems(content) {
  let data = (content.match(/^[^(]+\(([\s\S]*)\)$/) || [null, null])[1]
  if (!data) return []
  let json = JSON.parse(data)
  if (!json || !json.data || !json.data.program) return []

  return [json.data.program]
}

function buildQuery(site_id, date) {
  const query = {
    datum: date.format('YYYY-MM-DD'),
    kanal: site_id
  }

  let c = 4
  let a = query.datum + query.kanal + c
  let ua = query.kanal + query.datum

  if (
    typeof ua === 'undefined' ||
    ua === null ||
    ua === '' ||
    ua === 0 ||
    ua === '0' ||
    ua !== ua
  ) {
    ua = 'none'
  }

  for (let j = 0; j < ua.length; j++) c += ua.charCodeAt(j)

  let i = a.length
  let b = 2
  while (i--) {
    b += (a.charCodeAt(i) + c * 2) * i
  }

  b = b.toString()
  const lastCharCode = b.charCodeAt(b.length - 1)
  const key = 'b' + lastCharCode
  query['callback'] = `tvprogramit${lastCharCode}`
  query[key] = b

  return new URLSearchParams(query).toString()
}
