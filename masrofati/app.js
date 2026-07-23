"use strict";
/* ===== مصروفاتي — إعادة تصميم مستقلة، هوية محفوظة ===== */

/* ---------- categories ---------- */
var EXP_CATS = [
  ["السكن","🏠"],["الطعام والمطاعم","🍽️"],["النقل","⛽"],["التسوق","🛍️"],
  ["الفواتير","💡"],["الترفيه","🎉"],["الصحة","🩺"],["الأسرة","👨‍👩‍👧"],
  ["السفر","✈️"],["التعليم","📚"],["أخرى","📦"]
];
var INC_SOURCES = ["راتب","مكافأة","عمل إضافي","بيع","استرداد","دخل آخر"];
var PAY_METHODS = ["مدى","بطاقة ائتمان","نقدًا","تحويل","Apple Pay","أخرى"];
var COMMIT_CATS = ["إيجار","قرض","اشتراك","فاتورة","قسط","التزام عائلي","التزام آخر"];
var OWNERS = ["مشترك","عبدالله","ثناء"];
function ensureAccountMeta(){
  if (!state.meta || typeof state.meta !== "object") state.meta = {};
  if (!Array.isArray(state.meta.accounts) || !state.meta.accounts.length) state.meta.accounts = ["الحساب الرئيسي","نقدًا","حساب بنكي"];
  if (!state.meta.accountOpeningBalances || typeof state.meta.accountOpeningBalances !== "object") state.meta.accountOpeningBalances = {};
  if (!Array.isArray(state.meta.transfers)) state.meta.transfers = [];
}
function accounts(){ ensureAccountMeta(); return state.meta.accounts; }
function accountOpening(name){ ensureAccountMeta(); return num(state.meta.accountOpeningBalances[name]); }
function accountBalance(name){
  ensureAccountMeta();
  var balance = accountOpening(name);
  state.tx.forEach(function(t){
    var account = t.account || "الحساب الرئيسي";
    if (account !== name) return;
    if (t.type === "income") balance += num(t.amount);
    else if (t.type === "expense") balance -= num(t.amount);
  });
  state.meta.transfers.forEach(function(tr){
    if (tr.to === name) balance += num(tr.amount);
    if (tr.from === name) balance -= num(tr.amount);
  });
  return Math.round(balance * 100) / 100;
}
function ownerDefault(){ try { return localStorage.getItem("masrofati-owner") || "مشترك"; } catch(e){ return "مشترك"; } }
var EXP_ICON = {}; EXP_CATS.forEach(function(c){ EXP_ICON[c[0]] = c[1]; });
var AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/* ---------- storage ---------- */
var KEY = "masrofati-v2";
var SHEET_URL_KEY = "masrofati-sheet-url";
var SHEET_VIEW_KEY = "masrofati-sheet-view";
var PEND_KEY = "masrofati-pending";
var THEME_KEY = "masrofati-theme";

var state = { tx: [], invoices: [], invoiceItems: [], commitments: [], savings: [], meta: {} };
var memOnly = false;
try { var raw = localStorage.getItem(KEY); if (raw) state = Object.assign(state, JSON.parse(raw)); }
catch (e) { memOnly = true; }
["tx","invoices","invoiceItems","commitments","savings"].forEach(function(k){ if (!Array.isArray(state[k])) state[k] = []; });
if (!state.meta) state.meta = {};

function persist() { if (!memOnly) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { memOnly = true; } } }

/* ---------- helpers ---------- */
var $ = function(id){ return document.getElementById(id); };
var view = { y: new Date().getFullYear(), m: new Date().getMonth() };
function monthKey(y, m){ if (y === undefined){ y = view.y; m = view.m; } return y + "-" + String(m + 1).padStart(2, "0"); }
function uid(){ return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
function nowISO(){ return new Date().toISOString(); }
function todayStr(){ return new Date().toISOString().slice(0, 10); }
function num(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
function fmt(n){ return (Number(n) || 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 }) + " ر.س"; }
var GREG = "en-GB-u-ca-gregory";
function fmtG(dateStr){ // Gregorian dd/mm/yyyy — never Hijri
  if (!dateStr) return "—";
  var iso = String(dateStr).slice(0, 10);
  var d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())){ var p = iso.split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : dateStr; }
  try { return new Intl.DateTimeFormat(GREG, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d); }
  catch(e){ var q = iso.split("-"); return q[2] + "/" + q[1] + "/" + q[0]; }
}
function validGregorian(v){ return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00").getTime()); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function toast(msg, err){ var t = $("toast"); t.textContent = msg; t.className = err ? "show err" : "show"; clearTimeout(toast._h); toast._h = setTimeout(function(){ t.className = ""; }, 2200); }

/* ---------- google sheets sync (background) ---------- */
var sheetUrl = "", sheetViewUrl = "", pending = [];
try { sheetUrl = localStorage.getItem(SHEET_URL_KEY) || ""; } catch (e) {}
try { sheetViewUrl = localStorage.getItem(SHEET_VIEW_KEY) || ""; } catch (e) {}
try { pending = JSON.parse(localStorage.getItem(PEND_KEY) || "[]"); } catch (e) {}
function savePending(){ try { localStorage.setItem(PEND_KEY, JSON.stringify(pending)); } catch (e) {} }
function snapshot(){ return { tx: state.tx, invoices: state.invoices, invoiceItems: state.invoiceItems, commitments: state.commitments, savings: state.savings, meta: state.meta }; }
function syncDots(){
  var dot = $("sDot"), txt = $("sText");
  if (!dot) return;
  if (sheetUrl) {
    if (pending.length) { dot.className = "sync-dot pend"; txt.textContent = "بانتظار المزامنة (" + pending.length + ")"; }
    else { dot.className = "sync-dot on"; txt.textContent = "مربوط ومتزامن مع قوقل شيت ✓"; }
  } else { dot.className = "sync-dot"; txt.textContent = "غير مربوط بقوقل شيت — البيانات محلية"; }
}
function snapshotEmpty(s){ return !(s.tx.length || s.invoices.length || s.commitments.length || s.savings.length); }
function pushSnapshot(){ // full snapshot upsert; safe against duplicates because keyed by ids server-side
  if (!sheetUrl) return Promise.resolve();
  var snap = snapshot();
  // حماية: لا تكتب لقطة فارغة فوق بيانات سحابية صحيحة إلا بعد مسح/استيراد صريح
  if (snapshotEmpty(snap) && !state.meta._allowEmptyPush) { syncDots(); return Promise.resolve(); }
  var body = JSON.stringify({ action: "full", data: snap });
  return fetch(sheetUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: body })
    .then(function(r){ if (!r.ok) throw new Error("sync-http-" + r.status); return r.json(); })
    .then(function(result){ if (!result || result.ok !== true) throw new Error("sync-rejected"); pending = []; savePending(); syncDots(); return result; })
    .catch(function(err){ pending = [{ action: "full" }]; savePending(); syncDots(); throw err; });
}
function pullSheet(){
  if (!sheetUrl) return Promise.resolve();
  return fetch(sheetUrl + (sheetUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.data) {
        ["tx","invoices","invoiceItems","commitments","savings"].forEach(function(k){ if (Array.isArray(d.data[k])) state[k] = d.data[k]; });
        if (d.data.meta) state.meta = d.data.meta;
        persist();
      }
      if (d && d.sheetUrl) { sheetViewUrl = d.sheetUrl; try { localStorage.setItem(SHEET_VIEW_KEY, sheetViewUrl); } catch (e) {} }
      renderAll();
    });
}

/* إعادة المزامنة تلقائيًا عند عودة الإنترنت، من دون تغيير واجهة التطبيق */
window.addEventListener("online", function(){
  if (sheetUrl && pending.length) pushSnapshot().catch(function(){});
});

/* ---------- CENTRAL CALCULATION ENGINE ---------- */
function txForMonth(mk){ return state.tx.filter(function(t){ return t.monthKey === mk; }); }
function primaryTx(mk, owner){ return state.tx.filter(function(t){ return t.type === "income" && t.incomeType === "primary" && t.monthKey === mk && (owner == null || (t.owner || "مشترك") === owner); })[0] || null; }
function commitmentsForMonth(mk){
  return state.commitments.filter(function(c){
    if (c.recurring) return true;              // recurring counts every month
    return (c.monthKey || "") === mk;          // one-time only its month
  });
}
function calc(mk){
  var months = txForMonth(mk);
  var prim = months.filter(function(t){ return t.type === "income" && t.incomeType === "primary"; }).reduce(function(s,t){ return s + num(t.amount); }, 0);
  var addl = months.filter(function(t){ return t.type === "income" && t.incomeType !== "primary"; }).reduce(function(s,t){ return s + num(t.amount); }, 0);
  var income = prim + addl;
  var expenses = months.filter(function(t){ return t.type === "expense"; }).reduce(function(s,t){ return s + num(t.amount); }, 0);
  var commit = commitmentsForMonth(mk).reduce(function(s,c){ return s + num(c.amount); }, 0);
  var savingsAllocated = state.savings.filter(function(g){ return g.status !== "done"; }).reduce(function(s,g){ return s + num(g.monthlyContribution); }, 0);
  var remaining = income - expenses - commit - savingsAllocated;
  var outflow = expenses + commit + savingsAllocated;
  var consumption = income > 0 ? Math.min(999, Math.round(outflow / income * 100)) : 0;
  return { prim: prim, addl: addl, income: income, expenses: expenses, commit: commit, savings: savingsAllocated, remaining: remaining, outflow: outflow, consumption: consumption };
}

