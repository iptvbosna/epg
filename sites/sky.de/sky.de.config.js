
const dayjs = require('dayjs')
const axios = require('axios')

const HAWK_API = 'https://awk.epgsky.com/hawk/linear'
const TERRITORY = 'DE'
const BATCH_SIZE = 20

module.exports = {
  site: 'sky.de',
  days: 2,

  url: HAWK_API,

  request: {
    method: 'GET',
    headers: {
      'X-SkyOTT-Territory': TERRITORY,
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  },

  async channels() {
    return []
  },

  async fetchSchedule(sids, date) {
    const dateString = dayjs(date).format('YYYYMMDD')

    const response = await axios.get(
      `${HAWK_API}/schedule/${dateString}/${sids.join(',')}`,
      {
        headers: {
          'X-SkyOTT-Territory': TERRITORY,
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 30000
      }
    )

    return response.data
  },

  async grabber({ channel, date }) {
    const sid = String(channel.site_id || '').replace(/^DE#/, '')

    if (!sid || sid === '0') return []

    const data = await this.fetchSchedule([sid], date)

    return parseSchedule(data, sid)
  },

  parser({ content, channel }) {
    const sid = String(channel.site_id || '').replace(/^DE#/, '')

    if (!sid || sid === '0') return []

    let data = content

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (error) {
        return []
      }
    }

    return parseSchedule(data, sid)
  }
}

function parseSchedule(data, sid) {
  const programs = []

  if (!data || typeof data !== 'object') return programs

  const root = data.schedule || data

  function collect(value) {
    if (!value) return

    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }

    if (typeof value !== 'object') return

    if (
      value.st !== undefined &&
      value.d !== undefined &&
      value.t
    ) {
      const start = Number(value.st)
      const duration = Number(value.d)

      if (
        Number.isFinite(start) &&
        Number.isFinite(duration) &&
        duration > 0
      ) {
        programs.push({
          title: value.t,
          description: value.sy || '',
          start: dayjs.unix(start),
          stop: dayjs.unix(start + duration),
          season: value.seasonnumber || null,
          episode: value.episodenumber || null,
          category: value.g || null,
          image: null
        })
      }

      return
    }

    Object.values(value).forEach(collect)
  }

  collect(root)

  return programs.sort(
    (a, b) => a.start.valueOf() - b.start.valueOf()
  )
}
