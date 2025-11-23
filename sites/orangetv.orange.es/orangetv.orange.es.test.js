const { parser, url } = require('./orangetv.orange.es.config.js')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(customParseFormat)
dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2025-01-12', 'YYYY-MM-DD').startOf('d')
const channel = {
  site_id: '1010',
  xmltv_id: 'La1.es'
}

// Worker URL iz config-a
const WORKER_URL = 'https://orange-es.seharavip15.workers.dev'

axios.get.mockImplementation(url => {
  const result = {}
  
  // Mapiraj Worker URL-ove na lokalne data fajlove
  const urls = {
    [`${WORKER_URL}?url=${encodeURIComponent('https://epg.orangetv.orange.es/epg/Smartphone_Android/1_PRO/20250112_8h_1.json')}`]: 'data1.json',
    [`${WORKER_URL}?url=${encodeURIComponent('https://epg.orangetv.orange.es/epg/Smartphone_Android/1_PRO/20250112_8h_2.json')}`]: 'data2.json',
    [`${WORKER_URL}?url=${encodeURIComponent('https://epg.orangetv.orange.es/epg/Smartphone_Android/1_PRO/20250112_8h_3.json')}`]: 'data3.json',
  }
  
  if (urls[url] !== undefined) {
    result.data = fs.readFileSync(path.join(__dirname, '__data__', urls[url])).toString()
    if (!urls[url].startsWith('data1')) {
      result.data = JSON.parse(result.data)
    }
  }
  
  return Promise.resolve(result)
})

it('can generate valid url', () => {
  const generatedUrl = url({ date })
  
  // Provjeri da URL sadrži Worker i enkodiran originalni URL
  expect(generatedUrl).toContain(WORKER_URL)
  expect(generatedUrl).toContain('https%3A%2F%2Fepg.orangetv.orange.es')
  expect(generatedUrl).toContain('20250112_8h_1.json')
  
  // Ili provjeri kompletan URL
  expect(generatedUrl).toBe(
    `${WORKER_URL}?url=${encodeURIComponent('https://epg.orangetv.orange.es/epg/Smartphone_Android/1_PRO/20250112_8h_1.json')}`
  )
})

it('can parse response', async () => {
  const content = fs.readFileSync(path.join(__dirname, '__data__', 'data1.json')).toString()
  const results = (await parser({ content, channel, date })).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })
  
  expect(results.length).toBe(18)
  expect(results[0]).toMatchObject({
    start: '2025-01-11T22:55:00.000Z',
    stop: '2025-01-12T00:40:00.000Z',
    title: 'Una joven prometedora',
    description:
      'Cassie tenía un brillante futuro por delante. Sin embargo, un incidente provocó que no pudiese cumplir sus sueños. Con el paso del tiempo, tendrá la oportunidad de enmendar los errores del pasado.',
    category: ['Cine', 'Drama', 'Suspense'],
    icon: 'https://pc.orangetv.orange.es/pc/api/rtv/v1/images/epg/COVER/COVER_2247567.jpg'
  })
  expect(results[17]).toMatchObject({
    start: '2025-01-12T21:05:00.000Z',
    stop: '2025-01-12T23:05:00.000Z',
    title: 'Bake Off: Famosos al horno - T2, E01: Bake Off: Famosos al horno',
    sub_title: 'Bake Off: Famosos al horno',
    description:
      'Nervios y emoción en el debut de los 14 pasteleros de la nueva temporada de Bake off Famosos al horno. En el primer programa hornearán unas galletas dedicadas a sus mascotas y una tradicional tarta de queso.',
    category: ['Programa', 'Reality'],
    icon: 'https://pc.orangetv.orange.es/pc/api/rtv/v1/images/epg/COVER/COVER_3520028.jpg',
    season: 2,
    episode: 1
  })
})

it('can handle empty guide', async () => {
  const result = await parser({
    date,
    channel,
    content: '{}'
  })
  expect(result).toMatchObject([])
})