/* ---------- record ops (single source of truth) ---------- */
function saveTx(t){
  t.updatedAt = nowISO();
  if (!t.id) { t.id = uid(); t.createdAt = nowISO(); state.tx.push(t); }
  else {
    var i = state.tx.findIndex(function(x){ return x.id === t.id; });
    if (i >= 0) { t.createdAt = state.tx[i].createdAt || nowISO(); state.tx[i] = t; }
    else { t.createdAt = nowISO(); state.tx.push(t); }
  }
  t.monthKey = String(t.date).slice(0, 7);
  persist(); pushSnapshot(); renderAll();
  return t;
}
function deleteTx(id){
  var t = state.tx.filter(function(x){ return x.id === id; })[0];
  state.tx = state.tx.filter(function(x){ return x.id !== id; });
  if (t && t.invoiceId) {
    state.invoiceItems = state.invoiceItems.filter(function(it){ return it.invoiceId !== t.invoiceId; });
    state.invoices = state.invoices.filter(function(iv){ return iv.id !== t.invoiceId; });
  }
  persist(); pushSnapshot(); renderAll();
}

/* ---------- month nav ---------- */
$("mPrev").onclick = function(){ view.m--; if (view.m < 0){ view.m = 11; view.y--; } renderAll(); };
$("mNext").onclick = function(){ view.m++; if (view.m > 11){ view.m = 0; view.y++; } renderAll(); };

/* ---------- navigation ---------- */
function go(nav){
  document.querySelectorAll(".page").forEach(function(p){ p.classList.remove("active"); });
  var el = $("page-" + nav); if (el) el.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(function(b){ b.classList.toggle("active", b.getAttribute("data-nav") === nav); });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".nav-item").forEach(function(b){ b.onclick = function(){ go(b.getAttribute("data-nav")); }; });
document.querySelectorAll("[data-go]").forEach(function(b){ b.onclick = function(){ go(b.getAttribute("data-go")); }; });

/* ---------- theme ---------- */
(function(){ try { var t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) {} })();
$("themeBtn").onclick = function(){
  var root = document.documentElement, cur = root.getAttribute("data-theme");
  if (!cur) cur = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  var next = cur === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
};
$("syncBtn").onclick = function(){ if (sheetUrl){ toast("جاري المزامنة…"); pullSheet().then(syncDots).catch(function(){ toast("تعذّرت المزامنة", true); }); } else { renderAll(); toast("تم التحديث"); } };

/* =================== ADD / EDIT OPERATION =================== */
function openAdd(type, editId){
  var editing = editId ? state.tx.filter(function(x){ return x.id === editId; })[0] : null;
  var t = type || (editing ? editing.type : "expense");
  var dlg = $("dlgAdd");
  var isEdit = !!editing;
  var incType = editing ? (editing.incomeType || "additional") : "additional";
  var existingPrimary = primaryTx(monthKey());

  dlg.innerHTML =
    '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>' + (isEdit ? "تعديل عملية" : "إضافة عملية") + '</h3><button class="icon-btn" id="axClose" aria-label="إغلاق">✕</button></div>'
    + '<div class="seg" id="axType">'
    + '<button data-t="expense" class="' + (t === "expense" ? "on exp" : "") + '">مصروف</button>'
    + '<button data-t="income" class="' + (t === "income" ? "on inc" : "") + '">دخل</button></div>'
    + '<form id="axForm" novalidate>'
    + '<label class="field"><span class="lab">المبلغ (ر.س)</span><input id="axAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="' + (editing ? editing.amount : "") + '" /></label>'
    + '<div class="two"><label class="field"><span class="lab">المالك</span><select id="axOwner">' + OWNERS.map(function(o){ return '<option ' + ((editing ? (editing.owner||"مشترك") : ownerDefault()) === o ? "selected" : "") + '>' + o + '</option>'; }).join("") + '</select></label>'
    + '<label class="field"><span class="lab">الحساب</span><select id="axAccount">' + accounts().map(function(a){ return '<option ' + (editing && editing.account === a ? "selected" : "") + '>' + a + '</option>'; }).join("") + '</select></label></div>'
    + '<div id="axIncomeWrap" style="display:' + (t === "income" ? "block" : "none") + '">'
      + '<label class="field"><span class="lab">نوع الدخل</span>'
      + '<div class="seg" id="axIncType">'
      + '<button type="button" data-k="primary" class="' + (incType === "primary" ? "on" : "") + '">دخل رئيسي</button>'
      + '<button type="button" data-k="additional" class="' + (incType !== "primary" ? "on" : "") + '">دخل إضافي</button></div>'
      + '<span class="hint" id="axPrimHint"></span></label>'
      + '<label class="field"><span class="lab">المصدر</span><select id="axSource">' + INC_SOURCES.map(function(s){ return '<option ' + (editing && editing.category === s ? "selected" : "") + '>' + s + '</option>'; }).join("") + '</select></label>'
    + '</div>'
    + '<div id="axExpenseWrap" style="display:' + (t === "expense" ? "block" : "none") + '">'
      + '<label class="field"><span class="lab">الفئة</span><div class="chips" id="axCats"></div></label>'
      + '<label class="field"><span class="lab">التاجر / الوصف <span class="hint">(اختياري)</span></span><input id="axMerchant" value="' + esc(editing ? (editing.merchant || "") : "") + '" /></label>'
      + '<label class="field"><span class="lab">طريقة الدفع <span class="hint">(اختياري)</span></span><select id="axPay"><option value="">—</option>' + PAY_METHODS.map(function(p){ return '<option ' + (editing && editing.paymentMethod === p ? "selected" : "") + '>' + p + '</option>'; }).join("") + '</select></label>'
    + '</div>'
    + '<label class="field"><span class="lab">التاريخ (ميلادي)</span><input id="axDate" type="date" required value="' + (editing ? String(editing.date).slice(0,10) : todayStr()) + '" /></label>'
    + '<label class="field"><span class="lab">ملاحظات <span class="hint">(اختياري)</span></span><textarea id="axNotes">' + esc(editing ? (editing.notes || "") : "") + '</textarea></label>'
    + '<div class="two"><button type="submit" class="btn primary block" id="axSave">' + (isEdit ? "حفظ التعديل" : "حفظ") + '</button>'
    + (isEdit ? '<button type="button" class="btn danger" id="axDelete">حذف</button>' : '<button type="button" class="btn ghost" id="axCancel">إلغاء</button>') + '</div>'
    + '</form></div>';
  dlg.showModal();

  var selCat = editing && editing.type === "expense" ? editing.category : "الطعام والمطاعم";
  function drawCats(){
    var w = $("axCats"); if (!w) return; w.innerHTML = "";
    EXP_CATS.forEach(function(c){
      var b = document.createElement("button"); b.type = "button";
      b.className = "chip" + (c[0] === selCat ? " on" : "");
      b.textContent = c[1] + " " + c[0];
      b.onclick = function(){ selCat = c[0]; drawCats(); };
      w.appendChild(b);
    });
  }
  drawCats();

  var curType = t, curIncType = incType;
  function currentOwner(){ return $("axOwner") ? $("axOwner").value : "مشترك"; }
  function refreshPrimHint(){
    var h = $("axPrimHint"); if (!h) return;
    var ep = primaryTx(monthKey(), currentOwner());
    if (curType === "income" && curIncType === "primary" && ep && (!editing || editing.id !== ep.id)) {
      h.textContent = "يوجد دخل رئيسي لـ" + currentOwner() + " هذا الشهر (" + fmt(ep.amount) + ") — سيُحدَّث بدل تكراره.";
      h.style.color = "var(--warn)";
    } else { h.textContent = "الدخل الرئيسي واحد لكل مالك في الشهر."; h.style.color = "var(--muted)"; }
  }
  refreshPrimHint();

  dlg.querySelectorAll("#axType button").forEach(function(b){
    b.onclick = function(){
      curType = b.getAttribute("data-t");
      dlg.querySelectorAll("#axType button").forEach(function(x){ x.className = x === b ? ("on " + (curType === "expense" ? "exp" : "inc")) : ""; });
      $("axIncomeWrap").style.display = curType === "income" ? "block" : "none";
      $("axExpenseWrap").style.display = curType === "expense" ? "block" : "none";
      refreshPrimHint();
    };
  });
  dlg.querySelectorAll("#axIncType button").forEach(function(b){
    b.onclick = function(){ curIncType = b.getAttribute("data-k"); dlg.querySelectorAll("#axIncType button").forEach(function(x){ x.className = x === b ? "on" : ""; }); refreshPrimHint(); };
  });
  $("axOwner").onchange = refreshPrimHint;
  $("axClose").onclick = function(){ dlg.close(); };
  if ($("axCancel")) $("axCancel").onclick = function(){ dlg.close(); };
  if ($("axDelete")) $("axDelete").onclick = function(){ if (confirm("حذف هذه العملية نهائيًا؟")) { deleteTx(editing.id); dlg.close(); toast("تم الحذف"); } };

  var submitting = false;
  $("axForm").onsubmit = function(ev){
    ev.preventDefault();
    if (submitting) return; // dup-submit guard
    var amount = num($("axAmount").value);
    var date = $("axDate").value;
    if (amount <= 0) { toast("أدخل مبلغًا صحيحًا", true); return; }
    if (!validGregorian(date)) { toast("تاريخ ميلادي غير صحيح (YYYY-MM-DD)", true); return; }
    submitting = true; $("axSave").disabled = true;

    var owner = currentOwner(), account = $("axAccount") ? $("axAccount").value : "";
    if (curType === "income") {
      if (curIncType === "primary") {
        var existing = primaryTx(monthKey(), owner);
        var target = editing && editing.id ? editing : (existing || {});
        target.type = "income"; target.incomeType = "primary"; target.owner = owner; target.account = account;
        target.amount = amount; target.date = date; target.category = $("axSource").value;
        target.notes = $("axNotes").value.trim(); target.source = "manual";
        saveTx(target);
        toast(existing && (!editing || editing.id !== existing.id) ? "تم تحديث الدخل الرئيسي ✓" : "تم الحفظ ✓");
      } else {
        var inc = editing && editing.id ? editing : {};
        inc.type = "income"; inc.incomeType = "additional"; inc.owner = owner; inc.account = account;
        inc.amount = amount; inc.date = date; inc.category = $("axSource").value;
        inc.notes = $("axNotes").value.trim(); inc.source = "manual";
        saveTx(inc); toast("تم حفظ الدخل ✓");
      }
    } else {
      var ex = editing && editing.id ? editing : {};
      ex.type = "expense"; delete ex.incomeType; ex.owner = owner; ex.account = account;
      ex.amount = amount; ex.date = date; ex.category = selCat;
      ex.merchant = $("axMerchant").value.trim(); ex.paymentMethod = $("axPay").value;
      ex.notes = $("axNotes").value.trim(); if (!ex.source) ex.source = "manual";
      saveTx(ex); toast("تم حفظ المصروف ✓");
    }
    dlg.close();
  };
}
$("fabAdd").onclick = function(){ openAdd("expense"); };
document.querySelectorAll("[data-add]").forEach(function(b){ b.onclick = function(){ openAdd(b.getAttribute("data-add")); }; });

