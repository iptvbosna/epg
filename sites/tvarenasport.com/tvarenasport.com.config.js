const puppeteer = require('puppeteer')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const TIMEZONE = 'Europe/Belgrade'
const CHANNEL_LOGO_REGEX = /chanel-([\w-]+?)\.png/

module.exports = {
  site: 'tvarenasport.com',
  tz: TIMEZONE,
  lang: 'sr',
  days: 2,
  
  request: {
    cache: {
      ttl: 24 * 60 * 60 * 1000 // 1 day
    }
  },
  
  url: 'https://www.tvarenasport.com/tv-scheme',
  
  async parser({ channel, date }) {
    const programs = []
    const expectedDate = date.format('YYYY-MM-DD')
    
    console.log(`Fetching data for ${channel.name} on ${expectedDate}...`)
    
    let browser
    try {
      browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      })
      
      const page = await browser.newPage()
      
      // Blokiraj slike i fontove za brže učitavanje
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        if(['image', 'stylesheet', 'font'].includes(req.resourceType())){
          req.abort()
        } else {
          req.continue()
        }
      })
      
      console.log('Opening page...')
      await page.goto(this.url, { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      })
      
      console.log('Waiting for content to load...')
      await page.waitForSelector('.tv-scheme-chanel', { timeout: 30000 })
      
      // Sačekaj da se JavaScript izvrši
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      const html = await page.content()
      
      // Parse HTML
      const cheerio = require('cheerio')
      const $ = cheerio.load(html)
      
      $('.tv-scheme-chanel').each((_, el) => {
        const $ch = $(el)
        const logo = $ch.find('.tv-scheme-chanel-header img').attr('src') || ''
        const m = logo.match(CHANNEL_LOGO_REGEX)
        
        if (!m || m[1] !== channel.site_id) return
        
        console.log(`Found channel: ${channel.name}`)
        
        // Pronađi datume
        const dates = $ch.find('.tv-scheme-days a, .tv-scheme-new-days-item').map((i, d) => {
          const t = $(d).find('span').last().text().trim()
          if (!t || t.length < 5) return null
          return dayjs(`${t}.${date.year()}`, 'DD.MM.YYYY')
        }).get().filter(d => d)
        
        console.log(`Found ${dates.length} dates`)
        
        const startIdx = dates.findIndex(d => d && d.format('YYYY-MM-DD') === expectedDate)
        if (startIdx === -1) {
          console.log(`Date ${expectedDate} not found in schedule`)
          return
        }
        
        console.log(`Using date index: ${startIdx}`)
        
        const sliders = $ch.find('.tv-scheme-new-slider-item')
        const slider = sliders.eq(startIdx)
        
        if (!slider.length) {
          console.log('Slider not found')
          return
        }
        
        let entries = parseSchedules($, slider, dates[startIdx])
        console.log(`Found ${entries.length} programs`)
        
        entries.forEach((e, i) => {
          const nxt = entries[i + 1]
          e.stop = nxt
            ? nxt.start
            : dayjs.tz(`${expectedDate} 23:59`, 'YYYY-MM-DD HH:mm', TIMEZONE)
        })
        
        programs.push(...entries)
      })
      
    } catch (error) {
      console.error('Puppeteer error:', error.message)
    } finally {
      if (browser) {
        await browser.close()
      }
    }
    
    return programs
  },
  
  async channels() {
    let browser
    try {
      browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      })
      
      const page = await browser.newPage()
      
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        if(['image', 'stylesheet', 'font'].includes(req.resourceType())){
          req.abort()
        } else {
          req.continue()
        }
      })
      
      await page.goto(this.url, { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      })
      
      await page.waitForSelector('.tv-scheme-chanel', { timeout: 30000 })
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      const html = await page.content()
      const cheerio = require('cheerio')
      const $ = cheerio.load(html)
      
      const channels = $('.tv-scheme-chanel-header img')
        .map((_, img) => {
          const src = $(img).attr('src') || ''
          const m = src.match(CHANNEL_LOGO_REGEX)
          if (!m) return null
          
          const id = m[1]
          const displayName = getDisplayName(id)
          const xmltvId = displayName.replaceAll(' ', '').replace(/Serbia$/, '.rs')
          const logourl = `https://www.${this.site}${src}`
          
          return { 
            site_id: id, 
            lang: this.lang, 
            xmltv_id: xmltvId, 
            name: displayName, 
            logo: logourl 
          }
        })
        .get()
      
      await browser.close()
      return channels
      
    } catch (error) {
      console.error('Error fetching channels:', error.message)
      if (browser) await browser.close()
      return []
    }
  }
}

function getDisplayName(id) {
  const template = name => `Arena Sport ${name} Serbia`
  let m
  
  if ((m = /^0*(\d+)$/.exec(id))) return template(m[1])
  if ((m = /^a+(\d+)p$/.exec(id))) return template(`${m[1]} Premium`)
  
  const formattedId = id.replace(/^a-/, '').replace(/^./, c => c.toUpperCase())
  return template(formattedId)
}

function parseSchedules($, $slider, date) {
  return $slider
    .find('.slider-content')
    .map((_, el) => parseSchedule($, $(el), date))
    .get()
    .filter(p => p !== null)
}

function parseSchedule($, $s, date) {
  try {
    const time = $s.find('.slider-content-top span').text().trim()
    if (!time) return null
    
    const start = dayjs.tz(`${date.format('YYYY-MM-DD')} ${time}`, 'YYYY-MM-DD HH:mm', TIMEZONE)
    if (!start.isValid()) return null
    
    const sport = $s.find('.slider-content-middle span').text().trim()
    const titleText = $s.find('.slider-content-bottom p').text().trim()
    if (!titleText) return null
    
    const league = $s.find('.slider-content-bottom span')
      .not('.live-title, .blob-text, .blob-border, .blob').first().text().trim()
    const isLive = $s.find('.blob-text').text().trim().toLowerCase() === 'uživo'
    const title = (isLive ? '(Uživo) ' : '') + (league ? `${league}: ${titleText}` : titleText)
    
    return { title, category: sport, start }
  } catch (e) {
    return null
  }
}
