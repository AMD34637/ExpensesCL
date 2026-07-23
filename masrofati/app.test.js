/* اختبارات تكامل المتصفح — node app.test.js (Playwright) */
const { chromium } = require("playwright");
const APP = "file:///workspace/expensescl/masrofati/index.html";
let pass = 0, fail = 0; const fails = [];
function ck(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("  ✗ " + n); } }

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    // ignore Tesseract CDN load failures in the sandbox (no external network for the browser); app handles absence gracefully
    page.on("console", m => { if (m.type() === "error") { const t = m.text(); if (!/tesseract|cdn\.jsdelivr|ERR_CONNECTION_RESET|Failed to load resource/i.test(t)) errors.push(t); } });
    page.on("pageerror", e => errors.push("PE: " + e.message));
    await page.goto(APP); await page.waitForTimeout(300);
    console.log("\n=== " + scheme + " ===");
    ck(errors.length === 0, "no load errors :: " + errors.join(" | "));
    ck(await page.evaluate(() => !!window.ReceiptParser), "ReceiptParser loaded in browser");

    async function addTx(o){ return page.evaluate(t => { const mk = window.__M.monthKey(); t.date = t.date || (mk + "-15"); window.__M.saveTx(t); return window.__M.state.tx.length; }, o); }
    async function calc(){ return page.evaluate(() => window.__M.calc(window.__M.monthKey())); }

    // core calc scenarios
    ck((await calc()).remaining === 0, "empty zeros");
    await addTx({ type:"income", incomeType:"primary", amount:10000, category:"راتب", owner:"مشترك" });
    await addTx({ type:"income", incomeType:"additional", amount:2000, category:"مكافأة", owner:"عبدالله" });
    await addTx({ type:"expense", amount:3800, category:"السكن" });
    let c = await calc();
    ck(c.income === 12000 && c.expenses === 3800 && c.remaining === 8200, "calc income/exp/remaining got " + JSON.stringify([c.income,c.expenses,c.remaining]));

    // primary uniqueness per owner+month via UI
    await page.evaluate(() => window.__M.openAdd("income")); await page.waitForTimeout(120);
    await page.selectOption("#axOwner", "مشترك");
    await page.locator('#axIncType button[data-k="primary"]').click();
    await page.fill("#axAmount", "11000");
    await page.locator("#axSave").click(); await page.waitForTimeout(180);
    let primShared = await page.evaluate(() => window.__M.state.tx.filter(t => t.incomeType === "primary" && (t.owner||"مشترك") === "مشترك").length);
    ck(primShared === 1, "primary(مشترك) not duplicated got " + primShared);
    ck((await calc()).prim === 11000, "primary updated to 11000");
    // different owner primary => allowed, separate record
    await page.evaluate(() => window.__M.openAdd("income")); await page.waitForTimeout(120);
    await page.selectOption("#axOwner", "ثناء");
    await page.locator('#axIncType button[data-k="primary"]').click();
    await page.fill("#axAmount", "5000");
    await page.locator("#axSave").click(); await page.waitForTimeout(180);
    let primAll = await page.evaluate(() => window.__M.state.tx.filter(t => t.incomeType === "primary").length);
    ck(primAll === 2, "distinct-owner primary allowed got " + primAll);

    // commitments + savings once
    await page.evaluate(() => { window.__M.state.commitments.push({ id:"c1", name:"إيجار", amount:2500, recurring:true, paid:{} }); window.__M.state.savings.push({ id:"s1", goalName:"طوارئ", targetAmount:9999, currentAmount:0, monthlyContribution:1000, status:"active" }); window.__M.renderAll(); });
    c = await calc();
    ck(c.commit === 2500 && c.savings === 1000, "commit/savings once");

    // month isolation
    await page.locator("#mNext").click(); await page.waitForTimeout(120);
    let c2 = await calc();
    ck(c2.expenses === 0 && c2.commit === 2500, "next month isolates expenses; recurring commit persists");
    await page.locator("#mPrev").click(); await page.waitForTimeout(120);

    // edit amount adjusts (delete+reverse): edit the 3800 expense to 4800
    let exId = await page.evaluate(() => window.__M.state.tx.filter(t => t.type === "expense")[0].id);
    await page.evaluate(id => window.__M.openAdd("expense", id), exId); await page.waitForTimeout(150);
    await page.fill("#axAmount", "4800");
    await page.locator("#axSave").click(); await page.waitForTimeout(180);
    ck((await calc()).expenses === 4800, "edit amount applies (no duplicate) got " + (await calc()).expenses);
    let exCount = await page.evaluate(() => window.__M.state.tx.filter(t => t.type === "expense").length);
    ck(exCount === 1, "edit did not create duplicate");

    // delete reverses
    await page.evaluate(id => window.__M.deleteTx(id), exId); await page.waitForTimeout(120);
    ck((await calc()).expenses === 0, "delete reverses expense");

    // PAYMENT receipt: parsed => one tx, zero items
    let before = await page.evaluate(() => window.__M.state.tx.length);
    await page.evaluate(() => {
      const parsed = window.ReceiptParser.parseReceipt("Card Transaction Receipt\nMerchant PANDA\nBilling Amount SAR -1,038.57\nReference Number 269\nMada");
      window.__M.openReceiptReview("", parsed, "");
    });
    await page.waitForTimeout(150);
    let itemsVisible = await page.locator("#rvItemsWrap").isVisible();
    ck(!itemsVisible, "payment receipt hides items section");
    let totalVal = await page.inputValue("#rvTotal");
    ck(parseFloat(totalVal) === 1038.57, "payment total prefilled 1038.57 got " + totalVal);
    await page.locator("#rvSave").click(); await page.waitForTimeout(200);
    let afterPay = await page.evaluate(() => window.__M.state.tx.length);
    ck(afterPay === before + 1, "payment => ONE expense tx");
    let noInv = await page.evaluate(() => window.__M.state.invoices.length);
    ck(noInv === 0, "payment creates NO invoice items");

    // RETAIL receipt: multi-item one parent + linked items
    let txB = await page.evaluate(() => window.__M.state.tx.length);
    await page.evaluate(() => {
      const parsed = window.ReceiptParser.parseReceipt("بقالة\nحليب 2 x 10.00 20.00\nخبز 1 x 3.00 3.00\nالمجموع الفرعي 23.00\nالإجمالي 23.00");
      window.__M.openReceiptReview("", parsed, "");
    });
    await page.waitForTimeout(150);
    ck(await page.locator("#rvItemsWrap").isVisible(), "retail shows items");
    let saveDisabled = await page.evaluate(() => document.getElementById("rvSave").disabled);
    ck(!saveDisabled, "retail save enabled when items match total");
    await page.locator("#rvSave").click(); await page.waitForTimeout(200);
    let txA = await page.evaluate(() => window.__M.state.tx.length);
    ck(txA === txB + 1, "retail => ONE parent expense");
    let inv = await page.evaluate(() => ({ inv: window.__M.state.invoices.length, items: window.__M.state.invoiceItems.length }));
    ck(inv.inv === 1 && inv.items === 2, "retail stored 1 invoice + 2 items got " + JSON.stringify(inv));

    // cascade delete invoice
    await page.evaluate(() => { const t = window.__M.state.tx.filter(x => x.invoiceId)[0]; window.__M.deleteTx(t.id); });
    await page.waitForTimeout(120);
    let afterDel = await page.evaluate(() => ({ inv: window.__M.state.invoices.length, items: window.__M.state.invoiceItems.length }));
    ck(afterDel.inv === 0 && afterDel.items === 0, "cascade delete removes invoice+items");

    // disable-save on materially mismatched retail
    await page.evaluate(() => {
      const parsed = { type:"retail", merchant:"x", date:"2026-07-10", total:100, subtotal:null, vat:null, discount:0, items:[{name:"a",quantity:1,unitPrice:5,total:5}] };
      window.__M.openReceiptReview("", parsed, "");
    });
    await page.waitForTimeout(150);
    let disabledMismatch = await page.evaluate(() => document.getElementById("rvSave").disabled);
    ck(disabledMismatch, "save disabled when items materially conflict");
    await page.evaluate(() => { const dlg = document.getElementById("dlgReceipt"); if (dlg.open) dlg.close(); });

    // Gregorian format
    let g = await page.evaluate(() => window.__M.fmtG("2026-07-23"));
    ck(g === "23/07/2026", "Gregorian dd/mm/yyyy got " + g);
    ck(await page.evaluate(() => window.__M.validGregorian("2026-07-23") && !window.__M.validGregorian("2026-13-40")), "date validation");

    // persistence + overflow + font-size
    let bcount = await page.evaluate(() => window.__M.state.tx.length);
    await page.reload(); await page.waitForTimeout(300);
    ck((await page.evaluate(() => window.__M.state.tx.length)) === bcount, "persist across reload");
    ck(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), "no horizontal overflow");
    ck((await page.evaluate(() => { const i = document.querySelector("input"); return i ? parseFloat(getComputedStyle(i).fontSize) : 16; })) >= 16, "input >=16px (no iOS zoom)");

    // one receipt button check
    await page.evaluate(() => document.getElementById("qaReceipt").click()); await page.waitForTimeout(150);
    let pickButtons = await page.locator("#dlgReceipt .btn.primary, #dlgReceipt .btn.soft").count();
    ck(pickButtons === 1, "receipt chooser shows exactly ONE primary capture button got " + pickButtons);
    ck(await page.evaluate(() => { const i = document.getElementById("receiptInput"); return i && i.accept === "image/*" && !i.hasAttribute("capture"); }), "single input accept=image/* without capture");
    await page.evaluate(() => { const d = document.getElementById("dlgReceipt"); if (d.open) d.close(); });

    ck(errors.length === 0, "no errors after run :: " + errors.join(" | "));
    await ctx.close();
  }
  await browser.close();
  console.log("\n=========== PASS: " + pass + "  FAIL: " + fail);
  if (fail){ console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("ALL GREEN ✓");
})();
