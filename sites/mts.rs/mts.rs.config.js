const axios = require('axios')
const dayjs = require('dayjs')
const { SocksProxyAgent } = require('socks-proxy-agent')
const HttpsProxyAgent = require('https-proxy-agent')

// Lista proxy servera za rotaciju
const proxies = [
  'socks5://103.152.112.162:1080',
  'socks5://168.119.53.93:10000',
  'http://51.158.68.68:8811',
  'http://103.152.112.162:80',
  null // Bez proxy-ja kao backup
]

let currentProxyIndex = 0

function getProxyAgent() {
  const proxy = proxies[currentProxyIndex]
  currentProxyIndex = (currentProxyIndex + 1) % proxies.length
  
  if (!proxy) return {}
  
  if (proxy.startsWith('socks')) {
    const agent = new SocksProxyAgent(proxy)
    return { httpAgent: agent, httpsAgent: agent }
  } else {
    const agent = new HttpsProxyAgent(proxy)
    return { httpsAgent: agent }
  }
}

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
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
    const proxyConfig = getProxyAgent()
    const config = { ...module.exports.request, ...proxyConfig }
    
    const data = await axios
      .get(module.exports.url({ date: dayjs() }), config)
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