/* =================== DETAIL =================== */
function openDetail(id){
  var t = state.tx.filter(function(x){ return x.id === id; })[0];
  if (!t) return;
  var dlg = $("dlgDetail");
  var items = t.invoiceId ? state.invoiceItems.filter(function(it){ return it.invoiceId === t.invoiceId; }) : [];
  var inv = t.invoiceId ? state.invoices.filter(function(iv){ return iv.id === t.invoiceId; })[0] : null;
  var typeLabel = t.type === "income" ? (t.incomeType === "primary" ? "دخل رئيسي" : "دخل إضافي") : "مصروف";
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>تفاصيل العملية</h3><button class="icon-btn" id="dxClose" aria-label="إغلاق">✕</button></div>'
    + '<div class="drow"><span class="k">النوع</span><span class="v">' + typeLabel + '</span></div>'
    + '<div class="drow"><span class="k">المبلغ</span><span class="v num">' + fmt(t.amount) + '</span></div>'
    + '<div class="drow"><span class="k">' + (t.type === "income" ? "المصدر" : "الفئة") + '</span><span class="v">' + esc(t.category || "—") + '</span></div>'
    + (t.merchant ? '<div class="drow"><span class="k">التاجر</span><span class="v">' + esc(t.merchant) + '</span></div>' : "")
    + (t.paymentMethod ? '<div class="drow"><span class="k">طريقة الدفع</span><span class="v">' + esc(t.paymentMethod) + '</span></div>' : "")
    + '<div class="drow"><span class="k">التاريخ</span><span class="v num">' + fmtG(t.date) + '</span></div>'
    + '<div class="drow"><span class="k">المصدر</span><span class="v">' + (t.source === "receipt" ? "مسح فاتورة 🧾" : "إدخال يدوي") + '</span></div>'
    + (t.notes ? '<div class="drow"><span class="k">ملاحظات</span><span class="v">' + esc(t.notes) + '</span></div>' : "")
    + (inv ? '<div class="drow"><span class="k">الإجمالي الفرعي</span><span class="v num">' + fmt(inv.subtotal) + '</span></div><div class="drow"><span class="k">الضريبة</span><span class="v num">' + fmt(inv.vat) + '</span></div>' : "")
    + (items.length ? '<div class="sec-h"><h3>أصناف الفاتورة</h3></div>' + items.map(function(it){ return '<div class="drow"><span class="k">' + esc(it.itemName) + ' ×' + (it.quantity||1).toLocaleString("ar-SA") + '</span><span class="v num">' + fmt(it.totalPrice) + '</span></div>'; }).join("") : "")
    + (t.receiptImage ? '<img class="rcpt-preview" src="' + t.receiptImage + '" alt="صورة الفاتورة" />' : "")
    + '<div class="drow"><span class="k">أُنشئ</span><span class="v num" style="font-size:.8rem;color:var(--muted)">' + fmtG(t.createdAt) + '</span></div>'
    + '<div class="drow"><span class="k">آخر تعديل</span><span class="v num" style="font-size:.8rem;color:var(--muted)">' + fmtG(t.updatedAt) + '</span></div>'
    + '<div class="two" style="margin-top:14px"><button class="btn primary" id="dxEdit">تعديل</button><button class="btn danger" id="dxDel">حذف</button></div>'
    + '</div>';
  dlg.showModal();
  $("dxClose").onclick = function(){ dlg.close(); };
  $("dxEdit").onclick = function(){ dlg.close(); openAdd(t.type, t.id); };
  $("dxDel").onclick = function(){ if (confirm("حذف هذه العملية" + (items.length ? " وكل أصنافها" : "") + " نهائيًا؟")) { deleteTx(t.id); dlg.close(); toast("تم الحذف"); } };
}

/* =================== RECEIPT SCAN + REVIEW =================== */
$("qaReceipt").onclick = openReceiptChooser;
function openReceiptChooser(){
  var dlg = $("dlgReceipt");
  // زر واحد فقط + مدخل واحد (accept=image/* بلا capture) => المتصفح يعرض: تصوير/المكتبة/ملف
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>مسح فاتورة</h3><button class="icon-btn" id="rcClose" aria-label="إغلاق">✕</button></div>'
    + '<p class="meta" style="color:var(--muted);margin-bottom:14px">اضغط الزر ثم اختر «التقاط صورة» أو «مكتبة الصور» أو «ملف». نقرأ الفاتورة تلقائيًا ونعرضها للمراجعة قبل الحفظ.</p>'
    + '<button class="btn primary block" id="rcPick">🧾 تصوير أو اختيار الفاتورة</button>'
    + '<div id="rcProgress" style="display:none;margin-top:14px">'
      + '<div class="ptrack" style="background:var(--surface-2)"><div class="pbar" id="rcBar" style="background:var(--primary)"></div></div>'
      + '<div class="meta" id="rcStatus" style="color:var(--muted);font-size:12px;margin-top:6px">…</div></div>'
    + '<div style="text-align:center;margin-top:14px"><button class="text-btn" id="rcManual">إدخال فاتورة يدويًا بدون صورة</button></div>'
    + '</div>';
  dlg.showModal();
  $("rcClose").onclick = function(){ dlg.close(); };
  $("rcPick").onclick = function(){ $("receiptInput").click(); };
  $("rcManual").onclick = function(){ dlg.close(); openReceiptReview(null, null); };
}
function ocrProgress(pct, msg){ var p = $("rcProgress"), b = $("rcBar"), s = $("rcStatus"); if (!p) return; p.style.display = "block"; b.style.width = Math.max(3, Math.min(100, pct)) + "%"; s.textContent = msg; }

$("receiptInput").onchange = function(){ var f = this.files[0]; this.value = ""; if (f) runOCR(f); };

// معالجة الصورة عبر Canvas: توجيه/تحجيم/رمادي/تباين + حد للبكسلات
function preprocessImage(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error("read")); };
    reader.onload = function(){
      var dataUrl = reader.result;
      var img = new Image();
      img.onload = function(){
        var maxPixels = 1600 * 1600;            // حد لتفادي انهيار ذاكرة iPhone
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, Math.sqrt(maxPixels / (w * h)));
        // لا نصغّر الفواتير الطويلة أكثر من اللازم
        var cw = Math.max(600, Math.round(w * scale)), ch = Math.round(h * (Math.max(600, Math.round(w*scale)) / w));
        var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
        var ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0, cw, ch);
        try {
          var im = ctx.getImageData(0, 0, cw, ch), d = im.data;
          for (var i = 0; i < d.length; i += 4){
            var g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
            g = (g - 128) * 1.35 + 128;          // تباين
            g = g < 0 ? 0 : g > 255 ? 255 : g;
            d[i] = d[i+1] = d[i+2] = g;           // رمادي
          }
          ctx.putImageData(im, 0, 0);
        } catch(e){ /* تجاهل لو تعذّر */ }
        resolve({ canvas: cv, dataUrl: dataUrl });
      };
      img.onerror = function(){ reject(new Error("image")); };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function runOCR(file){
  ocrProgress(5, "جاري تحسين الصورة…");
  var origData = null;
  preprocessImage(file).then(function(pre){
    origData = pre.dataUrl;
    if (typeof Tesseract === "undefined"){
      ocrProgress(100, "المكتبة غير متاحة — انتقل للمراجعة اليدوية");
      setTimeout(function(){ $("dlgReceipt").close(); openReceiptReview(origData, null); toast("تعذّر تحميل قارئ النص — راجع يدويًا", true); }, 600);
      return;
    }
    ocrProgress(15, "جاري تجهيز القارئ (عربي + إنجليزي)…");
    Tesseract.recognize(pre.canvas, "ara+eng", {
      logger: function(m){ if (m.status === "recognizing text") ocrProgress(20 + Math.round(m.progress * 75), "جاري القراءة… " + Math.round(m.progress * 100) + "%"); }
    }).then(function(res){
      ocrProgress(100, "تمت القراءة — جاري التحليل…");
      var text = (res && res.data && res.data.text) || "";
      var parsed = window.ReceiptParser ? window.ReceiptParser.parseReceipt(text) : null;
      setTimeout(function(){ $("dlgReceipt").close(); openReceiptReview(origData, parsed, text); }, 400);
    }).catch(function(){
      ocrProgress(100, "تعذّرت القراءة");
      setTimeout(function(){ $("dlgReceipt").close(); openReceiptReview(origData, null); toast("تعذّرت قراءة النص — راجع يدويًا", true); }, 600);
    });
  }).catch(function(){
    $("dlgReceipt").close(); openReceiptReview(null, null); toast("تعذّرت قراءة الصورة", true);
  });
}

