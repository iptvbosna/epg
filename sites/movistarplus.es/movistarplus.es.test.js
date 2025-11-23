const { parser, url } = require('./movistarplus.es.config.js')
const fs = require('fs')
const path = require('path')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(customParseFormat)
dayjs.extend(utc)

const axios = require('axios')
jest.mock('axios')

const date = dayjs.utc('2025-05-30', 'YYYY-MM-DD').startOf('d')
const channel = {
  site_id: 'sexta',
  xmltv_id: 'LaSexta.es'
}

// Worker URL iz config-a
const WORKER_URL = 'https://moviestarplus.seharavip15.workers.dev'

it('can generate valid url', () => {
  const generatedUrl = url({ channel, date })
  
  // Provjeri da URL sadrži Worker i enkodiran originalni URL
  expect(generatedUrl).toContain(WORKER_URL)
  expect(generatedUrl).toContain('https%3A%2F%2Fwww.movistarplus.es')
  expect(generatedUrl).toContain('sexta')
  expect(generatedUrl).toContain('2025-05-30')
  
  // Ili provjeri kompletan URL
  expect(generatedUrl).toBe(
    `${WORKER_URL}?url=${encodeURIComponent('https://www.movistarplus.es/programacion-tv/sexta/2025-05-30')}`
  )
})

it('can parse response', async () => {
  const content = fs.readFileSync(path.resolve(__dirname, '__data__/content.html'))
  
  axios.get.mockImplementation(url => {
    // Provjeri da li je Worker URL sa enkodiranim program1 linkom
    if (url.includes(encodeURIComponent('https://www.movistarplus.es/entretenimiento/venta-prime-t1/ficha?tipo=E&id=3414523'))) {
      return Promise.resolve({
        data: fs.readFileSync(path.resolve(__dirname, '__data__/program1.html'))
      })
    } 
    // Provjeri da li je Worker URL sa enkodiranim program2 linkom
    else if (url.includes(encodeURIComponent('https://www.movistarplus.es/deportes/programa/pokerstars-casino-1/ficha?tipo=E&id=2057641'))) {
      return Promise.resolve({
        data: fs.readFileSync(path.resolve(__dirname, '__data__/program2.html'))
      })
    } 
    else {
      return Promise.resolve({ data: '' })
    }
  })
  
  let results = await parser({ content, date })
  results = results.map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })
  
  expect(results.length).toBe(23)
  expect(results[0]).toMatchObject({
    start: '2025-05-30T03:15:00.000Z',
    stop: '2025-05-30T04:25:00.000Z',
    title: 'Venta Prime',
    description: 'Espacio de televenta.'
  })
  expect(results[19]).toMatchObject({
    start: '2025-05-31T00:45:00.000Z',
    stop: '2025-05-31T01:25:00.000Z',
    title: 'Pokerstars casino',
    description: 'El programa trae cada día toda la emoción de su ruleta en vivo, Spin & Win, una versión exclusiva del clásico juego de casino.'
  })
})

it('can handle empty guide', async () => {
  const results = await parser({
    date,
    channel,
    content: '[]'
  })
  expect(results).toMatchObject([])
})
