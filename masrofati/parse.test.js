/* اختبارات وحدة تحليل الفواتير — تشغيل: node parse.test.js */
var P = require("./parse.js");
var pass = 0, fail = 0, fails = [];
function eq(a, b, name) { var ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; fails.push(name + " :: got " + JSON.stringify(a) + " expected " + JSON.stringify(b)); } }
function ok(c, name) { if (c) pass++; else { fail++; fails.push(name); } }

/* --- digit + amount normalization --- */
eq(P.normalizeDigits("١٢٣٤٥"), "12345", "arabic digits");
eq(P.normalizeDigits("۱۲۳۴۵"), "12345", "persian digits");
eq(P.parseAmount("1,038.57"), 1038.57, "en thousands+decimal");
eq(P.parseAmount("SAR -1,038.57"), 1038.57, "negative bank => positive");
eq(P.parseAmount("-1038.57"), 1038.57, "negative plain");
eq(P.parseAmount("١٬٠٣٨٫٥٧"), 1038.57, "arabic sep ٬ ٫");
eq(P.parseAmount("۱٬۰۳۸٫۵۷"), 1038.57, "persian digits + arabic seps");
eq(P.parseAmount("لا يوجد"), null, "no number => null");
eq(P.parseAmount("269"), 269, "plain int");

/* --- non-product filtering --- */
ok(P.isNonProductLine("Total 1038.57"), "Total is non-product");
ok(P.isNonProductLine("مبلغ الفاتورة 1038.57"), "billing amount non-product");
ok(P.isNonProductLine("VAT 15%"), "VAT non-product");
ok(P.isNonProductLine("Reference: 920"), "reference non-product");
ok(P.isNonProductLine("269"), "bare number non-product");
ok(!P.isNonProductLine("حليب 2 x 10.00 20.00"), "milk line IS product");

/* --- payment receipt classification --- */
var paymentText = [
  "Al Rajhi Bank",
  "Card Transaction Receipt",
  "Merchant: PANDA",
  "Amount SAR 920.00",
  "Billing Amount SAR -1,038.57",
  "Reference Number 000269",
  "Transaction Status: Approved",
  "Mada"
].join("\n");
eq(P.classifyReceipt(paymentText), "payment", "classify payment receipt");
var pr = P.parseReceipt(paymentText);
eq(pr.items.length, 0, "payment receipt has ZERO items");
eq(pr.total, 1038.57, "payment total prefers Billing Amount 1038.57");
ok(pr.total !== 920 && pr.total !== 269, "payment ignores 920/269 as total");

/* --- retail invoice extraction --- */
var retailText = [
  "بقالة الرياض",
  "التاريخ 23/07/2026  10:45",
  "حليب 2 x 10.00 20.00",
  "خبز 1 x 3.00 3.00",
  "أرز 5 كجم 4.00 20.00",
  "المجموع الفرعي 43.00",
  "الضريبة 6.45",
  "الإجمالي 49.45"
].join("\n");
eq(P.classifyReceipt(retailText), "retail", "classify retail invoice");
var rr = P.parseReceipt(retailText);
ok(rr.items.length >= 2, "retail extracts multiple items got " + rr.items.length);
var milk = rr.items.filter(function (i) { return i.name.indexOf("حليب") >= 0; })[0];
ok(milk && milk.quantity === 2 && milk.unitPrice === 10 && milk.total === 20, "milk parsed qty/unit/total: " + JSON.stringify(milk));
eq(P.extractDate(retailText), "2026-07-23", "gregorian date dd/mm/yyyy");
eq(P.extractTotal(retailText), 49.45, "retail total = 49.45");
eq(P.extractVat(retailText), 6.45, "retail vat = 6.45");

/* --- item sum validation --- */
var v1 = P.validateItemSum([{ total: 20 }, { total: 3 }, { total: 20 }], 43, { tolerance: 0.5 });
ok(v1.ok && v1.sum === 43, "items sum matches subtotal 43");
var v2 = P.validateItemSum([{ total: 20 }, { total: 3 }], 49.45, { tolerance: 0.5 });
ok(!v2.ok, "mismatched items flagged");
var v3 = P.validateItemSum([{ total: 43 }], 49.45, { vat: 6.45, tolerance: 0.5 });
ok(v3.ok, "items match total-vat (49.45-6.45=43)");

/* --- garbage rejection: bare numbers never become products --- */
var garbage = "269\n920\n---\n2026-07-23\n:::";
eq(P.extractItems(garbage).length, 0, "garbage lines => no products");

/* --- date variants --- */
eq(P.extractDate("2026-07-23"), "2026-07-23", "iso date");
eq(P.extractDate("23-07-2026"), "2026-07-23", "dd-mm-yyyy");
eq(P.extractDate("٢٣/٠٧/٢٠٢٦"), "2026-07-23", "arabic-digit date");

console.log("PARSE UNIT — PASS: " + pass + "  FAIL: " + fail);
if (fail) { console.log(fails.map(function (f) { return " ✗ " + f; }).join("\n")); process.exit(1); }
console.log("ALL GREEN ✓");
