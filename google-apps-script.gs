// سكربت ميزانية الأسرة — يحوّل جدول قوقل شيت إلى مخزن للتطبيق
// طريقة التركيب:
// 1) افتح جدول قوقل شيت جديد (sheets.google.com)
// 2) من القائمة: الإضافات/Extensions ← Apps Script
// 3) امسح الكود الموجود والصق هذا الملف كاملًا ثم احفظ
// 4) نشر/Deploy ← New deployment ← النوع: Web app
//    Execute as: Me  |  Who has access: Anyone
// 5) وافق على الأذونات وانسخ رابط الـ Web app (ينتهي بـ /exec)
// 6) الصق الرابط في التطبيق بقسم «الربط بقوقل شيت» واضغط ربط

function _ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function _tx() {
  var s = _ss().getSheetByName("العمليات");
  if (!s) {
    s = _ss().insertSheet("العمليات");
    s.appendRow(["المعرف", "التاريخ", "النوع", "الفئة", "الفرد", "الملاحظة", "المبلغ"]);
    s.setRightToLeft(true);
  }
  return s;
}

function _meta() {
  var s = _ss().getSheetByName("الإعدادات");
  if (!s) {
    s = _ss().insertSheet("الإعدادات");
    s.getRange(1, 1).setValue("{}");
  }
  return s;
}

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  var rows = _tx().getDataRange().getValues();
  rows.shift();
  var tx = rows.filter(function (r) { return r[0]; }).map(function (r) {
    return {
      id: String(r[0]),
      date: String(r[1]),
      type: String(r[2]) === "دخل" ? "in" : "out",
      cat: String(r[3]),
      member: String(r[4]),
      note: String(r[5] || ""),
      amount: Number(r[6]) || 0
    };
  });
  var meta = {};
  try { meta = JSON.parse(_meta().getRange(1, 1).getValue() || "{}"); } catch (e) {}
  var sheetUrl = "";
  try { sheetUrl = _ss().getUrl(); } catch (e) {}
  return _json({ tx: tx, meta: meta, sheetUrl: sheetUrl });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var b = JSON.parse(e.postData.contents);
    if (b.action === "add" && b.tx) {
      _tx().appendRow([b.tx.id, b.tx.date, b.tx.type === "in" ? "دخل" : "مصروف",
        b.tx.cat, b.tx.member, b.tx.note || "", b.tx.amount]);
    } else if (b.action === "del" && b.id) {
      var s = _tx();
      var v = s.getDataRange().getValues();
      for (var i = v.length - 1; i >= 1; i--) {
        if (String(v[i][0]) === String(b.id)) s.deleteRow(i + 1);
      }
    } else if (b.action === "meta" && b.meta) {
      _meta().getRange(1, 1).setValue(JSON.stringify(b.meta));
    } else if (b.action === "full") {
      var t = _tx();
      t.clearContents();
      t.appendRow(["المعرف", "التاريخ", "النوع", "الفئة", "الفرد", "الملاحظة", "المبلغ"]);
      (b.tx || []).forEach(function (x) {
        t.appendRow([x.id, x.date, x.type === "in" ? "دخل" : "مصروف",
          x.cat, x.member, x.note || "", x.amount]);
      });
      if (b.meta) _meta().getRange(1, 1).setValue(JSON.stringify(b.meta));
    }
    return _json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
