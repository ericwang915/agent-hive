// One short video of a character from Gemini on the web, made from a reference picture.
// It drives a Chrome you started yourself with --remote-debugging-port=9333 and are signed in to Gemini in.
// usage: npm i playwright-core; node gemini_video.js "<prompt>" out.mp4 --ref still.jpg
const { chromium } = require('playwright-core')
const fs = require('fs')
;(async () => {
  const [prompt, out] = process.argv.slice(2), ref = process.argv[process.argv.indexOf('--ref') + 1]
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 60000 })
  const ctx = browser.contexts()[0]
  try {
    let page = ctx.pages().find(p => p.url().startsWith('https://gemini.google.com/')) || await ctx.newPage()
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' })
    const box = page.locator('rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"]').first()
    await box.waitFor({ timeout: 30000 }); await box.click()
    const item = page.locator('.cdk-overlay-container').getByText('Upload files', { exact: true })
    for (let k = 0; k < 4 && !(await item.isVisible().catch(() => false)); k++) {
      await page.waitForTimeout(1500)
      await page.locator('button[aria-label="Upload and tools"]').click({ force: true }).catch(() => {})
      await item.waitFor({ timeout: 4000 }).catch(() => {})
    }
    // what else the menu offers (to see whether there is a video tool)
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), item.click()])
    await fc.setFiles([ref])
    for (let t = 0; t < 40 && !(await page.locator('gem-media-attachment img').count()); t++) await page.waitForTimeout(1000)
    await page.waitForTimeout(1500)
    // choose the video tool, so the request is not answered with text
    try {
      await page.locator('button[aria-label="Upload and tools"]').click({ force: true, timeout: 5000 })
      await page.locator('.cdk-overlay-container').getByText('Create video', { exact: true }).click({ force: true, timeout: 6000 })
      console.log('tool: Create video')
    } catch (e) { console.log('tool: not chosen (' + e.message.split('\n')[0].slice(0, 80) + ')'); await page.keyboard.press('Escape').catch(() => {}) }
    await page.waitForTimeout(1500)
    const tryIt = page.locator('.cdk-overlay-container').getByText('Try it', { exact: true })      // the first-use card for the video tool
    if (await tryIt.isVisible().catch(() => false)) { await tryIt.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1000) }
    await box.click({ timeout: 10000 })
    await page.keyboard.insertText(prompt); await page.waitForTimeout(600); await page.keyboard.press('Enter')
    const t0 = Date.now(); let src = ''
    while (Date.now() - t0 < 420000 && !src) {
      await page.waitForTimeout(5000)
      const txt = await page.locator('model-response').last().innerText().catch(() => '')
      if (/can.t (create|generate)|reached|limit|try again|encountered an error|unable to/i.test(txt) && Date.now() - t0 > 20000 && !(await page.locator('model-response video').count())) { await page.screenshot({ path: out + '.fail.png' }).catch(() => {}); throw new Error('refused: ' + txt.replace(/\s+/g, ' ').slice(0, 300)) }
      src = await page.locator('model-response video').last().evaluate(v => v.currentSrc || v.src || (v.querySelector('source') || {}).src || '').catch(() => '')
    }
    if (!src) { await page.screenshot({ path: out + '.fail.png' }).catch(() => {}) }
    if (!src) throw new Error('no video; last reply: ' + (await page.locator('model-response').last().innerText().catch(() => '')).slice(0, 500))
    console.log('src', src.slice(0, 80))
    const r = await ctx.request.get(src, { timeout: 180000 })
    fs.writeFileSync(out, await r.body()); console.log(out, fs.statSync(out).size, page.url())
  } finally { await browser.close().catch(() => {}) }
})().catch(e => { console.error(e.message); process.exit(1) })
