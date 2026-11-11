/**
 * HagiiZ 災害レビュー：答えと受付の受け皿（Google Apps Script）
 *
 * 1つのスプレッドシート「HagiiZ 災害レビュー 受付」に、答え・納得・通報・受付をまとめる。
 * - 答えはすぐ載る。通報があると、その場で「非表示」になり、運営にメールが届く。
 * - 受付（資料の提供・問いの提案・団体の申請・リンク切れ）が届くと、運営にメールが届く。
 * - 新しい答えは1時間ごとにまとめてメールで知らせる（メールの送りすぎを防ぐ）。
 *
 * 運営がシートで行うこと
 * - 答えを隠す／戻す：「表示」列を「非表示」／「表示」にする
 * - 防災士が採用した答え：「採用」列に「採用」と書く
 *
 * 使い方は README.md の「答えの受け皿をつくる」を見てください。
 */

var SHEET_ANSWERS = '答え';
var SHEET_INBOX = '受付';
var SHEET_LOG = '記録';
var ANSWER_COLS = ['ID', '日時', '問い', '名前', '立場', '立ち位置', '答え', '提案', '根拠カード', '納得', '通報', '表示', '採用', '端末', 'メモ'];
var INBOX_COLS = ['日時', '種類', '内容', '参考', '地域', '名前', '連絡先', '端末', '対応'];
var LOG_COLS = ['日時', '種類', '答えID', '端末'];
var ROLES = ['高校生', '大学生', '防災士', '防災士をめざす', '防災団体', '研究・仕事', '自治体の職員', 'そのほか'];
var STANCES = ['', 'もう答えが出た', '一部だけ', 'まだ', 'わからない'];
var KINDS = ['資料の提供', '問いの提案', '防災団体の掲載申請', 'リンク切れ', '扱ってほしい災害', 'そのほか'];

// ---------- 最初に1回だけ実行する ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SHEET_ANSWERS, ANSWER_COLS], [SHEET_INBOX, INBOX_COLS], [SHEET_LOG, LOG_COLS]].forEach(function (x) {
    var sh = ss.getSheetByName(x[0]) || ss.insertSheet(x[0]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(x[1]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, x[1].length).setFontWeight('bold').setBackground('#0E0E10').setFontColor('#FFFFFF');
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('NOTIFY_EMAIL')) props.setProperty('NOTIFY_EMAIL', Session.getEffectiveUser().getEmail());
  props.setProperty('LAST_DIGEST_ROW', String(ss.getSheetByName(SHEET_ANSWERS).getLastRow()));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'digest') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('digest').timeBased().everyHours(1).create();
}

// ---------- 読む ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return json(listAnswers(String(p.toi || '')));
    if (p.action === 'counts') return json(counts());
    if (p.action === 'mine') return json(mine(String(p.ids || '')));
    return json({ ok: true, name: 'HagiiZ 災害レビュー 受け皿' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function answerRows() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ANSWER_COLS.length).getValues();
}

function toAnswer(r) {
  return {
    id: String(r[0]), ts: r[1] instanceof Date ? r[1].getTime() : 0, toi: r[2], name: r[3], role: r[4], stance: r[5],
    answer: r[6], proposal: r[7], cards: String(r[8] || '').split(',').filter(String), agree: Number(r[9]) || 0,
    picked: String(r[12]) === '採用'
  };
}

function listAnswers(toi) {
  if (!/^[a-z0-9-]{1,80}$/.test(toi)) return { ok: false, error: 'bad toi' };
  var cache = CacheService.getScriptCache(), key = 'list:' + toi, hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var out = answerRows().filter(function (r) { return r[2] === toi && String(r[11]) !== '非表示'; }).map(toAnswer);
  out.sort(function (a, b) { return (b.picked - a.picked) || (b.ts - a.ts); });
  var res = { ok: true, answers: out };
  cache.put(key, JSON.stringify(res), 30);
  return res;
}

function counts() {
  var cache = CacheService.getScriptCache(), hit = cache.get('counts');
  if (hit) return JSON.parse(hit);
  var c = {}, total = 0;
  answerRows().forEach(function (r) { if (String(r[11]) !== '非表示') { c[r[2]] = (c[r[2]] || 0) + 1; total++; } });
  var res = { ok: true, counts: c, total: total };
  cache.put('counts', JSON.stringify(res), 30);
  return res;
}

function mine(ids) {
  var want = {};
  ids.split(',').slice(0, 200).forEach(function (i) { if (i) want[i] = 1; });
  var st = {};
  answerRows().forEach(function (r) { if (want[r[0]]) st[r[0]] = { picked: String(r[12]) === '採用', hidden: String(r[11]) === '非表示', agree: Number(r[9]) || 0 }; });
  return { ok: true, status: st };
}