function openReceiptReview(imgData, parsed, rawText){
  var dlg = $("dlgReceipt");
  var isPayment = parsed && parsed.type === "payment";
  var items = (parsed && parsed.items && parsed.items.length)
    ? parsed.items.map(function(it){ return { name: it.name, qty: it.quantity, price: it.unitPrice }; })
    : [{ name: "", qty: 1, price: "" }];
  var pTotal = parsed && parsed.total != null ? parsed.total : "";
  var pSub = parsed && parsed.subtotal != null ? parsed.subtotal : "";
  var pVat = parsed && parsed.vat != null ? parsed.vat : "";
  var pDisc = parsed && parsed.discount != null ? parsed.discount : "";
  var confirmedMismatch = false;

  var banner = parsed
    ? (isPayment
        ? '<div class="alert warn"><span class="ic">💳</span><span>تم التعرّف على <b>إيصال دفع بنكي</b> — سيُحفظ كعملية مصروف واحدة (بلا أصناف). راجع المبلغ والتاجر.</span></div>'
        : '<div class="alert warn"><span class="ic">🧾</span><span>تم التعرّف على <b>فاتورة تجزئة</b> — راجع الأصناف والإجمالي قبل الحفظ.</span></div>')
    : '<div class="alert warn"><span class="ic">✍️</span><span>راجع الحقول يدويًا — لن يُحفظ شيء تلقائيًا.</span></div>';

  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>مراجعة الفاتورة</h3><button class="icon-btn" id="rvClose" aria-label="إغلاق">✕</button></div>'
    + banner
    + (imgData ? '<img class="rcpt-preview" src="' + imgData + '" alt="الفاتورة" style="margin-bottom:12px" />' : "")
    + '<form id="rvForm" novalidate>'
    + '<label class="field"><span class="lab">اسم التاجر</span><input id="rvMerchant" class="' + (parsed && parsed.merchant ? "" : "flag") + '" value="' + esc(parsed ? (parsed.merchant||"") : "") + '" placeholder="اكتب اسم المتجر" /></label>'
    + '<div class="two"><label class="field"><span class="lab">رقم المرجع <span class="hint">(اختياري)</span></span><input id="rvRef" value="' + esc(parsed ? (parsed.reference||"") : "") + '" /></label>'
    + '<label class="field"><span class="lab">الوقت <span class="hint">(اختياري)</span></span><input id="rvTime" value="' + esc(parsed ? (parsed.time||"") : "") + '" placeholder="00:00" /></label></div>'
    + '<div class="two"><label class="field"><span class="lab">التاريخ الميلادي</span><input id="rvDate" class="' + (parsed && parsed.date ? "" : "flag") + '" type="date" value="' + (parsed && parsed.date ? parsed.date : todayStr()) + '" required /></label>'
    + '<label class="field"><span class="lab">المالك</span><select id="rvOwner">' + OWNERS.map(function(o){ return '<option ' + (o === ownerDefault() ? "selected" : "") + '>' + o + '</option>'; }).join("") + '</select></label></div>'
    + '<div class="two"><label class="field"><span class="lab">الفئة</span><select id="rvCat">' + EXP_CATS.map(function(c){ return '<option>' + c[0] + '</option>'; }).join("") + '</select></label>'
    + '<label class="field"><span class="lab">الحساب</span><select id="rvAccount">' + accounts().map(function(a){ return '<option>' + a + '</option>'; }).join("") + '</select></label></div>'
    + '<div class="two"><label class="field"><span class="lab">طريقة الدفع</span><select id="rvPay"><option value="">—</option>' + PAY_METHODS.map(function(p){ return '<option>' + p + '</option>'; }).join("") + '</select></label>'
    + '<label class="field"><span class="lab">الخصم <span class="hint">(اختياري)</span></span><input id="rvDisc" type="number" inputmode="decimal" step="0.01" value="' + pDisc + '" placeholder="0" /></label></div>'
    + '<div id="rvItemsWrap" style="display:' + (isPayment ? "none" : "block") + '">'
      + '<div class="sec-h" style="margin:6px 2px"><h3>الأصناف</h3><button type="button" class="text-btn" id="rvAddItem">+ صنف</button></div>'
      + '<div id="rvItems"></div>'
      + '<div class="two"><label class="field"><span class="lab">الإجمالي الفرعي</span><input id="rvSub" type="number" inputmode="decimal" step="0.01" value="' + pSub + '" placeholder="0" /></label>'
      + '<label class="field"><span class="lab">الضريبة</span><input id="rvVat" type="number" inputmode="decimal" step="0.01" value="' + pVat + '" placeholder="0" /></label></div>'
      + '<div class="rsum" id="rvCheck"><span>مجموع الأصناف</span><span class="num" id="rvItemsSum">٠ ر.س</span></div>'
    + '</div>'
    + '<label class="field"><span class="lab">الإجمالي النهائي (ر.س)</span><input id="rvTotal" class="' + (pTotal ? "" : "flag") + '" type="number" inputmode="decimal" step="0.01" value="' + pTotal + '" placeholder="0" required /></label>'
    + '<label class="field"><span class="lab">ملاحظات <span class="hint">(اختياري)</span></span><textarea id="rvNotes"></textarea></label>'
    + '<div id="rvWarn" class="alert danger" style="display:none"><span class="ic">⚠️</span><span id="rvWarnT"></span></div>'
    + '<button type="submit" class="btn primary block" id="rvSave" style="margin-top:6px">حفظ ' + (isPayment ? "العملية" : "الفاتورة") + '</button>'
    + '</form></div>';
  dlg.showModal();
  $("rvClose").onclick = function(){ dlg.close(); };

  function drawItems(){
    var w = $("rvItems"); if (!w) return; w.innerHTML = "";
    items.forEach(function(it, idx){
      var row = document.createElement("div"); row.className = "ritem";
      row.innerHTML = '<input placeholder="اسم الصنف" aria-label="اسم الصنف" value="' + esc(it.name) + '" />'
        + '<input type="number" inputmode="decimal" placeholder="كمية" aria-label="الكمية" value="' + (it.qty === "" ? "" : it.qty) + '" />'
        + '<input type="number" inputmode="decimal" placeholder="سعر" aria-label="سعر الوحدة" value="' + (it.price === "" ? "" : it.price) + '" />'
        + '<button type="button" class="mini danger" aria-label="حذف الصنف">✕</button>';
      var ins = row.querySelectorAll("input");
      ins[0].oninput = function(){ it.name = this.value; };
      ins[1].oninput = function(){ it.qty = this.value; recompute(); };
      ins[2].oninput = function(){ it.price = this.value; recompute(); };
      row.querySelector("button").onclick = function(){ items.splice(idx, 1); if (!items.length) items.push({ name:"", qty:1, price:"" }); drawItems(); recompute(); };
      w.appendChild(row);
    });
  }
  function realItemsList(){ return items.filter(function(it){ return it.name.trim() && num(it.price) > 0; }); }
  function validDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime()); }
  function recompute(){
    var total = num($("rvTotal").value);
    var ri = realItemsList();
    var sum = ri.reduce(function(s, it){ return s + num(it.qty) * num(it.price); }, 0);
    var mismatch = false;
    if (!isPayment){
      if ($("rvItemsSum")) $("rvItemsSum").textContent = fmt(sum);
      var chk = $("rvCheck");
      if (ri.length && total > 0){
        var v = window.ReceiptParser.validateItemSum(ri.map(function(x){ return { total: num(x.qty)*num(x.price) }; }), total, { subtotal: num($("rvSub").value)||null, vat: num($("rvVat").value)||null });
        mismatch = !v.ok;
        if (chk) chk.className = "rsum" + (mismatch ? " mismatch" : "");
        if (mismatch && $("rvItemsSum")) $("rvItemsSum").textContent = fmt(sum) + " ⚠ لا يطابق الإجمالي";
      } else if (chk) chk.className = "rsum";
    }
    // disable-save logic
    var invalid = total <= 0 || !validDate($("rvDate").value) || (mismatch && !confirmedMismatch);
    var warn = $("rvWarn"), wt = $("rvWarnT");
    if (mismatch && !confirmedMismatch){
      warn.style.display = "flex";
      wt.innerHTML = 'مجموع الأصناف (' + fmt(sum) + ') لا يطابق الإجمالي (' + fmt(total) + '). صحّح الأصناف أو <a href="#" id="rvConfirm">أؤكد الحفظ رغم ذلك</a>.';
      var cf = $("rvConfirm"); if (cf) cf.onclick = function(e){ e.preventDefault(); confirmedMismatch = true; recompute(); };
    } else warn.style.display = "none";
    $("rvSave").disabled = invalid;
    $("rvSave").style.opacity = invalid ? ".55" : "1";
  }
  if (!isPayment){
    $("rvAddItem").onclick = function(){ items.push({ name:"", qty:1, price:"" }); drawItems(); recompute(); };
    $("rvSub").oninput = recompute; $("rvVat").oninput = recompute;
    $("rvTotal").oninput = function(){
      var t = num(this.value);
      if (t > 0 && !num($("rvSub").value)){ var sub = t/1.15; $("rvSub").value = sub.toFixed(2); $("rvVat").value = (t-sub).toFixed(2); }
      recompute();
    };
    drawItems();
  } else {
    $("rvTotal").oninput = recompute;
  }
  $("rvDate").oninput = recompute;
  recompute();

  var submitting = false;
  $("rvForm").onsubmit = function(ev){
    ev.preventDefault();
    if (submitting || $("rvSave").disabled) return;
    var total = num($("rvTotal").value);
    var merchant = $("rvMerchant").value.trim() || (isPayment ? "عملية دفع" : "فاتورة");
    var date = $("rvDate").value;
    submitting = true; $("rvSave").disabled = true;
    var owner = $("rvOwner").value, account = $("rvAccount").value;
    var invId = uid();
    var ri = realItemsList();
    if (!isPayment){
      var inv = { id: invId, merchant: merchant, invoiceDate: date, monthKey: date.slice(0,7),
        subtotal: num($("rvSub").value), vat: num($("rvVat").value), discount: num($("rvDisc").value), total: total,
        category: $("rvCat").value, owner: owner, account: account, receiptImage: imgData || "", reference: $("rvRef").value.trim(),
        source: "receipt", createdAt: nowISO(), updatedAt: nowISO() };
      state.invoices.push(inv);
      ri.forEach(function(it){ state.invoiceItems.push({ id: uid(), invoiceId: invId, itemName: it.name.trim(), quantity: num(it.qty)||1, unitPrice: num(it.price), totalPrice: +(num(it.qty)*num(it.price)).toFixed(2) }); });
    }
    // عملية مصروف أب واحدة تمثّل الفاتورة/الإيصال في المجاميع
    saveTx({ type: "expense", amount: total, date: date, category: $("rvCat").value, merchant: merchant,
      owner: owner, account: account, paymentMethod: $("rvPay").value, reference: $("rvRef").value.trim(),
      time: $("rvTime").value.trim(), notes: $("rvNotes").value.trim() || (ri.length ? ri.length + " أصناف" : (isPayment ? "إيصال دفع" : "")),
      source: "receipt", invoiceId: isPayment ? null : invId, receiptImage: imgData || "" });
    dlg.close(); toast(isPayment ? "تم حفظ عملية الدفع ✓" : "تم حفظ الفاتورة ✓");
  };
}

