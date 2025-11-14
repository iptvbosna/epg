// tv.magenta.at.config.js
// Adapted to use Cloudflare Worker proxy like mts.rs config, simplified for single fetch per channel/day

const axios = require('axios')
const dayjs = require('dayjs')
const API_ENDPOINT = 'https://tv-at-prod.yo-digital.com/at-bifrost'
const WORKER_URL = 'https://sehara-magentaat.seharavip15.workers.dev' // Your deployed Worker URL

module.exports = {
  site: 'tv.magenta.at',
  days: 2,
  request: {
    maxContentLength: 50000000,
    timeout: 30000
  },
  url: function ({ channel, date }) {
    const targetUrl = `${API_ENDPOINT}/epg/channel/schedules/v2?station_ids=${
      channel.site_id
    }&date=${date.format('YYYY-MM-DD')}&hour_offset=0&hour_range=24&natco_code=at` // Full day in one call (0-23h)
    return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`
  },
  parser({ content, channel, date }) { // Simplified: no extra hourly fetches
    let programs = []
    if (!content) return programs
    let items = parseItems(JSON.parse(content), channel)
    if (!items.length) return programs
    // Process items synchronously or await details in loop
    for (let item of items) {
      const detail = loadProgramDetails(item) // Make sync if possible, but keep async
      programs.push({
        title: item.description,
        description: parseDescription(detail),
        date: parseDate(item),
        category: parseCategory(item),
        image: detail.poster_image_url,
        actors: parseRoles(detail, 'Schauspieler'),
        directors: parseRoles(detail, 'Regisseur'),
        producers: parseRoles(detail, 'Produzent'),
        season: parseSeason(item),
        episode: parseEpisode(item),
        start: parseStart(item),
        stop: parseStop(item)
      })
    }
    return programs
  },
  async channels() {
    const targetUrl = `${API_ENDPOINT}/epg/channel?natco_code=at`
    const data = await axios
      .get(`${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`)
      .then(r => r.data)
      .catch(err => {
        console.error('Channel fetch error:', err.message)
        return null
      })
   
    if (!data || !data.channels) return []
   
    return Object.values(data.channels).map(item => ({ // Like MTS: map from products/channels
      lang: 'de',
      name: item.title,
      site_id: item.station_id
    }))
  }
}

// Make loadProgramDetails sync if no await needed, but keep async for safety
async function loadProgramDetails(item) {
  if (!item.program_id) return {}
  const targetUrl = `${API_ENDPOINT}/details/series/${item.program_id}?natco_code=at`
  const data = await axios
    .get(`${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`)
    .then(r => r.data)
    .catch(console.log)
  return data || {}
}

function parseDate(item) {
  return item && item.release_year ? item.release_year.toString() : null
}

function parseStart(item) {
  return dayjs(item.start_time)
}

function parseStop(item) {
  return dayjs(item.end_time)
}

function parseItems(data, channel) {
  if (!data || !data.channels) return []
  const channelData = data.channels[channel.site_id]
  if (!channelData) return []
  return channelData // Assumes array of programs
}

function parseCategory(item) {
  if (!item.genres) return null
  return item.genres.map(genre => genre.id)
}

function parseSeason(item) {
  if (item.season_display_number === 'Folgen') return null
  return item.season_number
}

function parseEpisode(item) {
  if (item.episode_number) return parseInt(item.episode_number)
  if (item.season_display_number === 'Folgen') return item.season_number
  return null
}

function parseDescription(item) {
  if (!item.details) return null
  return item.details.description
}

function parseRoles(item, role_name) {
  if (!item.roles) return null
  return item.roles.filter(role => role.role_name === role_name).map(role => role.person_name)
}
