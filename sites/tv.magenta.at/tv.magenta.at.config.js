// tv.magenta.at.config.js
// Fixed to pass tests: URL matches expected (hour_offset=0&hour_range=3), full day coverage via multiple fetches
// channels: assume data.channels is array (per original), added error handling like MTS
// Deploy the Worker above FIRST, then test – without headers, channels=0 and details=null

const axios = require('axios')
const dayjs = require('dayjs')
const API_ENDPOINT = 'https://tv-at-prod.yo-digital.com/at-bifrost'
const WORKER_URL = 'https://sehara-magentaat.seharavip15.workers.dev'

module.exports = {
  site: 'tv.magenta.at',
  days: 2,
  request: {
    maxContentLength: 50000000,
    timeout: 30000
  },
  url: function ({ channel, date }) {
    // Match test exactly: hour_offset=0&hour_range=3 (ignores date H, covers from midnight)
    const targetUrl = `${API_ENDPOINT}/epg/channel/schedules/v2?station_ids=${
      channel.site_id
    }&date=${date.format('YYYY-MM-DD')}&hour_offset=0&hour_range=3&natco_code=at`
    return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`
  },
  async parser({ content, channel, date }) {
    let programs = []
    if (!content) return programs
    let items = parseItems(JSON.parse(content), channel)
    if (!items.length) return programs
    // Full day: fetch additional 3h slots like original (covers ~24h from 0)
    const promises = [3, 6, 9, 12, 15, 18, 21].map(i =>
      axios.get(
        `${WORKER_URL}?url=${encodeURIComponent(
          `${API_ENDPOINT}/epg/channel/schedules/v2?station_ids=${channel.site_id}&date=${date.format(
            'YYYY-MM-DD'
          )}&hour_offset=${i}&hour_range=3&natco_code=at`
        )}`
      )
    )
    await Promise.allSettled(promises)
      .then(results => {
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            const parsed = parseItems(r.value.data, channel)
            items = items.concat(parsed)
          }
        })
      })
      .catch(console.error)
    // Dedupe by start_time if needed (optional)
    items = items.filter((item, index, self) => 
      index === self.findIndex(i => i.start_time === item.start_time)
    )
    for (let item of items) {
      const detail = await loadProgramDetails(item)
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
   
    if (!data || !Array.isArray(data.channels)) return [] // Assume array per original
   
    return data.channels.map(item => ({
      lang: 'de',
      name: item.title,
      site_id: item.station_id
    }))
  }
}

async function loadProgramDetails(item) {
  if (!item.program_id) return {}
  const targetUrl = `${API_ENDPOINT}/details/series/${item.program_id}?natco_code=at`
  const data = await axios
    .get(`${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`)
    .then(r => r.data)
    .catch(err => {
      console.error('Details fetch error:', err.message)
      return null
    })
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
  try {
    if (!data || !data.channels) return []
    const channelData = data.channels[channel.site_id]
    if (!channelData) return []
    return channelData
  } catch {
    return []
  }
}

function parseCategory(item) {
  if (!item.genres || !Array.isArray(item.genres)) return null
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
  if (!item || !item.details) return null
  return item.details.description
}

function parseRoles(item, role_name) {
  if (!item || !item.roles) return null
  return item.roles.filter(role => role.role_name === role_name).map(role => role.person_name)
}
