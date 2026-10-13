/* Actual Chromium browser acceptance checks for sales-diagnostic-v2.
   Run: npm install --no-save playwright@1.55.0
        npx playwright install chromium
        node sales-diagnostic/browser-e2e.cjs
   Local test-only HTTP origin; does not touch GitHub Pages or real user history. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-diagnostic-browser-'));
const server = http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/index.html') {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
});
const log = (label) => process.stdout.write('  PASS ' + label + '\n');

function checkNoError(page, errors, label) {
  const unexpected = errors.filter(x => !/Clipboard API|NotAllowedError.*clipboard/i.test(x));
  assert.deepEqual(unexpected, [], label + ': unexpected JavaScript errors');
}

async function newPage(browser, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' });
  await page.locator('#homeTitle').waitFor();
  return { page, context, errors };
}

async function driveDiagnosis(page, { modelIndex = 0, mode = 'FULL', name = 'Тестовый товар', legalRisk = false } = {}) {
  const modeLabel = mode === 'BUILD' ? 'Проверить новый или сильно изменённый продукт' : 'Проверить текущие продажи';
  await page.getByRole('button', { name: new RegExp(modeLabel) }).click();
  const seen = [];
  for (let step = 0; step < 65; step++) {
    if (await page.locator('#resultTitle').count()) {
      const title = (await page.locator('#resultTitle').innerText()).trim();
      assert.ok(title.length > 3, 'Result title must be meaningful');
      assert.ok((await page.locator('#resultAction').innerText()).trim().length > 8, 'Result must include concrete action');
      assert.ok((await page.locator('#resultWhy .reason').count()) > 0, 'Result must show evidence');
      assert.ok(!(await page.locator('#app').innerText()).includes('[object Object]'), 'No object debug string');
      return { title, questions: seen };
    }
    const heading = page.locator('#questionTitle');
    await heading.waitFor({ state: 'visible', timeout: 7000 });
    const title = (await heading.innerText()).trim();
    seen.push(title);
    const input = page.locator('#answerArea input.text-input');
    const questionType = await page.evaluate(() => {
      const d = window.__diagTest;
      return d.questions[d.state.path[d.state.index]].type;
    });
    if (await input.count()) {
      const type = await input.getAttribute('inputmode');
      await input.fill(type === 'decimal' ? '10' : name);
    } else {
      const options = page.locator('#answerArea button.option-card');
      const n = await options.count();
      assert.ok(n > 0, 'Question without options: ' + title);
      let ix = 0;
      if (step === 2) ix = Math.min(modelIndex, n - 1); // Scope business model
      if (step === 4) ix = mode === 'BUILD' ? Math.min(2, n - 1)
        : mode === 'HYBRID' ? Math.min(4, n - 1)
        : mode === 'STOPPED' ? Math.min(3, n - 1) : 0; // Real business maturity
      if (legalRisk && /вопрос по безопасности или обязательным требованиям|сомнения.*обязательные правила/i.test(title)) ix = 1;
      // In BUILD, never invent paid transactions in the browser smoke.
      const eyebrow = (await page.locator('#questionEyebrow').innerText()).trim();
      if (mode === 'BUILD' && (/после того, как.*показали/i.test(title) || /что произошло.*показали/i.test(eyebrow))) ix = n - 1;
      await options.nth(ix).click();
    }
    if (questionType === 'single') {
      // Selecting a radio-like answer immediately moves to the next question
      // or concludes the diagnosis. The Back button must stay available.
      assert.ok((await page.locator('#questionTitle').count() && 
        (await page.locator('#questionTitle').innerText()).trim() !== title) ||
        await page.locator('#resultTitle').count(), 'Single choice failed to advance: ' + title);
    } else {
      const next = page.locator('#nextButton');
      assert.equal(await next.isDisabled(), false, 'Cannot advance: ' + title);
      await next.click();
    }
  }
  throw new Error('Question flow did not finish within 65 steps: ' + mode + ', model=' + modelIndex + ' (' + seen.slice(-8).join(' > ') + ')');
}

async function exportHistory(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспортировать историю' }).click();
  const download = await downloadPromise;
  const filePath = path.join(tmp, Date.now() + '-' + download.suggestedFilename());
  await download.saveAs(filePath);
  const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.ok(obj && typeof obj === 'object');
  return { filePath, obj };
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    // 1. Native file chooser, real download and empty-history import message.
    {
      const { page, context, errors } = await newPage(browser);
      assert.match(await page.locator('#homeTitle').innerText(), /продажам/i);
      const empty = await exportHistory(page);
      assert.ok(fs.statSync(empty.filePath).size > 20, 'Downloaded JSON must contain data');
      await page.locator('input[type=file]').setInputFiles(empty.filePath);
      await page.getByRole('button', { name: 'Проверить выбранный файл' }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(n => /ничего добавлять|новых записей нет/i.test(n.textContent)), { timeout: 10000 });
      assert.equal(await page.getByRole('button', { name: /Добавить новые записи/i }).count(), 0);
      checkNoError(page, errors, 'Empty export/import');
      await context.close();
      log('real JSON download + native file chooser + empty import preview');
    }

    // 2. Five business models, FULL and BUILD/HYBRID question branching.
    for (const mode of ['FULL', 'BUILD', 'HYBRID']) {
      for (let modelIndex = 0; modelIndex < 5; modelIndex++) {
        const { page, context, errors } = await newPage(browser);
        const result = await driveDiagnosis(page, { modelIndex, mode, name: 'Проверка модели ' + modelIndex });
        assert.ok(result.questions.length >= 5, mode + ': expected scope questions');
        checkNoError(page, errors, mode + '/' + modelIndex);
        await context.close();
        log(mode + ' model ' + (modelIndex + 1) + ': result after ' + result.questions.length + ' questions');
      }
    }

    // Stopped sales are an existing business problem, not a new-product BUILD.
    {
      const { page, context, errors } = await newPage(browser);
      const result = await driveDiagnosis(page, { mode: 'STOPPED', modelIndex: 0 });
      const actualMode = await page.evaluate(() => window.__diagTest.state.mode);
      assert.equal(actualMode, 'full', 'Existing offer with stopped sales must use FULL');
      assert.ok(result.questions.some(q => /период/i.test(q)), 'FULL must ask period after stopped sales');
      checkNoError(page, errors, 'Stopped sales route');
      await context.close();
      log('existing product stopped selling -> FULL instead of BUILD');
    }

    // Safety blocker: no sales-growth recommendation when mandatory requirements remain uncertain.
    {
      const { page, context, errors } = await newPage(browser);
      const result = await driveDiagnosis(page, { mode: 'FULL', modelIndex: 0, legalRisk: true });
      assert.match(result.title, /требован|безопас/i, 'Open legal question must dominate result');
      checkNoError(page, errors, 'Mandatory requirements gate');
      await context.close();
      log('unresolved mandatory requirements -> safe result');
    }

    // 3. Persistence/history/export/irreversible wipe/import/cancel/confirm/resume.
    {
      const { page, context, errors } = await newPage(browser);
      await driveDiagnosis(page, { mode: 'FULL', modelIndex: 0 });
      const start = page.locator('#startExperimentButton');
      if (await start.count() && await start.isVisible() && !(await start.isDisabled())) {
        await page.locator('#experimentLimitsPanel').evaluate(e => { e.open = true; });
        await page.locator('#experimentTimeCap').fill('7');
        await page.locator('#experimentBudgetCap').fill('1000');
        await page.locator('#experimentExposureCap').fill('30');
        await start.click();
      } else if (await page.locator('#saveResultButton').count()) {
        await page.locator('#saveResultButton').click();
      }
      await page.locator('#brandButton').click();
      const row = page.locator('.history-row');
      assert.ok(await row.count() > 0, 'History must contain saved diagnosis');
      assert.match(await row.first().innerText(), /Диагностика №1/);
      assert.ok(!(await row.first().innerText()).includes('[object Object]'));
      const { filePath, obj } = await exportHistory(page);
      assert.ok(Array.isArray(obj.cycles) && obj.cycles.length >= 1, 'JSON export must preserve cycle');
      page.once('dialog', async d => { assert.equal(d.type(), 'confirm'); await d.dismiss(); });
      await page.getByRole('button', { name: /Очистить всю историю/ }).click();
      assert.ok(await row.count() > 0, 'Cancel must preserve history');
      page.on('dialog', async d => {
        if (d.type() === 'confirm') await d.accept();
        else if (d.type() === 'prompt') await d.accept('УДАЛИТЬ');
        else throw new Error('Unexpected dialog: ' + d.type());
      });
      await page.getByRole('button', { name: /Очистить всю историю/ }).click();
      assert.equal(await page.locator('.history-row').count(), 0, 'Full clear must remove active/finished');
      await page.locator('input[type=file]').setInputFiles(filePath);
      await page.getByRole('button', { name: 'Проверить выбранный файл' }).click();
      const add = page.getByRole('button', { name: /Добавить новые записи \(/ });
      await add.waitFor({ state: 'visible' });
      assert.equal(await page.locator('.history-row').count(), 0, 'Preview must not write');
      await add.click();
      assert.ok(await page.locator('.history-row').count() > 0, 'Explicit confirm must import cycles');
      const open = page.locator('.history-row').first().getByRole('button', { name: /Продолжить|Открыть/ });
      await open.click();
      assert.ok(await page.locator('#resultTitle').isVisible(), 'Resume must open saved result');
      checkNoError(page, errors, 'Full clear/import/resume');
      await context.close();
      log('history numbering, export, cancel, full clear, confirmed import, resume');
    }

    // Owner's exact checkout scenario: 6 completed purchases among 20 ready-to-buy buyers.
    {
      const { page, context, errors } = await newPage(browser);
      await page.evaluate(() => {
        const d = window.__diagTest;
        const answers = { scope_goal:'new_sales',scope_name:'Букеты',scope_model:'PRODUCT',scope_target:'completed_orders',
          gate_legal:'no',gate_economics:'good',gate_capacity:'reserve',core_access:'regular',core_conversion:'hard' };
        d.state.mode='full'; d.state.diagnosticMode='full'; d.state.answers=answers;
        const result=d.makeResult('PURCHASE_FRICTION');
        if(!d.saveHistory({ mode:'full',scope:'Букеты',answers,result,cycleStatus:'PLANNED' }))
          throw new Error('Could not seed isolated checkout diagnosis');
        d.showHome();
      });
      await page.locator('.history-row').first().getByRole('button',{name:/Продолжить|Открыть/}).click();
      assert.ok(await page.locator('#experimentNumericPanel').isVisible(), 'Checkout baseline must be offered');
      assert.ok(await page.locator('#experimentChange').isVisible(), 'Change must be visible above before/after numbers');
      assert.match(await page.locator('#experimentMetricBeforeLabel').innerText(), /сколько человек завершили оформление/i);
      assert.match(await page.locator('#experimentDenominatorLabel').innerText(), /сколько человек явно хотели купить/i);
      assert.match(await page.locator('#experimentNumericExample').innerText(), /20 человек.*6 завершили/i);
      assert.match(await page.locator('#experimentPlannedCountLabel').innerText(), /ПОСЛЕ изменения/i);
      assert.match(await page.locator('#experimentPlannedCountHelp').innerText(), /После того как сделаете/i);
      assert.ok(!(await page.locator('#experimentNumericPanel').innerText()).includes('число событий'));
      assert.match(await page.locator('#experimentPlanCard').innerText(), /не появляется автоматически на других устройствах/i);
      await page.locator('#experimentMetricBefore').fill('6');
      await page.locator('#experimentDenominatorBefore').fill('20');
      await page.locator('#experimentPlannedCount').fill('20');
      await page.locator('#startExperimentButton').click();
      await page.locator('#brandButton').click();
      const saved = await page.evaluate(() => {
        const c=window.__diagTest.loadHistoryStore().cycles[0];
        return c && {before:c.experimentPlan.primaryMetricBefore,den:c.experimentPlan.primaryMetricDenominatorBefore,
          target:c.experimentPlan.plannedObservationCount};
      });
      assert.deepEqual(saved,{before:6,den:20,target:20}, 'Real input values must be stored with the experiment');
      checkNoError(page, errors, 'Plain-language numeric baseline');
      await context.close();
      log('checkout baseline: readable 6-of-20 example, visible action, saved inputs, local browser explanation');
    }


    // Stage 14: saving a draft must not start a test; edited values can be saved
    // again. Starting freezes the baseline and offers direct Follow-up.
    {
      const { page, context, errors } = await newPage(browser, {
        viewport:{width:360,height:740},isMobile:true,hasTouch:true
      });
      await driveDiagnosis(page,{mode:'BUILD',modelIndex:0,name:'UX проверка сохранения'});
      const saveDraft=page.getByRole('button',{name:'Сохранить план на потом'});
      const start=page.locator('#startExperimentButton');
      assert.ok(await saveDraft.isVisible(),'Draft save must be visible next to start');
      assert.ok(await start.isVisible(),'Start must stay available');
      assert.match(await page.locator('#experimentGuide').innerText(),/не начиная проверку/i);
      await page.locator('#experimentLimitsPanel').evaluate(e=>{e.open=true;});
      await page.locator('#experimentBudgetCap').fill('1200');
      await saveDraft.click();
      assert.match(await page.locator('#saveMessage').innerText(),/проверка ещё не начата/i);
      const first=await page.evaluate(()=>{
        const cycles=window.__diagTest.loadHistoryStore().cycles;
        return {count:cycles.length,status:cycles[0].status,budget:cycles[0].experimentPlan.budgetCap,
          start:cycles[0].experimentPlan.startedAt};
      });
      assert.deepEqual(first,{count:1,status:'PLANNED',budget:1200,start:null},
        'Draft save cannot start experiment or create duplicate');
      await page.locator('#experimentBudgetCap').fill('1600');
      assert.equal(await saveDraft.isEnabled(),true,'Editing stored draft must allow save again');
      assert.match(await page.locator('#saveMessage').innerText(),/Вы изменили план/i);
      await saveDraft.click();
      assert.equal(await page.evaluate(() =>
        window.__diagTest.loadHistoryStore().cycles[0].experimentPlan.budgetCap
      ),1600,'Second save must persist changed budget');
      await start.click();
      const afterStart=await page.evaluate(()=>{
        const cycles=window.__diagTest.loadHistoryStore().cycles;
        return {count:cycles.length,status:cycles[0].status,budget:cycles[0].experimentPlan.budgetCap,
          started:!!cycles[0].experimentPlan.startedAt,
          inputs:Array.from(document.querySelectorAll('#experimentPlanCard input'))
            .every(el=>el.disabled)};
      });
      assert.deepEqual(afterStart,{count:1,status:'ACTIVE',budget:1600,started:true,inputs:true},
        'Start must freeze inputs and preserve latest saved baseline');
      assert.equal(await saveDraft.isVisible(),false,'No draft-save after start');
      const direct=page.locator('#planActionGrid').getByRole('button',{name:'Проверить результат'});
      assert.ok(await direct.isVisible(),'Started plan must expose Follow-up without home navigation');
      await page.locator('#brandButton').click();
      await page.locator('.history-row').first().getByRole('button',{name:'Продолжить'}).click();
      assert.equal(await page.locator('#startExperimentButton').isVisible(),false,
        'Resumed started plan should not offer start again');
      assert.ok(await page.locator('#planActionGrid').getByRole('button',{name:'Проверить результат'}).isVisible(),
        'Resumed started plan retains direct Follow-up');
      await page.locator('#planActionGrid').getByRole('button',{name:'Проверить результат'}).click();
      assert.equal(await page.evaluate(()=>{
        const d=window.__diagTest;return d.state.path[d.state.index];
      }),'fu_done','Direct shortcut starts the original Follow-up questions');
      checkNoError(page,errors,'stage 14 draft/save/start/follow-up shortcut on mobile');
      await context.close();
      log('stage 14 mobile: draft save, edited draft resave, frozen start, direct Follow-up and Resume');
    }

    // Actual Follow-up: cap reached, sample insufficient, original cycle must be preserved.
    {
      const { page, context, errors } = await newPage(browser);
      await driveDiagnosis(page, { mode: 'BUILD', modelIndex: 0, name: 'Контроль Follow-up' });
      const start = page.locator('#startExperimentButton');
      assert.ok(await start.isVisible(), 'Result must include a plan: ' + await page.locator('#resultTitle').innerText());
      await page.locator('#experimentLimitsPanel').evaluate(e => { e.open = true; });
      await page.locator('#experimentBudgetCap').fill('1000');
      if (await page.locator('#experimentPlannedCount').isVisible()) await page.locator('#experimentPlannedCount').fill('50');
      await start.click();
      await page.locator('#brandButton').click();
      const followup = page.locator('.history-row').first().getByRole('button', { name: 'Проверить результат' });
      await followup.click();
      const seen = [];
      for (let step = 0; step < 18; step++) {
        if (await page.locator('#resultTitle').count()) break;
        const title = (await page.locator('#questionTitle').innerText()).trim();
        seen.push(title);
        const input = page.locator('#answerArea input.text-input');
        const questionType = await page.evaluate(() => {
          const d = window.__diagTest;
          return d.questions[d.state.path[d.state.index]].type;
        });
        if (await input.count()) await input.fill('0');
        else {
          const opts = page.locator('#answerArea .option-card');
          const n = await opts.count();
          assert.ok(n > 0, 'Follow-up question has no answers: ' + title);
          let ix = 0;
          const questionId = await page.evaluate(() => { const s = window.__diagTest.state; return s.path[s.index]; });
          if (questionId === 'fu_guardrail') ix = n - 1;
          else if (questionId === 'fu_limit_status') ix = 1;
          else if (questionId === 'fu_sample_ready') ix = 1;
          await opts.nth(ix).click();
        }
        if (questionType !== 'single') {
          const next = page.locator('#nextButton');
          assert.equal(await next.isDisabled(), false, 'Follow-up blocked: ' + title);
          await next.click();
        } else {
          assert.ok((await page.locator('#questionTitle').count() &&
            (await page.locator('#questionTitle').innerText()).trim() !== title) ||
            await page.locator('#resultTitle').count(), 'Follow-up single choice failed to advance');
        }
      }
      assert.ok(await page.locator('#resultTitle').count(), 'Follow-up result must finish');
      const conclusion = await page.locator('#resultTitle').innerText();
      const next = await page.locator('#resultNext').innerText();
      assert.ok(/пересмотр|недостаточно|предел/i.test(conclusion + ' ' + next),
        'Reached cap with insufficient sample must request redesign: ' + conclusion + ' | ' + next);
      assert.ok(!(await page.locator('#resultWhy').innerText()).includes('Что делать дальше:'),
        'Follow-up explanations must not repeat next action');
      await page.getByRole('button', { name: 'Сохранить результат проверки' }).click();
      await page.locator('#brandButton').click();
      assert.ok(await page.locator('.history-row').count() >= 1, 'Completed Follow-up stays in history');
      checkNoError(page, errors, 'Follow-up cap/insufficient sample');
      await context.close();
      log('Follow-up with budget cap + insufficient observations + saved result (' + seen.length + ' questions)');
    }


    // Completed and properly measured failure: one clarifier, an actionable
    // independent evidence plan, and a linked new cycle in real Chromium.
    {
      const { page, context, errors } = await newPage(browser);
      await driveDiagnosis(page, {mode:'BUILD', modelIndex:0, name:'Повторная проверка без улучшения'});
      assert.ok(await page.locator('#startExperimentButton').isVisible());
      await page.locator('#startExperimentButton').click();
      await page.locator('#brandButton').click();
      await page.locator('.history-row').first().getByRole('button',{name:'Проверить результат'}).click();
      const ids = [];
      for(let step=0; step<18; step++){
        if(await page.locator('#resultTitle').count()) break;
        const id=await page.evaluate(()=>{
          const d=window.__diagTest;
          return d.state.path[d.state.index];
        });
        ids.push(id);
        const type=await page.evaluate(()=>{
          const d=window.__diagTest;
          return d.questions[d.state.path[d.state.index]].type;
        });
        const options=page.locator('#answerArea .option-card');
        const count=await options.count();
        assert.ok(count>0,'Follow-up failure question had no options: '+id);
        let ix=0;
        if(id==='fu_guardrail') ix=count-1;
        if(id==='fu_effect') ix=2; // no change
        if(id==='fu_failure_location') ix=1; // same barrier at altered step
        await options.nth(ix).click();
        if(type!=='single') await page.locator('#nextButton').click();
      }
      assert.ok(ids.includes('fu_failure_location'),'Failed intervention should ask one follow-up clarifier');
      assert.match(await page.locator('#resultTitle').innerText(),/не прошло проверку/i);
      assert.match(await page.locator('#resultAction').innerText(),/обращени/i);
      const button=page.getByRole('button',{name:'Открыть следующий шаг'});
      assert.ok(await button.isVisible(),'Failed intervention must offer real next-cycle action');
      const parent=await page.evaluate(()=>window.__diagTest.state.activeCycleId);
      await button.click();
      assert.match(await page.locator('#resultTitle').innerText(),/Следующая проверка/i);
      assert.match(await page.locator('#experimentChange').innerText(),/обращени/i);
      const chain=await page.evaluate((parentId)=>{
        const d=window.__diagTest,cycles=d.loadHistoryStore().cycles;
        const old=cycles.find(c=>c.cycleId===parentId);
        const child=cycles.find(c=>c.parentCycleId===parentId);
        return {oldStatus:old?.status, followups:old?.followups?.length,
          linked:old?.nextCycleId===child?.cycleId,
          changed:old?.experimentPlan?.changeOneThing!==child?.experimentPlan?.changeOneThing,
          childStatus:child?.status,
          evidenceOnly:child?.experimentPlan?.nonCommercialOnly};
      },parent);
      assert.deepEqual(chain,{oldStatus:'COMPLETED',followups:1,linked:true,
        changed:true,childStatus:'PLANNED',evidenceOnly:true});
      await page.locator('#brandButton').click();
      assert.ok(await page.locator('.history-row').count()>=2,'Linked new cycle must persist');
      checkNoError(page,errors,'Failed Follow-up → actionable linked cycle');
      await context.close();
      log('failed Follow-up: real clarifier, next action, immutable parent and linked child');
    }

    // Owner mobile UX: singles advance immediately + Back corrects taps;
    // multi-select keeps screen position, accumulates selections and uses "Next".
    {
      const { page, context, errors } = await newPage(browser, {
        viewport:{width:320,height:640}, isMobile:true, hasTouch:true
      });
      const qid = () => page.evaluate(() => {
        const s=window.__diagTest.state;
        return s.path[s.index];
      });
      await page.getByRole('button',{name:/Проверить текущие продажи/}).click();
      assert.equal(await qid(),'scope_goal');
      assert.equal(await page.locator('#nextButton').isVisible(),false,'Next hidden for single choices');
      await page.locator('#answerArea .option-card').first().tap();
      assert.equal(await qid(),'scope_name','Tapping one choice must advance immediately');
      assert.equal(await page.locator('#backButton').isEnabled(),true,'Back remains enabled');
      await page.locator('#backButton').tap();
      assert.equal(await qid(),'scope_goal','Back returns to previous single-choice question');
      assert.equal(await page.locator('#answerArea .option-card.selected').count(),1,'Back keeps the old selection');
      await page.locator('#answerArea .option-card').first().tap();
      assert.equal(await qid(),'scope_name','Changing / confirming after Back can advance');
      await page.locator('#answerArea input.text-input').fill('Букеты');
      assert.equal(await page.locator('#nextButton').isVisible(),true,'Text entry still needs Next');
      await page.locator('#nextButton').tap();
      assert.equal(await qid(),'scope_model');
      await page.locator('#answerArea .option-card').first().tap();
      assert.equal(await qid(),'scope_target');
      await page.locator('#answerArea .option-card').first().tap();
      assert.equal(await qid(),'maturity_state');
      await page.locator('#answerArea .option-card').last().tap(); // changed existing offer
      assert.equal(await qid(),'inheritance_entry');
      await page.locator('#answerArea .option-card').nth(1).tap(); // existing transferable foundation => HYBRID
      assert.equal(await qid(),'inheritance_map');
      assert.equal(await page.locator('#nextButton').isVisible(),true,'Multi-choice must show Next');
      assert.equal((await page.locator('#nextButton').innerText()).trim(),'Далее','Button label must match multi-choice instruction');
      assert.match(await page.locator('#multiSelectHint').innerText(),/один или несколько вариантов ответа/i);
      assert.equal(await page.locator('#multiSelectHint').isVisible(),true,'Multi-choice hint is prominent');

      await page.evaluate(() => window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
      const choices = page.locator('#answerArea .option-card');
      assert.equal(await choices.count(),9);
      await page.evaluate(() => { window.__beforeMultiOption = document.querySelector('#answerArea .option-card'); });
      await choices.nth(6).tap(); // capacity near the bottom of a long set
      let selected=await page.evaluate(() => {
        const s=window.__diagTest.state;
        return {id:s.path[s.index],answers:s.answers.inheritance_map,y:scrollY,
          active:document.activeElement?.textContent?.trim()};
      });
      assert.equal(selected.id,'inheritance_map','First multi tap must not navigate');
      assert.deepEqual(selected.answers,['capacity']);
      assert.ok(selected.y>10,'Scrolled mobile screen must stay scrolled');
      assert.match(selected.active,/заказ/i,'Tapped option retains keyboard focus');
      const beforeY=selected.y;
      await choices.nth(5).tap();
      selected=await page.evaluate(() => ({
        y:scrollY,choices:window.__diagTest.state.answers.inheritance_map,
        id:window.__diagTest.state.path[window.__diagTest.state.index]
      }));
      assert.equal(selected.id,'inheritance_map','Second multi tap still stays on same question');
      assert.deepEqual(selected.choices,['capacity','fulfillment']);
      // The browser is allowed to scroll an offscreen neighbouring option into
      // view during .tap(); the APP must not jump to y=0 or recreate the cards.
      assert.ok(selected.y > 10,
        'Multi tap must not reset scroll to top: before=' + beforeY + ', after=' + selected.y);
      assert.equal(await page.evaluate(() =>
        document.querySelector('#answerArea .option-card') === window.__beforeMultiOption
      ),true,'Multi tap must not rebuild the screen or lose option node identity');
      await choices.nth(7).tap(); // mutually exclusive "none"
      assert.deepEqual(await page.evaluate(() => window.__diagTest.state.answers.inheritance_map),['none']);
      assert.equal(await page.locator('#answerArea .option-card.selected').count(),1);
      assert.equal(await page.locator('#nextButton').isEnabled(),true);
      await page.locator('#nextButton').tap();
      assert.equal(await qid(),'build_test_type','Only pressing Next advances multi-choice');
      await page.locator('#backButton').tap();
      assert.equal(await qid(),'inheritance_map','Back must work after multi-choice');
      assert.equal(await page.locator('#answerArea .option-card.selected').count(),1,'Back keeps multi selection');
      checkNoError(page,errors,'320px touchscreen auto-next / multi-scroll / Back');
      await context.close();
      log('320px touch: single auto-advance + Back, multi no-scroll + multiple selection + explicit Next');
    }


    // Stage 14: inadvertent taps on header/navigation must not discard a
    // questionnaire in progress without explicit confirmation.
    {
      const {page,context,errors}=await newPage(browser,{
        viewport:{width:320,height:640},isMobile:true,hasTouch:true
      });
      await page.getByRole('button',{name:/Проверить текущие продажи/}).click();
      await page.locator('#answerArea .option-card').first().tap();
      assert.equal(await page.evaluate(()=>window.__diagTest.state.path[
        window.__diagTest.state.index]),'scope_name');
      page.once('dialog',async d=>{
        assert.equal(d.type(),'confirm');
        assert.match(d.message(),/будут потеряны/i);
        await d.dismiss();
      });
      await page.locator('#resetButton').tap();
      assert.equal(await page.evaluate(()=>window.__diagTest.state.answers.scope_goal),
        'new_sales','Cancel must preserve question answers');
      assert.equal(await page.evaluate(()=>window.__diagTest.state.path[
        window.__diagTest.state.index]),'scope_name','Cancel must preserve place in questionnaire');
      page.once('dialog',async d=>{assert.equal(d.type(),'confirm');await d.accept();});
      await page.locator('#brandButton').tap();
      assert.ok(await page.locator('#homeTitle').isVisible(),'Confirm must return home');
      checkNoError(page,errors,'stage 14 accidental exit mobile');
      await context.close();
      log('stage 14 mobile: accidental exit rejected, answers preserved, confirmed exit resets');
    }


    // Stage 14: unsaved final result and edited draft must resist accidental
    // navigation; copying must retain the complete measurement plan.
    {
      const {page,context,errors}=await newPage(browser,{
        viewport:{width:360,height:740},isMobile:true,hasTouch:true
      });
      await driveDiagnosis(page,{mode:'BUILD',modelIndex:0,name:'Защита результата'});
      assert.ok(await page.locator('#resultTitle').isVisible());
      const originalId=await page.evaluate(()=>window.__diagTest.state.result.resultId);
      page.once('dialog',async d=>{
        assert.equal(d.type(),'confirm');
        assert.match(d.message(),/результат или изменения плана/i);
        await d.dismiss();
      });
      await page.locator('#restartResultButton').tap();
      assert.equal(await page.evaluate(()=>window.__diagTest.state.result.resultId),originalId,
        'Cancelled exit must preserve an unsaved conclusion');
      await page.locator('#experimentLimitsPanel').evaluate(e=>{e.open=true;});
      await page.locator('#experimentBudgetCap').fill('1700');
      const copied=await page.evaluate(()=>
        window.__diagTest.resultText(window.__diagTest.state.result));
      assert.match(copied,/План проверки:/);
      assert.match(copied,/Предел расходов: 1700 ₽/);
      await page.getByRole('button',{name:'Сохранить план на потом'}).tap();
      await page.locator('#experimentBudgetCap').fill('1900');
      page.once('dialog',async d=>{
        assert.equal(d.type(),'confirm');
        await d.dismiss();
      });
      await page.locator('#brandButton').tap();
      assert.ok(await page.locator('#resultTitle').isVisible(),
        'Edited plan must remain visible after cancelling exit');
      assert.equal(await page.evaluate(() =>
        window.__diagTest.loadHistoryStore().cycles[0].experimentPlan.budgetCap),1700,
        'Unsaved edited value must not overwrite saved plan');
      await page.getByRole('button',{name:'Сохранить план на потом'}).tap();
      let dialogs=0;
      page.on('dialog',async d=>{dialogs++;await d.dismiss();});
      await page.locator('#restartResultButton').tap();
      assert.ok(await page.locator('#homeTitle').isVisible(),'Saved plan permits normal return home');
      assert.equal(dialogs,0,'No warning when plan and changes are safely stored');
      assert.equal(await page.evaluate(() =>
        window.__diagTest.loadHistoryStore().cycles[0].experimentPlan.budgetCap),1900);
      checkNoError(page,errors,'stage 14 unsaved conclusion and draft guard');
      await context.close();
      log('stage 14 mobile: unsaved result warning, changed plan warning, copy backup, saved exit');
    }

    // Stage 14: the visible history must not hide valid older saved cycles.
    {
      const {page,context,errors}=await newPage(browser,{
        viewport:{width:320,height:640},isMobile:true,hasTouch:true
      });
      await page.evaluate(()=>{
        const d=window.__diagTest;
        for(let i=0;i<9;i++){
          d.state.activeCycleId=null;
          d.state.scopeId='scope_closed_'+i;
          d.state.mode='full';
          d.state.answers={scope_name:'История '+i,scope_goal:'new_sales',
            scope_model:'PRODUCT'};
          const result=d.makeResult('ACCESS');
          if(!d.saveHistory({mode:'full',scope:'История '+i,
              answers:{...d.state.answers},result,cycleStatus:'COMPLETED'}))
            throw new Error('Cannot seed closed cycle '+i);
        }
        d.showHome();
      });
      const row=page.locator('.history-row');
      assert.equal(await row.count(),9,'All nine saved closed cycles must remain in DOM');
      assert.equal(await row.filter({visible:true}).count(),6,
        'Initially show only six closed cycles');
      const more=page.getByRole('button',{name:/Показать остальные завершённые/});
      assert.ok(await more.isVisible(),'Show more must appear for the extra cycles');
      assert.equal(await more.getAttribute('aria-expanded'),'false');
      await more.tap();
      assert.equal(await row.filter({visible:true}).count(),9,
        'User must be able to see all older cycles');
      assert.equal(await more.getAttribute('aria-expanded'),'true');
      await page.getByRole('button',{name:/Скрыть старые завершённые проверки/}).tap();
      assert.equal(await row.filter({visible:true}).count(),6,
        'Hide action must collapse older cycles');
      checkNoError(page,errors,'stage 14 older history rows on mobile');
      await context.close();
      log('stage 14 mobile: all older closed history cycles expand and collapse');
    }

    // 4. Narrow viewport and keyboard navigation, without horizontal scrolling.
    {
      const { page, context, errors } = await newPage(browser, { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 2, '320px viewport horizontal overflow: ' + overflow + ' px');
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard Tab must focus a control');
      await page.getByRole('button', { name: /Проверить текущие продажи/ }).click();
      assert.ok(await page.locator('#questionTitle').isVisible());
      const questionOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(questionOverflow <= 2, '320px question horizontal overflow: ' + questionOverflow + ' px');
      checkNoError(page, errors, 'Mobile/keyboard');
      await context.close();
      log('320px viewport + native keyboard focus + question screen');
    }
    process.stdout.write('BROWSER E2E PASS\n');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('BROWSER E2E FAIL\n' + (error.stack || error));
  process.exitCode = 1;
  server.close();
});