/* =================== COMMITMENTS =================== */
$("addCommit").onclick = function(){ openCommit(); };
function openCommit(editId){
  var c = editId ? state.commitments.filter(function(x){ return x.id === editId; })[0] : null;
  var dlg = $("dlgCommit");
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>' + (c ? "تعديل التزام" : "إضافة التزام") + '</h3><button class="icon-btn" id="cmClose" aria-label="إغلاق">✕</button></div>'
    + '<form id="cmForm" novalidate>'
    + '<label class="field"><span class="lab">الاسم</span><input id="cmName" required value="' + esc(c ? c.name : "") + '" placeholder="مثال: إيجار الشقة" /></label>'
    + '<div class="two"><label class="field"><span class="lab">المبلغ (ر.س)</span><input id="cmAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="' + (c ? c.amount : "") + '" /></label>'
    + '<label class="field"><span class="lab">يوم الاستحقاق</span><input id="cmDay" type="number" min="1" max="28" value="' + (c ? (c.dueDay || 1) : 1) + '" /></label></div>'
    + '<label class="field"><span class="lab">الفئة</span><select id="cmCat">' + COMMIT_CATS.map(function(x){ return '<option ' + (c && c.category === x ? "selected" : "") + '>' + x + '</option>'; }).join("") + '</select></label>'
    + '<label class="field check-row" style="display:flex;align-items:center;gap:10px"><input id="cmRecurring" type="checkbox" style="width:18px;height:18px" ' + (!c || c.recurring ? "checked" : "") + ' /><span class="lab" style="margin:0">التزام متكرر شهريًا</span></label>'
    + '<label class="field"><span class="lab">ملاحظات <span class="hint">(اختياري)</span></span><textarea id="cmNotes">' + esc(c ? (c.notes || "") : "") + '</textarea></label>'
    + '<div class="two"><button type="submit" class="btn primary">حفظ</button>' + (c ? '<button type="button" class="btn danger" id="cmDel">حذف</button>' : '<button type="button" class="btn ghost" id="cmCancel">إلغاء</button>') + '</div>'
    + '</form></div>';
  dlg.showModal();
  $("cmClose").onclick = function(){ dlg.close(); };
  if ($("cmCancel")) $("cmCancel").onclick = function(){ dlg.close(); };
  if ($("cmDel")) $("cmDel").onclick = function(){ if (confirm("حذف الالتزام؟")) { state.commitments = state.commitments.filter(function(x){ return x.id !== c.id; }); persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم الحذف"); } };
  var busy = false;
  $("cmForm").onsubmit = function(ev){
    ev.preventDefault(); if (busy) return;
    var amount = num($("cmAmount").value); if (amount <= 0) { toast("أدخل مبلغًا صحيحًا", true); return; }
    busy = true;
    var obj = c || { id: uid(), paid: {}, createdAt: nowISO() };
    obj.name = $("cmName").value.trim(); obj.amount = amount; obj.dueDay = parseInt($("cmDay").value, 10) || 1;
    obj.category = $("cmCat").value; obj.recurring = $("cmRecurring").checked; obj.notes = $("cmNotes").value.trim();
    obj.monthKey = obj.recurring ? "" : monthKey(); obj.updatedAt = nowISO();
    if (!c) state.commitments.push(obj);
    persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم الحفظ ✓");
  };
}

/* =================== SAVINGS =================== */
$("addSaving").onclick = function(){ openSaving(); };
function openSaving(editId){
  var g = editId ? state.savings.filter(function(x){ return x.id === editId; })[0] : null;
  var dlg = $("dlgSaving");
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>' + (g ? "تعديل هدف" : "هدف ادخار") + '</h3><button class="icon-btn" id="svClose" aria-label="إغلاق">✕</button></div>'
    + '<form id="svForm" novalidate>'
    + '<label class="field"><span class="lab">اسم الهدف</span><input id="svName" required value="' + esc(g ? g.goalName : "") + '" placeholder="مثال: صندوق الطوارئ" /></label>'
    + '<div class="two"><label class="field"><span class="lab">المبلغ المستهدف</span><input id="svTarget" type="number" inputmode="decimal" step="0.01" min="0" required value="' + (g ? g.targetAmount : "") + '" /></label>'
    + '<label class="field"><span class="lab">المدّخر حاليًا</span><input id="svCurrent" type="number" inputmode="decimal" step="0.01" min="0" value="' + (g ? g.currentAmount : 0) + '" /></label></div>'
    + '<div class="two"><label class="field"><span class="lab">اقتطاع شهري</span><input id="svMonthly" type="number" inputmode="decimal" step="0.01" min="0" value="' + (g ? g.monthlyContribution : "") + '" /></label>'
    + '<label class="field"><span class="lab">تاريخ مستهدف <span class="hint">(اختياري)</span></span><input id="svDate" type="date" value="' + (g && g.targetDate ? g.targetDate : "") + '" /></label></div>'
    + '<p class="meta" style="color:var(--muted);font-size:12px;margin-bottom:12px">الاقتطاع الشهري يُخصم من «المتبقي» كمبلغ مُخصَّص للادخار (لا يُحسب مرتين).</p>'
    + '<div class="two"><button type="submit" class="btn primary">حفظ</button>' + (g ? '<button type="button" class="btn danger" id="svDel">حذف</button>' : '<button type="button" class="btn ghost" id="svCancel">إلغاء</button>') + '</div>'
    + '</form></div>';
  dlg.showModal();
  $("svClose").onclick = function(){ dlg.close(); };
  if ($("svCancel")) $("svCancel").onclick = function(){ dlg.close(); };
  if ($("svDel")) $("svDel").onclick = function(){ if (confirm("حذف الهدف؟")) { state.savings = state.savings.filter(function(x){ return x.id !== g.id; }); persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم الحذف"); } };
  var busy = false;
  $("svForm").onsubmit = function(ev){
    ev.preventDefault(); if (busy) return;
    var target = num($("svTarget").value); if (target <= 0) { toast("أدخل مبلغًا مستهدفًا", true); return; }
    busy = true;
    var obj = g || { id: uid(), createdAt: nowISO() };
    obj.goalName = $("svName").value.trim(); obj.targetAmount = target; obj.currentAmount = num($("svCurrent").value);
    obj.monthlyContribution = num($("svMonthly").value); obj.targetDate = $("svDate").value;
    obj.status = obj.currentAmount >= obj.targetAmount ? "done" : "active"; obj.updatedAt = nowISO();
    if (!g) state.savings.push(obj);
    persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم الحفظ ✓");
  };
}

/* =================== SHEETS CONFIG =================== */
$("cfgSheet").onclick = function(){
  var dlg = $("dlgSheet");
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>ربط قوقل شيت</h3><button class="icon-btn" id="shClose" aria-label="إغلاق">✕</button></div>'
    + '<p class="meta" style="color:var(--muted);margin-bottom:12px">الصق رابط تطبيق الويب من Google Apps Script (ينتهي بـ /exec). يعمل الربط في الخلفية ويحفظ بياناتك تلقائيًا. لا تُخزَّن أي أسرار داخل التطبيق.</p>'
    + '<label class="field"><span class="lab">رابط /exec</span><input id="shUrl" dir="ltr" value="' + esc(sheetUrl) + '" placeholder="https://script.google.com/macros/s/.../exec" /></label>'
    + '<div class="two"><button class="btn primary" id="shSave">' + (sheetUrl ? "تحديث" : "ربط") + '</button>' + (sheetUrl ? '<button class="btn danger" id="shUnlink">فصل</button>' : '<button class="btn ghost" id="shCancel">إلغاء</button>') + '</div>'
    + '</div>';
  dlg.showModal();
  $("shClose").onclick = function(){ dlg.close(); };
  if ($("shCancel")) $("shCancel").onclick = function(){ dlg.close(); };
  if ($("shUnlink")) $("shUnlink").onclick = function(){ sheetUrl = ""; try { localStorage.removeItem(SHEET_URL_KEY); } catch (e) {} syncDots(); dlg.close(); toast("تم الفصل"); };
  $("shSave").onclick = function(){
    var u = $("shUrl").value.trim();
    if (u.indexOf("https://script.google.com/") !== 0) { toast("رابط غير صحيح", true); return; }
    toast("جاري الربط…");
    fetch(u + "?t=" + Date.now()).then(function(r){ return r.json(); }).then(function(d){
      sheetUrl = u; try { localStorage.setItem(SHEET_URL_KEY, u); } catch (e) {}
      if (d && d.sheetUrl) { sheetViewUrl = d.sheetUrl; try { localStorage.setItem(SHEET_VIEW_KEY, sheetViewUrl); } catch (e) {} }
      // merge remote into local by id then push snapshot back
      if (d && d.data) {
        ["tx","invoices","invoiceItems","commitments","savings"].forEach(function(k){
          if (Array.isArray(d.data[k])) {
            var ids = {}; state[k].forEach(function(x){ ids[x.id] = 1; });
            d.data[k].forEach(function(x){ if (!ids[x.id]) state[k].push(x); });
          }
        });
      }
      return pushSnapshot();
    }).then(function(){ persist(); renderAll(); syncDots(); dlg.close(); toast("تم الربط ✓"); })
      .catch(function(){ sheetUrl = ""; try { localStorage.removeItem(SHEET_URL_KEY); } catch (e) {} toast("فشل الربط — تأكد من صلاحية Anyone", true); });
  };
};
$("openSheet").onclick = function(){
  var v = sheetViewUrl;
  if (!v) { v = prompt("الصق رابط جدول قوقل شيت (docs.google.com/spreadsheets):", ""); if (v) { sheetViewUrl = v.trim(); try { localStorage.setItem(SHEET_VIEW_KEY, sheetViewUrl); } catch (e) {} v = sheetViewUrl; } }
  if (v) window.open(v, "_blank"); else toast("اربط قوقل شيت أولًا", true);
};
$("carryFwd").onclick = function(){
  // copy previous month's primary income if current has none
  var prevM = view.m - 1, prevY = view.y; if (prevM < 0){ prevM = 11; prevY--; }
  var prevKey = monthKey(prevY, prevM), curKey = monthKey();
  var curPrim = primaryTx(curKey), prevPrim = primaryTx(prevKey);
  if (!curPrim && prevPrim) {
    saveTx({ type: "income", incomeType: "primary", amount: prevPrim.amount, date: curKey + "-01", category: prevPrim.category || "راتب", notes: "مُرحَّل", source: "manual" });
    toast("تم ترحيل الدخل الرئيسي ✓");
  } else if (curPrim) { toast("يوجد دخل رئيسي لهذا الشهر بالفعل"); }
  else { toast("لا يوجد دخل رئيسي سابق للترحيل", true); }
};

/* =================== BACKUP =================== */
$("exportBtn").onclick = function(){ var ta = $("ioText"); ta.style.display = "block"; ta.value = JSON.stringify(state); ta.select(); try { document.execCommand("copy"); } catch (e) {} $("ioHint").style.display = "block"; $("ioHint").textContent = "انسخ النص واحفظه في مكان آمن."; };
$("importBtn").onclick = function(){
  var ta = $("ioText");
  if (ta.style.display === "none" || !ta.value.trim()) { ta.style.display = "block"; ta.value = ""; ta.placeholder = "الصق النسخة ثم اضغط استيراد مرة ثانية"; ta.focus(); return; }
  try { var d = JSON.parse(ta.value); if (!Array.isArray(d.tx)) throw 0;
    state = Object.assign({ tx:[],invoices:[],invoiceItems:[],commitments:[],savings:[],meta:{} }, d);
    ["tx","invoices","invoiceItems","commitments","savings"].forEach(function(k){ if (!Array.isArray(state[k])) state[k] = []; });
    persist(); pushSnapshot(); renderAll(); ta.style.display = "none"; toast("تم الاستيراد ✓");
  } catch (e) { $("ioHint").style.display = "block"; $("ioHint").textContent = "نسخة غير صالحة."; }
};
$("wipeBtn").onclick = function(){ if (!confirm("مسح كل البيانات نهائيًا" + (sheetUrl ? " (ومن قوقل شيت)" : "") + "؟")) return; state = { tx:[],invoices:[],invoiceItems:[],commitments:[],savings:[],meta:{ _allowEmptyPush: true } }; persist(); pushSnapshot(); renderAll(); toast("تم المسح"); };

/* =================== REPORT DOWNLOAD =================== */
$("dlReport").onclick = function(){
  var mk = monthKey(), c = calc(mk);
  var months = txForMonth(mk);
  var byCat = {}; months.filter(function(t){ return t.type === "expense"; }).forEach(function(t){ byCat[t.category] = (byCat[t.category]||0) + num(t.amount); });
  var catRows = Object.keys(byCat).map(function(k){ return [k, byCat[k]]; }).sort(function(a,b){ return b[1]-a[1]; });
  var txRows = months.slice().sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  var doc = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تقرير مصروفاتي — ' + AR_MONTHS[view.m] + ' ' + view.y + '</title>'
    + '<style>body{font-family:-apple-system,"Segoe UI",Tahoma,sans-serif;color:#261f24;padding:26px;max-width:760px;margin:auto}'
    + 'h1{color:#602650;margin:0}.sub{color:#746a71;margin:2px 0 18px}h2{color:#602650;font-size:1.05rem;border-bottom:2px solid #f3edf1;padding-bottom:4px;margin:22px 0 8px}'
    + '.cards{display:flex;gap:10px;flex-wrap:wrap}.c{border:1px solid #e8e0e5;border-radius:12px;padding:11px 15px;min-width:120px}.c .k{font-size:.78rem;color:#746a71}.c .v{font-size:1.25rem;font-weight:800}'
    + 'table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{border-bottom:1px solid #eee;padding:7px;text-align:right}th{color:#746a71;font-size:.78rem}td.n{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}'
    + '.btn{background:#602650;color:#fff;border:0;border-radius:9px;padding:10px 20px;cursor:pointer}@media print{.np{display:none}body{padding:0}}</style></head><body>'
    + '<div class="np" style="text-align:left"><button class="btn" onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>'
    + '<h1>مصروفاتي — تقرير الشهر</h1><p class="sub">' + AR_MONTHS[view.m] + ' ' + view.y + '</p>'
    + '<div class="cards"><div class="c"><div class="k">إجمالي الدخل</div><div class="v">' + fmt(c.income) + '</div></div>'
    + '<div class="c"><div class="k">المصروفات</div><div class="v">' + fmt(c.expenses) + '</div></div>'
    + '<div class="c"><div class="k">الالتزامات</div><div class="v">' + fmt(c.commit) + '</div></div>'
    + '<div class="c"><div class="k">المدخرات</div><div class="v">' + fmt(c.savings) + '</div></div>'
    + '<div class="c"><div class="k">المتبقي</div><div class="v">' + fmt(c.remaining) + '</div></div></div>'
    + (catRows.length ? '<h2>المصروفات حسب الفئة</h2><table><tr><th>الفئة</th><th>المبلغ</th><th>النسبة</th></tr>' + catRows.map(function(e){ return '<tr><td>' + esc(e[0]) + '</td><td class="n">' + fmt(e[1]) + '</td><td class="n">' + (c.expenses ? Math.round(e[1]/c.expenses*100) : 0) + '%</td></tr>'; }).join("") + '</table>' : "")
    + '<h2>سجل العمليات (' + txRows.length.toLocaleString("ar-SA") + ')</h2><table><tr><th>التاريخ</th><th>النوع</th><th>الفئة/المصدر</th><th>ملاحظة</th><th>المبلغ</th></tr>'
    + (txRows.map(function(t){ return '<tr><td class="n">' + fmtG(t.date) + '</td><td>' + (t.type === "income" ? "دخل" : "مصروف") + '</td><td>' + esc(t.category||"—") + '</td><td>' + esc(t.merchant || t.notes || "—") + '</td><td class="n">' + (t.type==="income"?"+":"−") + fmt(t.amount) + '</td></tr>'; }).join("") || '<tr><td colspan="5">لا عمليات</td></tr>')
    + '</table><p style="color:#9a8391;font-size:.78rem;text-align:center;margin-top:24px">مصروفاتي · ' + fmtG(todayStr()) + '</p></body></html>';
  var blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "تقرير-مصروفاتي-" + AR_MONTHS[view.m] + "-" + view.y + ".html";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  toast("تم تحميل التقرير 📄");
};

/* =================== RENDER =================== */
function renderTxList(container, list, emptyMsg){
  container.innerHTML = "";
  if (!list.length) { container.innerHTML = '<div class="empty"><span class="ic">🗒️</span><div class="t">لا عمليات</div><div>' + esc(emptyMsg || "ابدأ بإضافة عملية") + '</div></div>'; return; }
  list.forEach(function(t){
    var isIn = t.type === "income";
    var el = document.createElement("div"); el.className = "tx"; el.setAttribute("role", "button"); el.tabIndex = 0;
    el.innerHTML = '<div class="tx-ic ' + (isIn ? "income" : "") + '">' + (isIn ? "＋" : (EXP_ICON[t.category] || "📦")) + '</div>'
      + '<div class="tx-main"><strong>' + esc(t.merchant || t.category || (isIn ? t.category : "مصروف")) + '</strong>'
      + '<small><span>' + fmtG(t.date) + '</span>' + (t.source === "receipt" ? '<span class="pill recpt">فاتورة</span>' : "") + (isIn && t.incomeType === "primary" ? '<span class="pill">رئيسي</span>' : "") + '</small></div>'
      + '<div class="tx-amt ' + (isIn ? "income" : "expense") + ' num">' + (isIn ? "+" : "−") + fmt(t.amount) + '</div>';
    el.onclick = function(){ openDetail(t.id); };
    el.onkeydown = function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(t.id); } };
    container.appendChild(el);
  });
}

function renderHome(){
  var mk = monthKey(), c = calc(mk);
  $("monthTitle").textContent = AR_MONTHS[view.m] + " " + view.y;
  var hr = $("hRemaining"); hr.textContent = fmt(c.remaining); hr.className = "big num" + (c.remaining < 0 ? " neg" : "");
  var bar = $("hBar"); bar.style.width = Math.min(100, c.consumption) + "%"; bar.className = "pbar" + (c.consumption > 100 ? " over" : "");
  $("hMsg").textContent = c.income > 0 ? ("استهلكت " + c.consumption + "% من دخلك هذا الشهر") : "أضف دخلك ومصروفاتك لعرض الملخص.";
  $("sIncome").textContent = fmt(c.income); $("sExpense").textContent = fmt(c.expenses);
  $("sCommit").textContent = fmt(c.commit); $("sSaving").textContent = fmt(c.savings);

  var al = $("alerts"); al.innerHTML = "";
  if (c.income > 0 && c.remaining < 0) al.innerHTML += '<div class="alert danger"><span class="ic">🔴</span><span>تجاوزت دخلك بمقدار ' + fmt(Math.abs(c.remaining)) + ' — راجع مصروفاتك.</span></div>';
  else if (c.income > 0 && c.consumption >= 85) al.innerHTML += '<div class="alert warn"><span class="ic">🟡</span><span>استهلكت ' + c.consumption + '% من دخلك — اقتربت من الحد.</span></div>';
  var unpaid = commitmentsForMonth(mk).filter(function(x){ return !(x.paid && x.paid[mk]); });
  if (unpaid.length) al.innerHTML += '<div class="alert warn"><span class="ic">📌</span><span>لديك ' + unpaid.length.toLocaleString("ar-SA") + ' التزام غير مسدَّد هذا الشهر.</span></div>';

  renderTxList($("homeTx"), txForMonth(mk).slice().sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); }).slice(0, 6), "أضف أول عملية من زر +");
}

