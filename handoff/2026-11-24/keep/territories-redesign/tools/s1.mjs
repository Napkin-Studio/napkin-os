import { open } from './lib.mjs'
const { b, page, F } = await open()
console.log(page.frames().map(f => f.url().slice(0, 100)))
await page.screenshot({ path: '../shots/01-arrived-1280.png' })
await b.close()
