// Walk the Storyline course slide by slide, answer the quiz, then print the results page to PDF.
// Usage: node run.js <outDir> [name for results page] [dwellMs] [quiz]
//   Pass "quiz" as the last argument to jump straight to the quiz (for testing).
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2] || 'output';
const userName = process.argv[3] || '';
const dwellMs = Number(process.argv[4] || 8000);
const startAtQuiz = process.argv[5] === 'quiz';
fs.mkdirSync(out, { recursive: true });
const URL = 'https://wisha-training.lni.wa.gov/Training/articulate/BBPathogens/story.html';
const ANSWERS = [
  [/not considered OPIM/i, /^Tears$/i],
  [/test positive for HIV/i, /anti-retroviral drug treatment immediately/i],
  [/splashes in your eyes/i, /^Wash out your eyes with clean water and schedule/i],
  [/not need to wear gloves/i, /room occupied by an HIV-positive/i],
  [/What are Universal Precautions/i, /^Treating all blood/i],
];
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(out + '/run.log', s + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await sleep(6000);
  await page.click('#mobile-start-button');
  await sleep(3000);

  // Visible text of the current slide, read from Storyline's accessibility layer.
  const state = () => page.evaluate(() => {
    const sel = document.querySelector('#outline-content .cs-selected');
    const acc = [...document.querySelectorAll('.acc-shadow-el')]
      .map(e => (e.getAttribute('aria-label') || e.innerText || '').trim())
      .filter(t => t && !/\.(png|jpg)$/i.test(t) && !/^(Pause|Replay|Resume|Closed Captioning( Off)?|Previous|Next|Submit)( Button)?$/i.test(t));
    return { menu: sel ? sel.innerText.trim().split('\n')[0].replace(/ visited$/, '') : '', text: [...new Set(acc)] };
  });
  // Click the on-slide object behind an accessibility element whose label matches `re`.
  const clickAcc = async (re) => {
    const id = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const label = e => (e.getAttribute('aria-label') || e.innerText || '').trim();
      for (const e of document.querySelectorAll('.acc-shadow-el')) {
        if (!r.test(label(e)) || e.disabled) continue;
        // Quiz choices are a wrapper div holding the radio input; click the on-slide choice for those.
        const radio = e.matches('input[type=radio]') ? e : e.querySelector('input[type=radio]');
        const m = (radio?.id || '').match(/^acc-([A-Za-z0-9]+)/);
        if (m && document.querySelector(`[data-model-id="${m[1]}"]`)) return m[1];
        e.click();
        return '';
      }
      return null;
    }, re.source);
    if (id === null) return false;
    if (id) {
      const box = await page.locator(`[data-model-id="${id}"]`).first().boundingBox();
      await page.mouse.click(box.x + Math.min(60, box.width / 2), box.y + box.height / 2);
    }
    return true;
  };
  const LEAF = '#outline-content li:not(:has(ul))';
  const menuItems = () => page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .map((li, idx) => { const l = li.innerText.trim().split('\n'); return { idx, title: l[0].replace(/ visited$/, ''), visited: l.some(x => / visited$/.test(x)), shown: li.getClientRects().length > 0 }; }), LEAF);
  // Click a menu row by title (the row itself: its hidden "visited" label overlaps the link text).
  const gotoMenu = async (title) => {
    const item = (await menuItems()).find(i => i.title === title);
    await page.locator(LEAF).nth(item.idx).click();
    await sleep(dwellMs);
  };

  const transcript = [];
  const record = async (tag) => {
    const s = await state();
    await page.screenshot({ path: `${out}/${tag}.png` });
    log(`[${tag}] ${s.menu} :: ${s.text.join(' / ').slice(0, 220)}`);
    transcript.push({ tag, menu: s.menu, text: s.text });
    fs.writeFileSync(out + '/transcript.json', JSON.stringify(transcript, null, 1));
    return s;
  };

  if (startAtQuiz) { await gotoMenu('Question time'); }
  // SWEEP_LIMIT=<n> with the quiz shortcut exercises the menu sweep on n slides (testing).
  const sweepLimit = Number(process.env.SWEEP_LIMIT || Infinity);
  let n = 0, quizIdx = 0, lastKey = '', stuck = 0, sweptMenu = startAtQuiz && !process.env.SWEEP_LIMIT;
  while (n < 120) {
    n++;
    await sleep(dwellMs);
    const tag = String(n).padStart(2, '0');
    const s = await record(tag);
    const all = s.text.join(' \n ');
    const key = s.menu + '|' + all.slice(0, 300);
    if (key === lastKey) { if (++stuck >= 3) { log('stuck; stopping'); break; } } else stuck = 0;
    lastKey = key;

    // Before the quiz, visit any menu slides the linear path skipped (scenario branches).
    if (!sweptMenu && /Quiz and question time/i.test(all)) {
      sweptMenu = true;
      // Items in collapsed sections (the opening slide) are hidden and do not report their visited state.
      const missed = (await menuItems()).filter(i => i.shown && !i.visited && !/Question time/i.test(i.title)).slice(0, sweepLimit);
      log('unvisited menu slides:', JSON.stringify(missed.map(i => i.title)));
      for (const i of missed) {
        try { await page.locator(LEAF).nth(i.idx).click({ timeout: 10000 }); }
        catch (e) { log(`   could not open menu slide "${i.title}": ${e.message.split('\n')[0]}`); continue; }
        await sleep(dwellMs);
        await record(`${tag}-${i.title.replace(/\W+/g, '_')}`);
      }
      if (missed.length) { await gotoMenu('Question time'); await record(`${tag}-back`); }
    }

    if (/Results/.test(all) && /Your Score|Passing Score/i.test(all)) {
      const sc = await page.evaluate(() => document.body.innerText);
      const passed = /Congratulations, you passed/i.test(all) ? 'PASSED' : (/did not pass/i.test(all) ? 'NOT PASSED' : 'unknown');
      log('RESULTS slide reached:', passed);
      fs.writeFileSync(out + '/results-slide.txt', sc);
      if (!userName) break;
      await clickAcc(/^Print results$/);
      await sleep(3000);
      await page.screenshot({ path: `${out}/print-prompt.png` });
      const fields = await page.evaluate(() => [...document.querySelectorAll('input[type=text], textarea')]
        .map(e => { const r = e.getBoundingClientRect(); return { id: e.id, cls: e.className, x: r.x, y: r.y, w: r.width, h: r.height }; })
        .filter(f => f.w > 20 && f.h > 5));
      log('text fields:', JSON.stringify(fields));
      const f = fields.sort((p, q) => q.w * q.h - p.w * p.h)[0];
      await page.mouse.click(f.x + f.w / 2, f.y + f.h / 2);
      await page.keyboard.type(userName, { delay: 60 });
      await page.keyboard.press('Tab');
      await sleep(800);
      await page.screenshot({ path: `${out}/print-prompt-filled.png` });
      const popupP = context.waitForEvent('page', { timeout: 30000 });
      await page.evaluate(() => { window.__printCalled = 0; });
      await clickAcc(/^OK$/) || await page.getByRole('button', { name: /^OK$/ }).click();
      const popup = await popupP;
      await popup.waitForLoadState('load');
      await sleep(4000);
      await popup.screenshot({ path: `${out}/certificate.png`, fullPage: true });
      await popup.pdf({ path: `${out}/certificate.pdf`, format: 'Letter', printBackground: true });
      fs.writeFileSync(out + '/certificate.txt', await popup.evaluate(() => document.body.innerText));
      log('certificate saved; popup url=' + popup.url());
      break;
    }

    const q = ANSWERS.find(([qre]) => qre.test(all));
    // A content slide can share a question's wording; only treat it as a quiz slide if the answer choice is there.
    if (q && s.text.some(t => q[1].test(t))) {
      quizIdx++;
      const choiceText = s.text.find(t => q[1].test(t));
      const picked = await clickAcc(q[1]);
      await sleep(800);
      const submitted = await clickAcc(/^Submit(?!_Disabled)/);
      await sleep(3000);
      const fb = await state();
      const verdict = fb.text.find(t => /You must complete the question/i.test(t)) ? 'NOT ANSWERED' :
        (fb.text.find(t => /That's right/i.test(t)) ? 'Correct' : (fb.text.find(t => /did not select|Incorrect/i.test(t)) ? 'Incorrect' : '?'));
      log(`   quiz Q${quizIdx}: answer="${choiceText}" picked=${picked} submitted=${submitted} feedback=${verdict}`);
      await page.screenshot({ path: `${out}/${tag}-feedback.png` });
      if (verdict === 'NOT ANSWERED') { await clickAcc(/^OK$/); continue; }
      if (!(await clickAcc(/^Continue/))) await clickAcc(/^Next(?!_Disabled)/);
      continue;
    }
    if (!(await clickAcc(/^Next(?!_Disabled)/))) { log('no Next button found; stopping'); break; }
  }
  await page.screenshot({ path: `${out}/final.png` });
  await browser.close();
})().catch(e => { log('ERROR ' + e.stack); process.exit(1); });