var filters = { q: "", type: "", cat: "", min: "", max: "" };
function renderRecords(){
  var mk = monthKey();
  var list = txForMonth(mk).slice();
  if (filters.type) list = list.filter(function(t){ return t.type === filters.type; });
  if (filters.cat) list = list.filter(function(t){ return t.category === filters.cat; });
  if (filters.min !== "") list = list.filter(function(t){ return num(t.amount) >= num(filters.min); });
  if (filters.max !== "") list = list.filter(function(t){ return num(t.amount) <= num(filters.max); });
  if (filters.q) { var q = filters.q.toLowerCase(); list = list.filter(function(t){ return ((t.merchant||"") + " " + (t.category||"") + " " + (t.notes||"")).toLowerCase().indexOf(q) >= 0; }); }
  list.sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  $("recCount").textContent = list.length.toLocaleString("ar-SA") + " عملية في " + AR_MONTHS[view.m];
  renderTxList($("recordsList"), list, "لا نتائج مطابقة");
  // populate cat filter once
  var fc = $("fCat");
  if (fc.options.length <= 1) EXP_CATS.forEach(function(cc){ var o = document.createElement("option"); o.value = o.textContent = cc[0]; fc.appendChild(o); });
}
$("fSearch").oninput = function(){ filters.q = this.value.trim(); renderRecords(); };
$("fType").onchange = function(){ filters.type = this.value; renderRecords(); };
$("fCat").onchange = function(){ filters.cat = this.value; renderRecords(); };
$("fMin").oninput = function(){ filters.min = this.value; renderRecords(); };
$("fMax").oninput = function(){ filters.max = this.value; renderRecords(); };
$("clearFilters").onclick = function(){ filters = { q:"",type:"",cat:"",min:"",max:"" }; $("fSearch").value=""; $("fType").value=""; $("fCat").value=""; $("fMin").value=""; $("fMax").value=""; renderRecords(); };

