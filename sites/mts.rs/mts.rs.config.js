const axios = require('axios')
const dayjs = require('dayjs')
const HttpsProxyAgent = require('https-proxy-agent')

module.exports = {
  site: 'mts.rs',
  days: 2,
  url({ date }) {
    return `https://mts.rs/hybris/ecommerce/b2c/v1/products/search?sort=pozicija-rastuce&searchQueryContext=CHANNEL_PROGRAM&query=:pozicija-rastuce:tip-kanala-radio:TV kanali:channelProgramDates:${date.format(
      'YYYY-MM-DD'
    )}&pageSize=10000`
  },
  request: {
    maxContentLength: 50000000, // 50 Mb
    httpsAgent: new HttpsProxyAgent('http://proxy.toolip.io:31112'), // BESPLATNI PROXY
    timeout: 30000
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
      .catch(console.error)
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
