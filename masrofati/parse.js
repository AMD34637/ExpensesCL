/* ===== مصروفاتي — وحدة تحليل الفواتير (نقية، قابلة للاختبار) =====
   لا تعتمد على DOM. تُستخدم من app.js ومن اختبارات Node مباشرة. */
(function (root) {
  "use strict";

  // 1) تطبيع الأرقام العربية/الفارسية والفواصل
  function normalizeDigits(s) {
    if (s == null) return "";
    var out = String(s);
    var ar = "٠١٢٣٤٥٦٧٨٩", fa = "۰۱۲۳۴۵۶۷۸۹";
    out = out.replace(/[٠-٩]/g, function (d) { return String(ar.indexOf(d)); })
             .replace(/[۰-۹]/g, function (d) { return String(fa.indexOf(d)); });
    // الفاصلة العربية العشرية ٫ و فاصل الآلاف ٬
    out = out.replace(/٫/g, ".").replace(/٬/g, ",").replace(/،/g, ",");
    return out;
  }

  // 2) استخراج قيمة رقمية من نص (يدعم السالب، فواصل الآلاف، والعشري)
  function parseAmount(s) {
    if (s == null) return null;
    var t = normalizeDigits(s).replace(/[‎‏]/g, "").trim();
    // ابحث عن أول نمط رقمي منطقي (اختياري سالب)، مع فواصل آلاف وعشري
    var m = t.match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/);
    if (!m) return null;
    var raw = m[0].replace(/,/g, "");
    var n = parseFloat(raw);
    if (!isFinite(n)) return null;
    return Math.abs(n); // المصروف دائمًا موجب حتى لو كان الرقم البنكي سالبًا
  }

  // 3) كلمات السطور غير المنتَجة (تُفلتر من قائمة المنتجات)
  var NON_PRODUCT = [
    "total","grand total","subtotal","sub total","amount","billing amount","balance",
    "vat","tax","zatca","discount","date","time","receipt","reference","ref",
    "transaction","status","approved","merchant","terminal","card","visa","mastercard",
    "mada","cash","change","thank you","welcome","invoice","tel","phone","www","http",
    "الإجمالي","الاجمالي","الإجمالي الكلي","المجموع","المجموع الفرعي","الاجمالي الفرعي",
    "الضريبة","القيمة المضافة","ضريبة","الخصم","خصم","التاريخ","الوقت","إيصال","ايصال",
    "المرجع","رقم المرجع","مرجع","عملية","حالة","تمت","مقبول","التاجر","بطاقة","نقدًا","نقدا",
    "مدى","فيزا","ماستر","سداد","الفاتورة","مبلغ الفاتورة","المبلغ","الرصيد","شكرا","شكراً",
    "هاتف","جوال","الرقم الضريبي","المتبقي","الباقي","نقاط","ولاء"
  ];
  function isNonProductLine(line) {
    var t = normalizeDigits(line).toLowerCase().trim();
    if (!t) return true;
    if (!/[a-zA-Zء-ي]/.test(t)) return true; // لا حروف => ليس منتجًا
    for (var i = 0; i < NON_PRODUCT.length; i++) {
      var kw = NON_PRODUCT[i];
      // مطابقة ككلمة/عبارة
      if (t.indexOf(kw) >= 0) {
        // اسمح إذا كان جزءًا من اسم منتج أطول بوضوح؟ نُبقيه محافظًا: افلتره.
        return true;
      }
    }
    return false;
  }

  // 4) تصنيف الإيصال: دفع بنكي/بطاقة  أم  فاتورة تجزئة بمنتجات
  var PAYMENT_HINTS = [
    "card transaction","transaction receipt","billing amount","reference number","approval",
    "terminal","auth code","rrn","stan","mada","visa","mastercard","point of sale","pos",
    "مبلغ الفاتورة","رقم المرجع","إيصال عملية","ايصال عملية","سداد","رقم العملية","رمز الموافقة",
    "نقطة بيع","إيصال دفع","ايصال دفع","بطاقة","اعتماد"
  ];
  function classifyReceipt(text) {
    var t = normalizeDigits(text).toLowerCase();
    var lines = t.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var paymentScore = 0;
    PAYMENT_HINTS.forEach(function (h) { if (t.indexOf(h) >= 0) paymentScore++; });
    // عدد سطور تبدو كمنتجات (اسم + سعر، أو نمط كمية×سعر)
    var productLike = 0;
    lines.forEach(function (l) {
      if (isNonProductLine(l)) return;
      if (/x|×|\*/.test(l) && /\d/.test(l)) productLike++;
      else if (/[ء-يa-zA-Z].*\d+(?:[.,]\d+)?\s*$/.test(l)) productLike++;
    });
    // قرار: نقاط الدفع عالية أو لا منتجات => إيصال دفع
    if (paymentScore >= 2 && productLike < 2) return "payment";
    if (productLike >= 2) return "retail";
    if (paymentScore >= 1) return "payment";
    return "unknown";
  }

  // 5) اختيار الإجمالي النهائي (يفضّل مبلغ الفاتورة/Billing Amount)
  function extractTotal(text) {
    var t = normalizeDigits(text);
    var lines = t.split(/\n+/);
    var prefer = [/billing\s*amount/i, /مبلغ\s*الفاتورة/, /grand\s*total/i, /الإجمالي\s*الكلي/, /الاجمالي\s*الكلي/, /\btotal\b/i, /الإجمالي/, /الاجمالي/, /المجموع/, /\bamount\b/i, /المبلغ/];
    for (var p = 0; p < prefer.length; p++) {
      for (var i = 0; i < lines.length; i++) {
        if (prefer[p].test(lines[i])) {
          var v = parseAmount(lines[i]);
          if (v != null && v > 0) return v;
          // ربما القيمة في السطر التالي
          if (i + 1 < lines.length) { var v2 = parseAmount(lines[i + 1]); if (v2 != null && v2 > 0) return v2; }
        }
      }
    }
    // بديل: أكبر قيمة رقمية معقولة في النص
    var max = null;
    lines.forEach(function (l) { var v = parseAmount(l); if (v != null && (max == null || v > max)) max = v; });
    return max;
  }

  function extractField(text, patterns) {
    var t = normalizeDigits(text);
    var lines = t.split(/\n+/);
    for (var p = 0; p < patterns.length; p++) {
      for (var i = 0; i < lines.length; i++) {
        if (patterns[p].test(lines[i])) { var v = parseAmount(lines[i]); if (v != null) return v; }
      }
    }
    return null;
  }
  function extractVat(text) { return extractField(text, [/vat/i, /القيمة\s*المضافة/, /الضريبة/, /ضريبة/, /tax/i]); }
  function extractSubtotal(text) { return extractField(text, [/sub\s*total/i, /subtotal/i, /المجموع\s*الفرعي/, /الاجمالي\s*الفرعي/, /الإجمالي\s*الفرعي/]); }
  function extractDiscount(text) { return extractField(text, [/discount/i, /الخصم/, /خصم/]); }

  // 6) تاريخ ميلادي YYYY-MM-DD
  function extractDate(text) {
    var t = normalizeDigits(text);
    // dd/mm/yyyy أو dd-mm-yyyy أو yyyy-mm-dd
    var m = t.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
    m = t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return m[3] + "-" + pad(m[2]) + "-" + pad(m[1]);
    return null;
  }
  function extractTime(text) {
    var t = normalizeDigits(text);
    var m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? (pad(m[1]) + ":" + m[2] + (m[3] ? ":" + m[3] : "")) : null;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function extractMerchant(text) {
    var lines = String(text).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    // أول سطر فيه حروف وليس رقمًا/كلمة نظام
    for (var i = 0; i < lines.length && i < 6; i++) {
      var l = normalizeDigits(lines[i]);
      if (/[ء-يa-zA-Z]{3,}/.test(l) && !/\d{3,}/.test(l) && !isSystemWord(l)) return lines[i].slice(0, 40);
    }
    return "";
  }
  function isSystemWord(l) {
    var t = l.toLowerCase();
    return /receipt|invoice|tel|vat|فاتورة|إيصال|ايصال|ضريبة/.test(t);
  }
  function extractReference(text) {
    var t = normalizeDigits(text);
    var m = t.match(/(?:reference|ref|رقم\s*المرجع|مرجع|rrn)[^\d]*(\d{4,})/i);
    return m ? m[1] : "";
  }

  // 7) استخراج المنتجات من فاتورة تجزئة
  function extractItems(text) {
    var lines = normalizeDigits(text).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var items = [], seen = {};
    lines.forEach(function (line) {
      if (isNonProductLine(line)) return;
      var it = parseItemLine(line);
      if (!it) return;
      var key = it.name.replace(/\s+/g, "") + "|" + it.total;
      if (seen[key]) return; // إزالة التكرار
      seen[key] = 1;
      items.push(it);
    });
    return items;
  }
  // يدعم: "حليب 2 x 10.00 20.00" ، "حليب 2 × 10.00" ، "حليب 20.00"
  function parseItemLine(line) {
    var l = line.replace(/[‎‏]/g, "").trim();
    // نمط: اسم  كمية (x|×|*) سعر  [إجمالي]
    var m = l.match(/^(.*?)(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(\d+(?:\.\d+)?)?\s*$/);
    if (m) {
      var name = cleanName(m[1]);
      if (!name) return null;
      var qty = parseFloat(m[2]), unit = parseFloat(m[3]);
      var total = m[4] != null ? parseFloat(m[4]) : +(qty * unit).toFixed(2);
      if (!isFinite(qty) || !isFinite(unit)) return null;
      return { name: name, quantity: qty, unitPrice: unit, total: total };
    }
    // نمط: اسم  سعر (بلا كمية)
    m = l.match(/^(.*?[ء-يa-zA-Z].*?)\s+(\d+(?:\.\d+)?)\s*(?:ر\.?س|sar|sr)?\s*$/i);
    if (m) {
      var nm = cleanName(m[1]);
      var price = parseFloat(m[2]);
      if (!nm || !isFinite(price) || price <= 0) return null;
      // ارفض الأرقام العشوائية الكبيرة بلا سياق (مثال 269 / 920 وحدها بلا اسم حقيقي)
      if (nm.length < 2) return null;
      return { name: nm, quantity: 1, unitPrice: price, total: price };
    }
    return null;
  }
  function cleanName(s) {
    return String(s).replace(/[|:@#]+/g, " ").replace(/\s+/g, " ").trim().replace(/[\-–—]+$/, "").trim();
  }

  // 8) التحقق من تطابق مجموع المنتجات مع الفاتورة
  function validateItemSum(items, total, opts) {
    opts = opts || {};
    var tol = opts.tolerance != null ? opts.tolerance : Math.max(1, (total || 0) * 0.02);
    var sum = (items || []).reduce(function (s, it) { return s + (Number(it.total) || 0); }, 0);
    sum = +sum.toFixed(2);
    var subtotal = opts.subtotal, vat = opts.vat, discount = opts.discount || 0;
    var candidates = [total];
    if (subtotal != null) candidates.push(subtotal);
    if (total != null && vat != null) candidates.push(+(total - vat + discount).toFixed(2));
    var ok = candidates.some(function (c) { return c != null && Math.abs(sum - c) <= tol; });
    return { sum: sum, ok: ok, tolerance: tol, candidates: candidates };
  }

  // 9) المحلّل الكامل: نص خام => كائن مراجعة
  function parseReceipt(text) {
    var type = classifyReceipt(text);
    var total = extractTotal(text);
    var out = {
      type: type,
      merchant: extractMerchant(text),
      reference: extractReference(text),
      date: extractDate(text),
      time: extractTime(text),
      subtotal: extractSubtotal(text),
      vat: extractVat(text),
      discount: extractDiscount(text),
      total: total,
      items: []
    };
    if (type === "retail") {
      out.items = extractItems(text);
      var v = validateItemSum(out.items, total, { subtotal: out.subtotal, vat: out.vat, discount: out.discount });
      out.itemsSum = v.sum; out.itemsMatch = v.ok;
    } else {
      // إيصال دفع: عملية واحدة فقط، بلا منتجات
      out.items = [];
      out.itemsMatch = true;
    }
    return out;
  }

  var API = {
    normalizeDigits: normalizeDigits, parseAmount: parseAmount, isNonProductLine: isNonProductLine,
    classifyReceipt: classifyReceipt, extractTotal: extractTotal, extractVat: extractVat,
    extractSubtotal: extractSubtotal, extractDiscount: extractDiscount, extractDate: extractDate,
    extractTime: extractTime, extractMerchant: extractMerchant, extractReference: extractReference,
    extractItems: extractItems, parseItemLine: parseItemLine, validateItemSum: validateItemSum,
    parseReceipt: parseReceipt
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.ReceiptParser = API;
})(typeof window !== "undefined" ? window : this);