function renderCommitments(){
  var mk = monthKey(), box = $("commitList");
  var list = commitmentsForMonth(mk);
  if (!list.length) { box.innerHTML = '<div class="empty"><span class="ic">📌</span><div class="t">لا التزامات</div><div>أضف إيجارك أو أقساطك المتكررة</div></div>'; return; }
  box.innerHTML = "";
  list.forEach(function(c){
    var paid = c.paid && c.paid[mk];
    var el = document.createElement("div"); el.className = "card";
    el.innerHTML = '<div class="row"><div><h4>' + esc(c.name) + '</h4><div class="meta">' + esc(c.category) + ' · يوم ' + (c.dueDay||1).toLocaleString("ar-SA") + (c.recurring ? ' · متكرر' : '') + '</div></div><div class="amt num">' + fmt(c.amount) + '</div></div>'
      + '<div class="card-actions"><span class="badge ' + (paid ? "paid" : "unpaid") + '">' + (paid ? "مسدَّد ✓" : "غير مسدَّد") + '</span>'
      + '<button class="mini" data-pay>' + (paid ? "إلغاء السداد" : "تحديد كمسدَّد") + '</button>'
      + '<button class="mini" data-edit>تعديل</button></div>';
    el.querySelector("[data-pay]").onclick = function(){ if (!c.paid) c.paid = {}; if (paid) delete c.paid[mk]; else c.paid[mk] = true; persist(); pushSnapshot(); renderAll(); };
    el.querySelector("[data-edit]").onclick = function(){ openCommit(c.id); };
    box.appendChild(el);
  });
}

/* =================== ACCOUNTS & TRANSFERS =================== */
function openAccount(editName){
  ensureAccountMeta();
  var dlg = $("dlgAccount");
  var editing = typeof editName === "string";
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>' + (editing ? "تعديل الحساب" : "إضافة حساب") + '</h3><button class="icon-btn" id="acClose" aria-label="إغلاق">✕</button></div>'
    + '<form id="acForm" novalidate>'
    + '<label class="field"><span class="lab">اسم الحساب</span><input id="acName" required maxlength="40" value="' + esc(editing ? editName : "") + '" placeholder="مثال: الراجحي" /></label>'
    + '<label class="field"><span class="lab">الرصيد الافتتاحي</span><input id="acOpening" type="number" inputmode="decimal" step="0.01" value="' + (editing ? accountOpening(editName) : 0) + '" /></label>'
    + '<div class="form-actions"><button class="btn primary" type="submit">حفظ الحساب</button>'
    + (editing ? '<button class="btn danger" type="button" id="acDelete">حذف الحساب</button>' : '<button class="btn ghost" type="button" id="acCancel">إلغاء</button>')
    + '</div></form></div>';
  dlg.showModal();
  $("acClose").onclick = function(){ dlg.close(); };
  if ($("acCancel")) $("acCancel").onclick = function(){ dlg.close(); };
  if ($("acDelete")) $("acDelete").onclick = function(){
    if (accounts().length <= 1) { toast("يجب إبقاء حساب واحد على الأقل", true); return; }
    var used = state.tx.some(function(t){ return (t.account || "الحساب الرئيسي") === editName; })
      || state.invoices.some(function(iv){ return (iv.account || "") === editName; })
      || state.meta.transfers.some(function(tr){ return tr.from === editName || tr.to === editName; });
    if (used) { toast("لا يمكن حذف حساب مرتبط بسجلات أو تحويلات", true); return; }
    if (!confirm("حذف حساب " + editName + "؟")) return;
    state.meta.accounts = state.meta.accounts.filter(function(n){ return n !== editName; });
    delete state.meta.accountOpeningBalances[editName];
    persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم حذف الحساب");
  };
  $("acForm").onsubmit = function(ev){
    ev.preventDefault();
    var name = $("acName").value.trim();
    var opening = num($("acOpening").value);
    if (!name) { toast("أدخل اسم الحساب", true); return; }
    if (accounts().some(function(n){ return n === name && n !== editName; })) { toast("اسم الحساب موجود مسبقًا", true); return; }
    if (editing && name !== editName) {
      state.meta.accounts = state.meta.accounts.map(function(n){ return n === editName ? name : n; });
      state.tx.forEach(function(t){ if ((t.account || "الحساب الرئيسي") === editName) t.account = name; });
      state.invoices.forEach(function(iv){ if (iv.account === editName) iv.account = name; });
      state.meta.transfers.forEach(function(tr){ if (tr.from === editName) tr.from = name; if (tr.to === editName) tr.to = name; });
      delete state.meta.accountOpeningBalances[editName];
    } else if (!editing) state.meta.accounts.push(name);
    state.meta.accountOpeningBalances[name] = opening;
    persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم حفظ الحساب ✓");
  };
}

