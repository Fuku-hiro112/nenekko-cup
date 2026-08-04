/**
 * ねっ子ポカジャン大会 / トーナメント表のスプレッドシートに入れるスクリプト
 *
 * **押したときに、次の回戦の行を足します。** 勝手には増えません。
 *
 * ── 入れかた（最初の1回だけ） ─────────────────────────
 *  1. スプレッドシートを開く
 *  2. 拡張機能 → Apps Script
 *  3. 出てきたコードを全部消して、このファイルの中身を貼り付ける
 *  4. 保存（フロッピーのアイコン）
 *  5. シートを開き直す → 上のメニューに「ポカジャン大会」が増えます
 *     → 初回だけ許可を求められるので、自分のアカウントで承認する
 *
 * ── 押しかたは3つあります。どれも同じことをします ──────────
 *
 *  【1】メニュー（パソコン）
 *       「ポカジャン大会 → 次の回戦を作る」
 *
 *  【2】ボタン（パソコン）
 *       挿入 → 図形描画 で四角を描いて「次の回戦を作る」と書く → 保存して閉じる
 *       → 図形の右上の「⋮」→ スクリプトを割り当て → createNextRound と入力
 *
 *  【3】チェックボックス（**スマホでも押せます**）
 *       空いている列の1行目に「実行」と書き、その下のセルにチェックボックスを置く
 *       （挿入 → チェックボックス）。チェックを入れると走り、自動で外れます。
 *
 * **スマホのアプリではメニューも図形ボタンも出ません。** 代わりの人が
 * スマホだけで進める可能性があるなら、【3】を用意しておいてください。
 *
 * ── 列について ──────────────────────────────────
 * 1行目の見出しから「回戦 / 卓 / 参加者 / 勝ち」の列を探します。
 * メモ用の列を足したり、順番を入れ替えたりしても動きます。
 */

var SEAT = 4;            // 1卓の人数

// 「勝ち」の欄がこれらのときは勝ちにしません。
// **チェックボックスは外していても false が入ります。**
// 「何か入っていれば勝ち」にすると、外したチェックまで勝ちになります。
var NOT_WON = ['', 'false', '0', '×', 'ｘ', 'x', '✕', '✗', '-', '－', 'ー',
               'なし', '負け', 'まけ', 'no', 'n'];


/** シートを開いたときに、上のメニューへ項目を足す（パソコンのみ）。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ポカジャン大会')
    .addItem('次の回戦を作る', 'createNextRound')
    .addToUi();
}


/**
 * 次の回戦を作る。**メニュー・図形ボタン・チェックボックスのどれからでもここに来ます。**
 * まだ作れないときは、その理由を画面に出します。
 */
function createNextRound() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var idx = findColumns(sheet);
  if (!idx) { tell('シートの見出しが読めません。1行目を「回戦 / 卓 / 参加者 / 勝ち」にしてください。'); return; }

  var result = addNextRound(sheet, idx);
  tell(result.message);
}


/**
 * 画面の右下に短く知らせる。ダイアログと違って、押して閉じる手間がありません。
 *
 * **知らせに失敗しても、行の追加まで巻き戻したくないので握りつぶします。**
 * チェックボックスから動かしたときは承認なしで走るため、
 * 環境によっては通知だけ出せないことがあります。
 */
function tell(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'ねっ子ポカジャン大会', 8);
  } catch (err) {
    // 通知が出せなくても、行はもう足してあります
  }
}


/**
 * チェックボックスを押したときにも動かすための入り口。
 * **見出しに「実行」と書いた列**のチェックだけを見ます。
 * スマホのアプリではメニューも図形ボタンも使えないので、その代わりです。
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var idx = findColumns(sheet);
  if (!idx || idx.run < 0) return;                     // 「実行」列が無ければ何もしない
  if (e.range.getColumn() !== idx.run + 1) return;     // 他の列を触っても動かない
  if (e.range.getRow() === 1) return;                  // 見出し行は対象外
  if (!isWon(e.range.getValue())) return;              // 外したときは無視

  e.range.setValue(false);                             // 押しっぱなしにならないよう戻す
  var result = addNextRound(sheet, idx);
  tell(result.message);
}


/** 1行目の見出しから、各列が何列目かを調べる。見つからなければ null。 */
function findColumns(sheet) {
  var last = sheet.getLastColumn();
  if (last < 1) return null;
  var header = sheet.getRange(1, 1, 1, last).getValues()[0];

  var idx = { round: -1, table: -1, name: -1, win: -1, run: -1 };
  for (var i = 0; i < header.length; i++) {
    var label = String(header[i] || '').trim();
    if (!label) continue;
    if (idx.run < 0 && /実行|ボタン/.test(label)) idx.run = i;   // チェックボックスを置く列
    else if (idx.round < 0 && /回戦|ラウンド/.test(label)) idx.round = i;
    else if (idx.table < 0 && /卓|テーブル|部屋/.test(label)) idx.table = i;
    else if (idx.name < 0 && /参加者|名前|プレイヤー|ユーザー/.test(label)) idx.name = i;
    else if (idx.win < 0 && /勝/.test(label)) idx.win = i;
  }
  // 見出しが無い列は、左から 回戦 / 卓 / 参加者 / 勝ち の順とみなす
  if (idx.round < 0) idx.round = 0;
  if (idx.table < 0) idx.table = 1;
  if (idx.name < 0) idx.name = 2;
  if (idx.win < 0) idx.win = 3;
  return idx;
}


