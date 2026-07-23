// مصروفاتي — Google Apps Script backend (snapshot model)
// التركيب:
// 1) sheets.google.com → جدول جديد → Extensions → Apps Script
// 2) الصق هذا الملف كاملًا واحفظ
// 3) Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy
// 4) انسخ رابط /exec والصقه في التطبيق: المزيد → ربط قوقل شيت
// لا تضع أي أسرار في كود التطبيق؛ هذا السكربت يعمل بصلاحيتك أنت فقط.

function _ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function _sheet(){
  var s = _ss().getSheetByName("data");
  if (!s){ s = _ss().insertSheet("data"); s.getRange(1,1).setValue("{}"); }
  return s;
}
function _json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(){
  var data = {};
  try { data = JSON.parse(_sheet().getRange(1,1).getValue() || "{}"); } catch(e){}
  var url = ""; try { url = _ss().getUrl(); } catch(e){}
  return _json({ data: data, sheetUrl: url });
}

function doPost(e){
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === "full" && body.data){
      _sheet().getRange(1,1).setValue(JSON.stringify(body.data));
      _mirror(body.data);   // human-readable mirror tab
    }
    return _json({ ok: true });
  } finally { lock.releaseLock(); }
}

// Optional readable mirror of transactions for viewing/printing in the sheet
function _mirror(data){
  try {
    var s = _ss().getSheetByName("العمليات");
    if (!s){ s = _ss().insertSheet("العمليات"); s.setRightToLeft(true); }
    s.clearContents();
    s.appendRow(["التاريخ","النوع","الفئة/المصدر","التاجر/الوصف","طريقة الدفع","ملاحظة","المبلغ","المصدر"]);
    (data.tx || []).slice().sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); }).forEach(function(t){
      s.appendRow([t.date, t.type === "income" ? "دخل" : "مصروف", t.category || "", t.merchant || "", t.paymentMethod || "", t.notes || "", t.amount, t.source === "receipt" ? "فاتورة" : "يدوي"]);
    });
  } catch(e){}
}
