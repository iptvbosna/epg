const axios = require('axios')
const dayjs = require('dayjs')
const HttpsProxyAgent = require('https-proxy-agent')

// PROBAJ OVE PROXY SERVERE JEDAN PO JEDAN:
const proxies = [
  'http://51.158.68.133:8811',           // Proxy 1
  'http://proxy.server.com:3128',        // Proxy 2
  'http://51.158.68.68:8811',            // Proxy 3
  'http://168.119.53.93:10000',          // Proxy 4
  'http://103.152.112.162:80'            // Proxy 5
]

const proxy = proxies[0] // <--- MIJENJAJ BROJ (0,1,2,3,4) I TESTAJ

module.exports = {
  site: 'mts.rs',
  days: 2,
  url({ date }) {
    return `https://mts.rs/hybris/ecommerce/b2c/v1/products/search?sort=pozicija-rastuce&searchQueryContext=CHANNEL_PROGRAM&query=:pozicija-rastuce:tip-kanala-radio:TV kanali:channelProgramDates:${date.format(
      'YYYY-MM-DD'
    )}&pageSize=10000`
  },
  request: {
    maxContentLength: 50000000,
    httpsAgent: new HttpsProxyAgent(proxy),
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  },
  parser({ content, channel }) {
    const items = parseItems(content, channel)
    return items.map(item => {
      return {
        title: item.title,
        category: item.category,
        description: item.description,
        image: item?.picture?.url || null,
        start: dayjs(item.start),
        stop: dayjs(item.end)
      }
    })
  },
  async channels() {
    const data = await axios
      .get(module.exports.url({ date: dayjs() }), module.exports.request)
      .then(r => r.data)
      .catch(err => {
        console.error('Channel fetch error:', err.message)
        return null
      })
    
    if (!data || !data.products) return []
    
    return data.products.map(channel => ({
      lang: 'bs',
      name: channel.name,
      site_id: encodeURIComponent(channel.code)
    }))
  }
}

function parseItems(content, channel) {
  try {
    const data = JSON.parse(content)
    if (!data || !Array.isArray(data.products)) return []
    const channelData = data.products.find(c => c.code === channel.site_id)
    if (!channelData || !Array.isArray(channelData.programs)) return []
    return channelData.programs
  } catch {
    return []
  }
}
