cat > /var/www/html/epg/mts/epg/sites/mts.rs/mts.rs.config.js << 'EOF'
const axios = require('axios')
const dayjs = require('dayjs')

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
    timeout: 180000,
    proxy: {
      host: '185.162.235.244',
      port: 3128
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://mts.rs/',
      'Origin': 'https://mts.rs',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
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
    try {
      const data = await axios
        .get(module.exports.url({ date: dayjs() }), {
          ...module.exports.request
        })
        .then(r => r.data)
        .catch(err => {
          console.error('Error fetching channels:', err.message)
          throw err
        })
      
      if (!data || !data.products || !Array.isArray(data.products)) {
        console.error('Invalid response structure:', data)
        return []
      }
      
      return data.products.map(channel => ({
        lang: 'bs',
        name: channel.name,
        site_id: encodeURIComponent(channel.code)
      }))
    } catch (error) {
      console.error('Failed to fetch channels:', error.message)
      return []
    }
  }
}

function parseItems(content, channel) {
  try {
    const data = JSON.parse(content)
    if (!data || !Array.isArray(data.products)) {
      console.warn('No products found in response')
      return []
    }
    
    const channelData = data.products.find(c => c.code === channel.site_id)
    if (!channelData) {
      console.warn(`Channel ${channel.site_id} not found in response`)
      return []
    }
    
    if (!Array.isArray(channelData.programs)) {
      console.warn(`No programs found for channel ${channel.site_id}`)
      return []
    }
    
    return channelData.programs
  } catch (error) {
    console.error('Error parsing items:', error.message)
    return []
  }
}
EOF