// ---------- 書く ----------
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var client = clean(d.client, 60);
    if (!client) return json({ ok: false, error: 'no client' });
    lock.waitLock(10000);
    if (d.action === 'answer') return json(postAnswer(d, client));
    if (d.action === 'agree') return json(postAgree(String(d.id || ''), client));
    if (d.action === 'report') return json(postReport(String(d.id || ''), client));
    if (d.action === 'teikyo') return json(postInbox(d, client));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function postAnswer(d, client) {
  if (!rateOk('a:' + client, 5, 600) || !rateOk('a:all', 300, 3600)) return { ok: false, error: '少し時間をおいてください' };
  var toi = String(d.toi || ''), cards = (d.cards || []).map(String).filter(function (c) { return /^E\d{2,3}$/.test(c); }).slice(0, 2);
  var answer = clean(d.answer, 80), proposal = clean(d.proposal, 80), name = clean(d.name, 20), role = String(d.role || ''), stance = String(d.stance || '');
  if (!/^[a-z0-9-]{1,80}$/.test(toi)) return { ok: false, error: '問いが正しくありません' };
  if (!cards.length) return { ok: false, error: '根拠カードを選んでください' };
  if (!answer || !name) return { ok: false, error: '答えと名前を書いてください' };
  if (ROLES.indexOf(role) < 0) return { ok: false, error: '立場を選んでください' };
  if (STANCES.indexOf(stance) < 0) stance = '';
  var id = Utilities.getUuid().slice(0, 12);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  sh.appendRow([id, new Date(), toi, name, role, stance, answer, proposal, cards.join(','), 0, 0, '表示', '', client, '']);
  bust(toi);
  return { ok: true, id: id };
}

function postAgree(id, client) {
  if (!/^[a-f0-9-]{6,40}$/.test(id) || !rateOk('g:' + client, 30, 600)) return { ok: false };
  var log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOG);
  var cache = CacheService.getScriptCache(), key = 'ag:' + id + ':' + client;
  if (cache.get(key)) return { ok: true };
  cache.put(key, '1', 21600);
  var row = findRow(id);
  if (!row) return { ok: false };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  var cell = sh.getRange(row, 10);
  cell.setValue((Number(cell.getValue()) || 0) + 1);
  log.appendRow([new Date(), '納得', id, client]);
  bust(sh.getRange(row, 3).getValue());
  return { ok: true };
}

function postReport(id, client) {
  if (!/^[a-f0-9-]{6,40}$/.test(id) || !rateOk('r:' + client, 10, 3600)) return { ok: false };
  var row = findRow(id);
  if (!row) return { ok: false };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  sh.getRange(row, 11).setValue((Number(sh.getRange(row, 11).getValue()) || 0) + 1);
  sh.getRange(row, 12).setValue('非表示');
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOG).appendRow([new Date(), '通報', id, client]);
  bust(sh.getRange(row, 3).getValue());
  var v = sh.getRange(row, 1, 1, ANSWER_COLS.length).getValues()[0];
  notify('【災害レビュー】通報で答えを隠しました',
    '通報があったため、次の答えを「非表示」にしました。問題がなければ「表示」列を「表示」に戻してください。\n\n問い：' + v[2] + '\n名前：' + v[3] + '（' + v[4] + '）\n答え：' + v[6] + '\n提案：' + v[7] + '\n\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  return { ok: true };
}

function postInbox(d, client) {
  if (!rateOk('t:' + client, 5, 3600)) return { ok: false, error: '少し時間をおいてください' };
  var kind = String(d.kind || ''), body = clean(d.body, 800);
  if (KINDS.indexOf(kind) < 0 || !body) return { ok: false, error: '種類と内容を書いてください' };
  var row = [new Date(), kind, body, clean(d.ref, 300), clean(d.area, 60), clean(d.name, 30), clean(d.contact, 120), client, ''];
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INBOX).appendRow(row);
  notify('【災害レビュー】受付：' + kind, '種類：' + kind + '\n内容：' + row[2] + '\n参考：' + row[3] + '\n地域：' + row[4] + '\n名前：' + row[5] + '\n連絡先：' + row[6] + '\n\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  return { ok: true };
}

// ---------- 1時間ごとのまとめ ----------
function digest() {
  var props = PropertiesService.getScriptProperties();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  var from = Number(props.getProperty('LAST_DIGEST_ROW') || 1), last = sh.getLastRow();
  if (last <= from) return;
  var rows = sh.getRange(from + 1, 1, last - from, ANSWER_COLS.length).getValues();
  var text = rows.map(function (r) { return '・[' + r[2] + '] ' + r[3] + '（' + r[4] + '）：' + r[6]; }).join('\n');
  notify('【災害レビュー】新しい答え ' + rows.length + '件', text + '\n\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  props.setProperty('LAST_DIGEST_ROW', String(last));
}

// ---------- 小物 ----------
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function rateOk(key, limit, sec) {
  var c = CacheService.getScriptCache(), n = Number(c.get('rl:' + key) || 0);
  if (n >= limit) return false;
  c.put('rl:' + key, String(n + 1), sec);
  return true;
}
function findRow(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
function bust(toi) { var c = CacheService.getScriptCache(); c.remove('counts'); if (toi) c.remove('list:' + toi); }
function notify(subject, body) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (to) MailApp.sendEmail(to, subject, body);
}
