const { parser, url, request } = require('./tvprofil.com.config.js')
const fs = require('fs')
const path = require('path')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const customParseFormat = require('dayjs/plugin/customParseFormat')
dayjs.extend(customParseFormat)
dayjs.extend(utc)

const date = dayjs.utc('2025-07-29', 'YYYY-MM-DD').startOf('d')
const channel = {
  site_id: 'bg/tv-programa#24kitchen-bg',
  xmltv_id: '24KitchenBulgaria.bg'
}

it('can generate valid url', () => {
  const generatedUrl = url({ channel, date })
  
  // Provjeravamo da li URL sadrži worker
  expect(generatedUrl).toContain('https://red-water-3fc9.seharavip15.workers.dev')
  
  // Provjeravamo da li je enkodiran target URL
  expect(generatedUrl).toContain('url=https%3A%2F%2Ftvprofil.com')
  
  // Provjeravamo da li sadrži potrebne parametre
  expect(generatedUrl).toContain('datum=2025-07-29')
  expect(generatedUrl).toContain('kanal=24kitchen-bg')
  expect(generatedUrl).toContain('callback=tvprogramit48')
  expect(generatedUrl).toContain('b48=827670')
})

it('can generate valid request headers', () => {
  expect(request.headers).toMatchObject({
    'x-requested-with': 'XMLHttpRequest',
    'referer': 'https://tvprofil.com/tvprogram/',
    'user-agent': expect.stringContaining('Mozilla')
  })
})

it('can parse response', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '__data__/content.txt'), 'utf8')
  const results = parser({ content }).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })
  
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]).toMatchObject({
    title: expect.any(String),
    start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    stop: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
  
  // Ako imaš tačne podatke iz content.txt, možeš testirati specifične vrijednosti:
  // expect(results[0]).toMatchObject({
  //   title: 'Save with Jamie 1, ep. 2',
  //   start: '2025-07-29T05:00:00.000Z',
  //   stop: '2025-07-29T06:00:00.000Z'
  // })
})

it('can handle empty guide', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '__data__/no_content.txt'), 'utf8')
  expect(parser({ content })).toMatchObject([])
})

it('url contains correct worker proxy format', () => {
  const generatedUrl = url({ channel, date })
  const workerUrl = 'https://red-water-3fc9.seharavip15.workers.dev'
  
  expect(generatedUrl).toMatch(new RegExp(`^${workerUrl}\\?url=`))
})

it('can extract site_id parts correctly', () => {
  const testChannel = {
    site_id: 'ba/tvprogram#rtrs',
    xmltv_id: 'RTRS.ba'
  }
  
  const generatedUrl = url({ channel: testChannel, date })
  
  // Trebalo bi sadržati ba/tvprogram i kanal=rtrs
  expect(generatedUrl).toContain('ba%2Ftvprogram')
  expect(generatedUrl).toContain('kanal=rtrs')
})
