const axios = require('axios')
const cheerio = require('cheerio')
const dayjs = require('dayjs')

// Cloudflare Worker URL za proxy
const WORKER_URL = 'https://moviestarplus.seharavip15.workers.dev'

module.exports = {
  site: 'movistarplus.es',
  days: 2,
  
  url({ channel, date }) {
    const targetUrl = `https://www.movistarplus.es/programacion-tv/${channel.site_id}/${date.format('YYYY-MM-DD')}`
    
    // Koristi Cloudflare Worker kao proxy
    return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`
  },
  
  request: {
    maxContentLength: 50000000,
    timeout: 30000
  },
  
  async parser({ content }) {
    let programs = []
    let items = parseItems(content)
    
    if (!items.length) return programs
    
    const $ = cheerio.load(content)
    const programElements = $('div[id^="ele-"]').get()
    
    for (let i = 0; i < items.length; i++) {
      const el = items[i]
      let description = null
      
      if (programElements[i]) {
        const programDiv = $(programElements[i])
        const programLink = programDiv.find('a').attr('href')
        
        if (programLink) {
          const idMatch = programLink.match(/id=(\d+)/)
          if (idMatch && idMatch[1]) {
            description = await getProgramDescription(programLink).catch(() => null)
          }
        }
      }
      
      programs.push({
        title: el.item.name,
        description: description,
        start: dayjs(el.item.startDate),
        stop: dayjs(el.item.endDate)
      })
    }
    
    return programs
  },
  
  async channels() {
    const targetUrl = 'https://www.movistarplus.es/programacion-tv'
    const proxyUrl = `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`
    
    const html = await axios
      .get(proxyUrl)
      .then(r => r.data)
      .catch(err => {
        console.error('Channel fetch error:', err.message)
        return null
      })
    
    if (!html) return []
    
    const $ = cheerio.load(html)
    let scheme = $('script:contains(ItemList)').html()
    
    if (!scheme) return []
    
    try {
      scheme = JSON.parse(scheme)
      
      return scheme.itemListElement.map(el => {
        const urlParts = el.item.url.split('/')
        const site_id = urlParts.pop().toLowerCase()
        
        return {
          lang: 'es',
          name: el.item.name,
          site_id
        }
      })
    } catch (err) {
      console.error('Channel parse error:', err.message)
      return []
    }
  }
}

function parseItems(content) {
  try {
    const $ = cheerio.load(content)
    let scheme = $('script:contains("@type": "ItemList")').html()
    
    if (!scheme) return []
    
    scheme = JSON.parse(scheme)
    
    if (!scheme || !Array.isArray(scheme.itemListElement)) return []
    
    return scheme.itemListElement
  } catch {
    return []
  }
}

async function getProgramDescription(programUrl) {
  try {
    // Provjeri da li je URL potpun
    if (!programUrl.startsWith('http')) {
      programUrl = `https://www.movistarplus.es${programUrl}`
    }
    
    const proxyUrl = `${WORKER_URL}?url=${encodeURIComponent(programUrl)}`
    
    const response = await axios.get(proxyUrl, {
      timeout: 10000,
      headers: {
        'Referer': 'https://www.movistarplus.es/programacion-tv/'
      }
    })
    
    const $ = cheerio.load(response.data)
    const description = $('.show-content .text p').first().text().trim() || null
    
    return description
  } catch (error) {
    console.error(`Error fetching description from ${programUrl}:`, error.message)
    return null
  }
}
