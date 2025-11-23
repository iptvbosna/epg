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
  
  url: 'https://www.tvarenasport.com/tv-scheme',
  
  async parser({ channel, date }) {
    const programs = []
    const expectedDate = date.format('YYYY-MM-DD')
    
    let browser
    try {
      browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })
      
      const page = await browser.newPage()
      await page.goto(this.url, { waitUntil: 'networkidle2', timeout: 60000 })
      await page.waitForSelector('.tv-scheme-chanel', { timeout: 30000 })
      await new Promise(r => setTimeout(r, 5000))
      
      const html = await page.content()
      const cheerio = require('cheerio')
      const $ = cheerio.load(html)
      
      $('.tv-scheme-chanel').each((_, el) => {
        const $ch = $(el)
        const logo = $ch.find('.tv-scheme-chanel-header img').attr('src') || ''
        const m = logo.match(CHANNEL_LOGO_REGEX)
        if (!m || m[1] !== channel.site_id) return
        
        const dates = $ch.find('.tv-scheme-days a, .tv-scheme-new-days-item').map((i, d) => {
          const t = $(d).find('span').last().text().trim()
          if (!t || t.length < 5) return null
          return dayjs(`${t}.${date.year()}`, 'DD.MM.YYYY')
        }).get().filter(d => d)
        
        const startIdx = dates.findIndex(d => d && d.format('YYYY-MM-DD') === expectedDate)
        if (startIdx === -1) return
        
        const slider = $ch.find('.tv-scheme-new-slider-item').eq(startIdx)
        if (!slider.length) return
        
        slider.find('.slider-content').each((_, s) => {
          const $s = $(s)
          const time = $s.find('.slider-content-top span').text().trim()
          if (!time) return
          
          const start = dayjs.tz(`${expectedDate} ${time}`, 'YYYY-MM-DD HH:mm', TIMEZONE)
          if (!start.isValid()) return
          
          const sport = $s.find('.slider-content-middle span').text().trim()
          const titleText = $s.find('.slider-content-bottom p').text().trim()
          if (!titleText) return
          
          const league = $s.find('.slider-content-bottom span').not('.live-title, .blob-text, .blob-border, .blob').first().text().trim()
          const isLive = $s.find('.blob-text').text().trim().toLowerCase() === 'uživo'
          const title = (isLive ? '(Uživo) ' : '') + (league ? `${league}: ${titleText}` : titleText)
          
          programs.push({ title, category: sport, start })
        })
      })
      
      programs.forEach((e, i) => {
        e.stop = programs[i + 1] ? programs[i + 1].start : dayjs.tz(`${expectedDate} 23:59`, 'YYYY-MM-DD HH:mm', TIMEZONE)
      })
      
    } catch (error) {
      console.error('Error:', error.message)
    } finally {
      if (browser) await browser.close()
    }
    
    return programs
  },
  
  async channels() {
    let browser
    try {
      browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      })
      
      const page = await browser.newPage()
      await page.goto(this.url, { waitUntil: 'networkidle2', timeout: 60000 })
      await page.waitForSelector('.tv-scheme-chanel', { timeout: 30000 })
      await new Promise(r => setTimeout(r, 3000))
      
      const html = await page.content()
      const cheerio = require('cheerio')
      const $ = cheerio.load(html)
      
      const channels = $('.tv-scheme-chanel-header img').map((_, img) => {
        const src = $(img).attr('src') || ''
        const m = src.match(CHANNEL_LOGO_REGEX)
        if (!m) return null
        
        const id = m[1]
        const name = getDisplayName(id)
        const xmltv_id = name.replaceAll(' ', '').replace(/Serbia$/, '.rs')
        const logo = `https://www.${this.site}${src}`
        
        return { site_id: id, lang: this.lang, xmltv_id, name, logo }
      }).get()
      
      await browser.close()
      return channels
    } catch (error) {
      console.error('Error:', error.message)
      if (browser) await browser.close()
      return []
    }
  }
}

function getDisplayName(id) {
  const t = n => `Arena Sport ${n} Serbia`
  let m
  if ((m = /^0*(\d+)$/.exec(id))) return t(m[1])
  if ((m = /^a+(\d+)p$/.exec(id))) return t(`${m[1]} Premium`)
  return t(id.replace(/^a-/, '').replace(/^./, c => c.toUpperCase()))
}