function deleteTransfer(id){
  ensureAccountMeta();
  if (!confirm("حذف هذا التحويل؟")) return;
  state.meta.transfers = state.meta.transfers.filter(function(tr){ return tr.id !== id; });
  persist(); pushSnapshot(); renderAll(); toast("تم حذف التحويل");
}
function openTransfer(editId){
  ensureAccountMeta();
  if (accounts().length < 2) { toast("أضف حسابًا ثانيًا لإجراء تحويل", true); return; }
  var tr = editId ? state.meta.transfers.filter(function(x){ return x.id === editId; })[0] : null;
  var dlg = $("dlgTransfer");
  var from = tr ? tr.from : accounts()[0], to = tr ? tr.to : accounts()[1];
  function options(selected){ return accounts().map(function(n){ return '<option value="' + esc(n) + '"' + (n === selected ? " selected" : "") + '>' + esc(n) + '</option>'; }).join(""); }
  dlg.innerHTML = '<div class="sheet"><div class="sheet-grip"></div>'
    + '<div class="sheet-head"><h3>' + (tr ? "تعديل التحويل" : "تحويل بين الحسابات") + '</h3><button class="icon-btn" id="trClose" aria-label="إغلاق">✕</button></div>'
    + '<form id="trForm" novalidate><div class="two">'
    + '<label class="field"><span class="lab">من حساب</span><select id="trFrom">' + options(from) + '</select></label>'
    + '<label class="field"><span class="lab">إلى حساب</span><select id="trTo">' + options(to) + '</select></label></div>'
    + '<label class="field"><span class="lab">المبلغ (ر.س)</span><input id="trAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="' + (tr ? tr.amount : "") + '" /></label>'
    + '<label class="field"><span class="lab">التاريخ (ميلادي)</span><input id="trDate" type="date" required value="' + (tr ? tr.date : todayStr()) + '" /></label>'
    + '<label class="field"><span class="lab">ملاحظات <span class="hint">(اختياري)</span></span><input id="trNotes" maxlength="100" value="' + esc(tr ? tr.notes || "" : "") + '" /></label>'
    + '<div class="form-actions"><button class="btn primary" type="submit">حفظ التحويل</button>'
    + (tr ? '<button class="btn danger" type="button" id="trDelete">حذف</button>' : '<button class="btn ghost" type="button" id="trCancel">إلغاء</button>')
    + '</div></form></div>';
  dlg.showModal();
  $("trClose").onclick = function(){ dlg.close(); };
  if ($("trCancel")) $("trCancel").onclick = function(){ dlg.close(); };
  if ($("trDelete")) $("trDelete").onclick = function(){ deleteTransfer(tr.id); dlg.close(); };
  $("trForm").onsubmit = function(ev){
    ev.preventDefault();
    var a = $("trFrom").value, b = $("trTo").value, amount = num($("trAmount").value), date = $("trDate").value;
    if (a === b) { toast("اختر حسابين مختلفين", true); return; }
    if (amount <= 0) { toast("أدخل مبلغًا صحيحًا", true); return; }
    if (!validGregorian(date)) { toast("أدخل تاريخًا ميلاديًا صحيحًا", true); return; }
    var obj = tr || { id: uid(), createdAt: nowISO() };
    obj.from = a; obj.to = b; obj.amount = amount; obj.date = date; obj.notes = $("trNotes").value.trim(); obj.updatedAt = nowISO();
    if (!tr) state.meta.transfers.push(obj);
    persist(); pushSnapshot(); renderAll(); dlg.close(); toast("تم حفظ التحويل ✓");
  };
}
$("addAccount").onclick = function(){ openAccount(); };
$("addTransfer").onclick = function(){ openTransfer(); };

function renderMore(){
  var mk = monthKey(), c = calc(mk);
  // income box
  var ib = $("incomeBox"); ib.innerHTML = "";
  var prim = primaryTx(mk);
  var primRow = document.createElement("div"); primRow.className = "tx";
  primRow.innerHTML = '<div class="tx-ic income">★</div><div class="tx-main"><strong>الدخل الرئيسي</strong><small>' + (prim ? fmtG(prim.date) + " · " + esc(prim.category||"") : "غير مُضاف") + '</small></div><div class="tx-amt income num">' + (prim ? "+" + fmt(prim.amount) : "—") + '</div>';
  primRow.style.cursor = "pointer";
  primRow.onclick = function(){ if (prim) openDetail(prim.id); else openAdd("income"); };
  ib.appendChild(primRow);
  var addl = txForMonth(mk).filter(function(t){ return t.type === "income" && t.incomeType !== "primary"; }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  if (addl.length) { var wrap = document.createElement("div"); renderTxList(wrap, addl, ""); ib.appendChild(wrap); }
  else { var e = document.createElement("div"); e.className = "meta"; e.style.cssText = "color:var(--muted);font-size:12px;padding:8px 0 0"; e.textContent = "لا دخل إضافي هذا الشهر."; ib.appendChild(e); }

  // savings
  var sb = $("savingList");
  if (!state.savings.length) { sb.innerHTML = '<div class="empty"><span class="ic">🎯</span><div class="t">لا أهداف ادخار</div><div>أنشئ هدفًا لتتبّع تقدّمك</div></div>'; }
  else {
    sb.innerHTML = "";
    state.savings.forEach(function(g){
      var pct = g.targetAmount > 0 ? Math.min(100, Math.round(g.currentAmount / g.targetAmount * 100)) : 0;
      var el = document.createElement("div"); el.className = "card";
      el.innerHTML = '<div class="row"><div><h4>' + esc(g.goalName) + '</h4><div class="meta">' + fmt(g.currentAmount) + ' من ' + fmt(g.targetAmount) + (g.monthlyContribution ? ' · ' + fmt(g.monthlyContribution) + '/شهر' : '') + '</div></div><div class="amt num">' + pct + '%</div></div>'
        + '<div class="goalbar"><i style="width:' + pct + '%"></i></div>'
        + '<div class="card-actions"><span class="badge ' + (g.status === "done" ? "paid" : "unpaid") + '">' + (g.status === "done" ? "مكتمل ✓" : "قيد التقدّم") + '</span><button class="mini" data-edit>تعديل</button></div>';
      el.querySelector("[data-edit]").onclick = function(){ openSaving(g.id); };
      sb.appendChild(el);
    });
  }

  // accounts and transfers
  ensureAccountMeta();
  var ab = $("accountBox"); ab.innerHTML = "";
  accounts().forEach(function(name){
    var row = document.createElement("div"); row.className = "tx";
    var bal = accountBalance(name);
    row.innerHTML = '<div class="tx-ic income">💳</div><div class="tx-main"><strong>' + esc(name) + '</strong><small>الرصيد الحالي</small></div><div class="tx-amt num" style="color:' + (bal < 0 ? "var(--danger)" : "var(--success)") + '">' + fmt(bal) + '</div><button class="mini" data-edit-account>تعديل</button>';
    row.querySelector("[data-edit-account]").onclick = function(){ openAccount(name); };
    ab.appendChild(row);
  });
  var transfers = state.meta.transfers.slice().sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  if (transfers.length) {
    var title = document.createElement("div"); title.className = "meta"; title.style.cssText = "padding:12px 0 4px;color:var(--muted);font-size:12px"; title.textContent = "آخر التحويلات"; ab.appendChild(title);
    transfers.slice(0, 8).forEach(function(tr){
      var row = document.createElement("div"); row.className = "tx"; row.style.cursor = "pointer";
      row.innerHTML = '<div class="tx-ic">⇄</div><div class="tx-main"><strong>' + esc(tr.from) + ' ← ' + esc(tr.to) + '</strong><small>' + fmtG(tr.date) + (tr.notes ? " · " + esc(tr.notes) : "") + '</small></div><div class="tx-amt num">' + fmt(tr.amount) + '</div>';
      row.onclick = function(){ openTransfer(tr.id); };
      ab.appendChild(row);
    });
  }

  // report box
  var rb = $("reportBox");
  var byCat = {}; txForMonth(mk).filter(function(t){ return t.type === "expense"; }).forEach(function(t){ byCat[t.category] = (byCat[t.category]||0) + num(t.amount); });
  var rows = Object.keys(byCat).map(function(k){ return [k, byCat[k]]; }).sort(function(a,b){ return b[1]-a[1]; });
  rb.innerHTML = '<div class="drow"><span class="k">صافي الشهر (الدخل − كل المصروفات)</span><span class="v num" style="color:' + (c.remaining<0?"var(--danger)":"var(--success)") + '">' + fmt(c.remaining) + '</span></div>'
    + (rows.length ? rows.map(function(e){ var p = c.expenses ? Math.round(e[1]/c.expenses*100) : 0; return '<div style="margin-top:10px"><div style="display:flex;justify-content:space-between;font-size:.88rem"><span>' + (EXP_ICON[e[0]]||"") + ' ' + esc(e[0]) + '</span><span class="num">' + fmt(e[1]) + ' · ' + p + '%</span></div><div class="goalbar" style="margin:5px 0 0;height:7px"><i style="width:' + p + '%"></i></div></div>'; }).join("") : '<div class="empty" style="padding:14px"><div>لا مصروفات هذا الشهر</div></div>');
}

function renderAll(){ renderHome(); renderRecords(); renderCommitments(); renderMore(); syncDots(); }

/* init */
renderAll();
if (sheetUrl) { pullSheet().catch(function(){ syncDots(); }); }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function(){});

/* test hooks */
window.__M = { get state(){ return state; }, calc: calc, monthKey: monthKey, view: view, saveTx: saveTx, deleteTx: deleteTx, primaryTx: primaryTx, accountBalance: accountBalance, openAccount: openAccount, openTransfer: openTransfer, renderAll: renderAll, openAdd: openAdd, go: go, openReceiptReview: openReceiptReview, fmtG: fmtG, validGregorian: validGregorian };