function isWon(v) {
  return NOT_WON.indexOf(String(v == null ? '' : v).trim().toLowerCase()) < 0;
}


/**
 * 卓を番号順に並べるための比較。
 * **シートに書いた順のままだと「卓2, 卓1, 卓3」の順で勝者を集めてしまいます。**
 */
function byNumber(a, b) {
  var na = parseInt(String(a).replace(/[^0-9]/g, ''), 10);
  var nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}


/**
 * 最後の回戦が終わっていれば、次の回戦の行を足す。
 *
 * 戻り値は { added: 足した人数, message: 画面に出す文 }。
 * **押しても何も起きないと不安になるので、作れないときは理由を返します。**
 */
function addNextRound(sheet, idx) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return no('まだ参加者が書かれていません。');
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // 回戦ごとにまとめる（シートに出てくる順番を保つ）
  var order = [], rounds = {};
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var round = String(row[idx.round] || '').trim();
    var vc = String(row[idx.table] || '').trim();
    var name = String(row[idx.name] || '').trim();
    if (!round || !vc || !name) continue;

    if (!rounds[round]) { rounds[round] = { order: [], tables: {} }; order.push(round); }
    var R = rounds[round];
    if (!R.tables[vc]) { R.tables[vc] = []; R.order.push(vc); }
    R.tables[vc].push({ name: name, won: isWon(row[idx.win]) });
  }
  if (!order.length) return no('参加者が読み取れませんでした。回戦・卓・参加者がそろっているか確かめてください。');

  var lastLabel = order[order.length - 1];
  var last = rounds[lastLabel];
  if (last.order.length === 1) return no(lastLabel + 'は1卓だけなので、これが最後です。');

  var tableOrder = last.order.slice().sort(byNumber);  // 卓1, 卓2, 卓3 … の順にそろえる

  // 全部の卓に勝ちが入っているか確かめる。1卓でも空なら、まだ足さない
  var perTable = [], counts = [], empty = [];
  for (var t = 0; t < tableOrder.length; t++) {
    var seats = last.tables[tableOrder[t]];
    var w = [];
    for (var s = 0; s < seats.length; s++) if (seats[s].won) w.push(seats[s].name);
    if (!w.length) empty.push(tableOrder[t]);
    perTable.push(w);
    counts.push(w.length);
  }
  if (empty.length) {
    return no(lastLabel + 'の ' + empty.join('・') + ' に、まだ勝ちの印がありません。');
  }

  // **卓によって勝ちの数が違ううちは、まだ入れている途中とみなして待ちます。**
  // 「1卓に1人でもいれば終わり」にすると、最後の卓の1人目を入れた瞬間に
  // 次の回戦ができてしまい、2人目が入らないまま組まれます（実際にそうなっていました）。
  var most = Math.max.apply(null, counts);
  for (var c = 0; c < counts.length; c++) {
    if (counts[c] !== most) {
      return no(lastLabel + 'の勝ちの数がそろっていません（' +
                tableOrder.map(function (v, i) { return v + 'は' + counts[i] + '人'; }).join('・') +
                '）。入れ忘れがないか確かめてください。');
    }
  }

  var winners = [];
  for (var p = 0; p < perTable.length; p++) winners = winners.concat(perTable[p]);
  if (!winners.length) return no('勝ちの印が1つもありません。');

  // 勝った人を順番に配る。同じ卓から上がった人どうしが固まらないようにするため
  var tableCount = Math.max(1, Math.ceil(winners.length / SEAT));
  var tables = [];
  for (var n = 0; n < tableCount; n++) tables.push([]);
  for (var k = 0; k < winners.length; k++) tables[k % tableCount].push(winners[k]);

  var label = tableCount === 1 ? '決勝' : (order.length + 1) + '回戦';

  // 書き込む中身を組み立てる。触るのは4つの列だけで、他の列は空のままにする
  var width = sheet.getLastColumn();
  var out = [];
  for (var ti = 0; ti < tables.length; ti++) {
    for (var pi = 0; pi < tables[ti].length; pi++) {
      var line = [];
      for (var c2 = 0; c2 < width; c2++) line.push('');
      line[idx.round] = label;
      line[idx.table] = '卓' + (ti + 1);
      line[idx.name] = tables[ti][pi];
      line[idx.win] = '';
      out.push(line);
    }
  }
  if (!out.length) return no('作る相手がいませんでした。');

  sheet.getRange(lastRow + 1, 1, out.length, width).setValues(out);

  // どこが増えたのか分かるように、少しだけ色を付けて知らせる
  sheet.getRange(lastRow + 1, 1, out.length, width).setBackground('#FFF3D6');

  return { added: out.length, message: label + 'を作りました（' + out.length + '人／' + tableCount + '卓）。' };
}


/** 作れなかったときの戻り値。理由をそのまま画面に出します。 */
function no(message) {
  return { added: 0, message: message };
}
