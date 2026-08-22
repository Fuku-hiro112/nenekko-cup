/**
 * ねっ子ポカジャン大会 / トーナメント表のスプレッドシートに入れるスクリプト
 *
 * **押したときに、次の段の行を足します。** 勝手には増えません。
 *
 * 大会は3段階です（詳しくは docs/detail-design.md 章7-1）。
 *
 *     予選 → 順位決定戦 → 決勝 ＋ 最下位決定戦
 *
 * **どの卓も3戦**打ち、**3戦の合計点**で順位を決めます。
 * 順位も、次の段に誰が行くかも、このスクリプトとページが計算します。
 * シートに入れるのは**点数だけ**です。
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
 *       「ポカジャン大会 → 次の段を作る」
 *
 *  【2】ボタン（パソコン）
 *       挿入 → 図形描画 で四角を描いて「次の段を作る」と書く → 保存して閉じる
 *       → 図形の右上の「⋮」→ スクリプトを割り当て → createNextStage と入力
 *
 *  【3】チェックボックス（**スマホでも押せます**）
 *       空いている列の1行目に「実行」と書き、その下のセルにチェックボックスを置く
 *       （挿入 → チェックボックス）。チェックを入れると走り、自動で外れます。
 *
 * **スマホのアプリではメニューも図形ボタンも出ません。** 代わりの人が
 * スマホだけで進める可能性があるなら、【3】を用意しておいてください。
 *
 * ── 列について ──────────────────────────────────
 * 1行目の見出しから「回戦 / 卓 / 参加者 / 1戦目 / 2戦目 / 3戦目」の列を探します。
 * メモ用の列を足したり、順番を入れ替えたりしても動きます。
 */

var SEAT = 4;            // 1卓の人数
var GAMES = 3;           // 1つの卓で打つ回数

// 「回戦」列に入る言葉。**この4つ以外の段は作られません。**
var STAGE_QUAL  = '予選';
var STAGE_RANK  = '順位決定戦';
var STAGE_FINAL = '決勝';
var STAGE_LAST  = '最下位決定戦';


/** シートを開いたときに、上のメニューへ項目を足す（パソコンのみ）。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ポカジャン大会')
    .addItem('次の段を作る', 'createNextStage')
    .addToUi();
}


/**
 * 次の段を作る。**メニュー・図形ボタン・チェックボックスのどれからでもここに来ます。**
 * まだ作れないときは、その理由を画面に出します。
 */
function createNextStage() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var idx = findColumns(sheet);
  if (!idx) { tell('シートの見出しが読めません。1行目を「回戦 / 卓 / 参加者 / 1戦目 / 2戦目 / 3戦目」にしてください。'); return; }

  var result = addNextStage(sheet, idx);
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
  if (e.range.getValue() !== true) return;             // 外したときは無視

  e.range.setValue(false);                             // 押しっぱなしにならないよう戻す
  var result = addNextStage(sheet, idx);
  tell(result.message);
}


/** 1行目の見出しから、各列が何列目かを調べる。見つからなければ null。 */
function findColumns(sheet) {
  var last = sheet.getLastColumn();
  if (last < 1) return null;
  var header = sheet.getRange(1, 1, 1, last).getValues()[0];

  var idx = { round: -1, table: -1, name: -1, scores: [-1, -1, -1], result: -1, run: -1 };
  for (var i = 0; i < header.length; i++) {
    var label = String(header[i] || '').trim();
    if (!label) continue;
    if (idx.run < 0 && /実行|ボタン/.test(label)) { idx.run = i; continue; }
    if (idx.round < 0 && /回戦|ラウンド|段/.test(label)) { idx.round = i; continue; }
    if (idx.table < 0 && /卓|テーブル|部屋/.test(label)) { idx.table = i; continue; }
    if (idx.name < 0 && /参加者|名前|プレイヤー|ユーザー/.test(label)) { idx.name = i; continue; }

    // 「1戦目」「2戦目」「3戦目」。**先に見出しの数字を見ます。**
    var m = label.match(/([1-3１-３])\s*(戦|試合|回|局)/);
    if (m) {
      var zen = '１２３'.indexOf(m[1]);
      var n = zen >= 0 ? zen + 1 : Number(m[1]);
      idx.scores[n - 1] = i;
      continue;
    }
    // 「勝ち」「結果」。**シートを見やすくするためだけの列で、無くても動きます。**
    // ここに書いた文字は読み取りに使いません（毎回このスクリプトが書き直します）。
    if (idx.result < 0 && /勝|敗|結果|行き先/.test(label)) { idx.result = i; continue; }

    // 数字が書かれていない「点数」列は、出てきた順に左から埋めます
    if (/点|score/i.test(label)) {
      for (var s = 0; s < GAMES; s++) if (idx.scores[s] < 0) { idx.scores[s] = i; break; }
    }
  }
  // 見出しが無い列は、左から 回戦 / 卓 / 参加者 / 1戦目 / 2戦目 / 3戦目 の順とみなす
  if (idx.round < 0) idx.round = 0;
  if (idx.table < 0) idx.table = 1;
  if (idx.name < 0) idx.name = 2;
  for (var k = 0; k < GAMES; k++) if (idx.scores[k] < 0) idx.scores[k] = 3 + k;
  return idx;
}


/**
 * セルの点数を数値にする。入っていなければ null を返す。
 *
 * **空欄を 0 として扱ってはいけません。** 0点と「まだ入れていない」は別のことで、
 * 混ぜると対局中の卓に順位が出てしまいます。
 */
function parseScore(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;              // チェックボックスは点数ではない
  var s = String(v);
  // 全角の数字と符号を半角に直してから、カンマと空白を落とす
  s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
       .replace(/＋/g, '+')
       .replace(/[－ー−–—]/g, '-')
       .replace(/[,，\s]/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}


/**
 * **CPUは順位に入れません。**（席が埋まらないときに入る相手なので）
 * 点数が入っていても、進出の計算からは外します。
 */
function isCpu(name) {
  return /^cpu$/i.test(String(name).trim());
}


/**
 * 卓を番号順に並べるための比較。
 * **シートに書いた順のままだと「卓2, 卓1, 卓3」の順で集めてしまいます。**
 */
function byNumber(a, b) {
  var na = parseInt(String(a).replace(/[^0-9]/g, ''), 10);
  var nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}


/** シートを読んで、段 → 卓 → 席 の形にまとめる。 */
function readStages(sheet, idx) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  var order = [], stages = {}, seq = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var stage = String(row[idx.round] || '').trim();
    var vc = String(row[idx.table] || '').trim();
    var name = String(row[idx.name] || '').trim();
    if (!stage || !vc || !name) continue;

    var scores = [];
    for (var g = 0; g < GAMES; g++) scores.push(parseScore(row[idx.scores[g]]));

    if (!stages[stage]) { stages[stage] = { label: stage, order: [], tables: {} }; order.push(stage); }
    var S = stages[stage];
    if (!S.tables[vc]) { S.tables[vc] = { vc: vc, seats: [] }; S.order.push(vc); }
    S.tables[vc].seats.push(makeSeat(name, scores, seq++, i + 2));
  }
  if (!order.length) return null;
  return { order: order, stages: stages };
}


/**
 * 1つの席。`seq` はシートに出てきた順で、同点のときの並びに使います。
 * `row` はシートの行番号で、「勝ち」列へ書き戻すときに使います。
 */
function makeSeat(name, scores, seq, row) {
  var total = 0, filled = 0;
  for (var i = 0; i < scores.length; i++) if (scores[i] !== null) { total += scores[i]; filled++; }
  return {
    name: name, scores: scores, seq: seq, row: row,
    cpu: isCpu(name),
    total: filled ? total : null,
    done: filled === GAMES,
    rank: null, result: null
  };
}


/**
 * 卓の中で順位を付ける。**全員が3戦とも入っていなければ、何もしません。**
 *
 * 戻り値は { done, players, tied }。`players` は合計点の高い順です。
 * 同点はシートで上にある行を上位としますが、`tied` を立てて知らせます。
 */
function rankTable(table) {
  var players = [];
  for (var i = 0; i < table.seats.length; i++) if (!table.seats[i].cpu) players.push(table.seats[i]);
  if (!players.length) return { done: false, players: [], tied: false };

  var done = true;
  for (var j = 0; j < players.length; j++) if (!players[j].done) done = false;
  if (!done) return { done: false, players: players, tied: false };

  players.sort(compareSeats);
  var tied = false;
  for (var k = 0; k < players.length; k++) {
    players[k].rank = k + 1;
    if (k > 0 && players[k].total === players[k - 1].total) tied = true;
  }
  return { done: true, players: players, tied: tied };
}


/** 合計点の高い順。同点なら、シートで上にある行を先にする。 */
function compareSeats(a, b) {
  if (a.total !== b.total) return b.total - a.total;
  return a.seq - b.seq;
}


/**
 * 次の段の行を足す。
 *
 * 戻り値は { added: 足した人数, message: 画面に出す文 }。
 * **押しても何も起きないと不安になるので、作れないときは理由を返します。**
 */
function addNextStage(sheet, idx) {
  var read = readStages(sheet, idx);
  if (!read) return no('参加者が読み取れませんでした。回戦・卓・参加者がそろっているか確かめてください。');

  var stages = read.stages;

  // **先に「勝ち」列を書き直します。** 行が増えないときでも、
  // 決着した卓の行き先はシートに出したいためです（決勝の「優勝」もここで入ります）。
  var extra = refreshResults(sheet, idx, stages);

  if (stages[STAGE_FINAL] || stages[STAGE_LAST]) {
    return no(STAGE_FINAL + 'と' + STAGE_LAST + 'まで組み終わっています。ここが最後です。' + extra);
  }
  if (!stages[STAGE_QUAL]) {
    return no('「' + STAGE_QUAL + '」の行がありません。「回戦」の欄に ' + STAGE_QUAL + ' と書いてください。');
  }

  var qual = summarize(stages[STAGE_QUAL]);
  if (qual.pending.length) {
    return no(STAGE_QUAL + 'の ' + qual.pending.join('・') + ' に、まだ点数がそろっていません（' +
              GAMES + '戦ぶん全員の点数が要ります）。');
  }

  var N = qual.tableCount;
  if (N >= 5) {
    return no(STAGE_QUAL + 'が' + N + '卓あります。5卓以上（17人以上）はこの方式では組めません。運営に相談してください。');
  }
  if (N < 2) {
    return no(STAGE_QUAL + 'が' + N + '卓しかありません。2卓以上（5人以上）で使う方式です。');
  }

  // ── 順位決定戦を作る ──────────────────────────────
  if (!stages[STAGE_RANK]) {
    if (!qual.middles.length) {
      return no(STAGE_QUAL + 'に中間の順位の人がいません。1卓あたり3人以上で組んでください。');
    }
    var tables = spread(qual.middles);
    var rows = [];
    for (var t = 0; t < tables.length; t++) {
      for (var p = 0; p < tables[t].length; p++) {
        rows.push({ stage: STAGE_RANK, vc: '卓' + (t + 1), name: tables[t][p].name });
      }
    }
    var addedRank = write(sheet, idx, rows);
    return {
      added: addedRank,
      message: STAGE_RANK + 'を作りました（' + addedRank + '人／' + tables.length + '卓）。' +
               '各卓' + GAMES + '戦ぶんの点数を入れてください。' + extra + tieNote(qual.tied, STAGE_QUAL)
    };
  }

  // ── 決勝と最下位決定戦を作る ─────────────────────────
  var rank = summarize(stages[STAGE_RANK]);
  if (rank.pending.length) {
    return no(STAGE_RANK + 'の ' + rank.pending.join('・') + ' に、まだ点数がそろっていません（' +
              GAMES + '戦ぶん全員の点数が要ります）。');
  }

  // 卓をまたいで、合計点そのもので通し順位を付ける
  var overall = rank.players.slice().sort(compareSeats);
  // **中間の人が少ないと「上へK人・下へK人」が取れません。**（7人以下で起きます）
  // そのときは K を減らし、決勝と最下位決定戦の空席はCPUに任せます。
  var K = Math.min(Math.max(0, SEAT - N), Math.floor(overall.length / 2));

  var toFinal = qual.tops.slice();
  var toLast = qual.bottoms.slice();
  for (var u = 0; u < K; u++) toFinal.push(overall[u]);
  for (var d = 0; d < K; d++) toLast.push(overall[overall.length - K + d]);

  var out = [];
  for (var f = 0; f < toFinal.length; f++) out.push({ stage: STAGE_FINAL, vc: '卓1', name: toFinal[f].name });
  for (var l = 0; l < toLast.length; l++) out.push({ stage: STAGE_LAST, vc: '卓1', name: toLast[l].name });

  var addedFinal = write(sheet, idx, out);
  var short = '';
  if (toFinal.length !== SEAT || toLast.length !== SEAT) {
    short = '　※' + STAGE_FINAL + 'が' + toFinal.length + '人、' + STAGE_LAST + 'が' + toLast.length +
            '人になりました。足りないぶんはCPUが入ります。';
  }
  return {
    added: addedFinal,
    message: STAGE_FINAL + 'と' + STAGE_LAST + 'を作りました（合わせて' + addedFinal + '人）。' +
             short + extra + tieNote(rank.tied, STAGE_RANK)
  };
}


/**
 * 「勝ち」列に、決着した卓の**行き先**を書き直す。
 *
 * **シートを見やすくするためだけの列です。** 読み取りには一切使いません。
 * 手で書いた文字は、押すたびに計算どおりの内容へ置き換わります。
 * 列が無ければ何もしません。
 */
function refreshResults(sheet, idx, stages) {
  if (idx.result < 0) return '';

  var qual = stages[STAGE_QUAL] ? summarize(stages[STAGE_QUAL]) : null;
  var rank = stages[STAGE_RANK] ? summarize(stages[STAGE_RANK]) : null;

  var TO_FINAL = '勝ち（' + STAGE_FINAL + 'へ）';
  var TO_LAST = '負け（' + STAGE_LAST + 'へ）';

  if (qual) {
    label(qual.tops, TO_FINAL);
    label(qual.bottoms, TO_LAST);
    label(qual.middles, STAGE_RANK + 'へ');
  }

  if (rank && !rank.pending.length) {
    // **上下に抜ける人がいないこともあります。**（予選が4卓だと決勝の席が
    // 予選1位で埋まるため）そのときは全員「ここで順位確定」になります。
    label(rank.players, 'ここで順位確定');
    var overall = rank.players.slice().sort(compareSeats);
    var K = qual ? Math.min(Math.max(0, SEAT - qual.tableCount), Math.floor(overall.length / 2)) : 0;
    for (var u = 0; u < K; u++) overall[u].result = TO_FINAL;
    for (var d = 0; d < K; d++) overall[overall.length - K + d].result = TO_LAST;
  }

  // 決勝は1位だけ「優勝」。**最下位決定戦には「優勝」を出しません。**
  place(stages[STAGE_FINAL], true);
  place(stages[STAGE_LAST], false);

  return flushResults(sheet, idx, stages);
}


/** 席の並びに同じ言葉を付ける。CPUは飛ばす（順位に入れていないため）。 */
function label(seats, text) {
  for (var i = 0; i < seats.length; i++) if (!seats[i].cpu) seats[i].result = text;
}


/** 1卓しかない段に「優勝」「2位」…を付ける。 */
function place(stage, champion) {
  if (!stage) return;
  var sum = summarize(stage);
  if (sum.pending.length) return;
  for (var i = 0; i < sum.players.length; i++) {
    var seat = sum.players[i];
    seat.result = (champion && seat.rank === 1) ? '優勝' : seat.rank + '位';
  }
}


/**
 * 付けた言葉をシートの列へ流し込む。
 *
 * **列をまとめて1回で書きます。** 1セルずつ書くと、卓が増えたときに目に見えて遅くなります。
 * 計算していない行（CPUや空行）は、いま入っている値のままにします。
 */
function flushResults(sheet, idx, stages) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';

  var range = sheet.getRange(2, idx.result + 1, lastRow - 1, 1);
  var col = range.getValues();
  var changed = 0;

  var keys = Object.keys(stages);
  for (var k = 0; k < keys.length; k++) {
    var S = stages[keys[k]];
    for (var t = 0; t < S.order.length; t++) {
      var seats = S.tables[S.order[t]].seats;
      for (var i = 0; i < seats.length; i++) {
        var seat = seats[i];
        if (seat.result === null) continue;
        var r = seat.row - 2;
        if (r < 0 || r >= col.length) continue;
        if (String(col[r][0]) !== seat.result) { col[r][0] = seat.result; changed++; }
      }
    }
  }
  if (!changed) return '';
  range.setValues(col);
  return '　「勝ち」の列も書き直しました（' + changed + '人ぶん）。';
}


/**
 * 1つの段をまとめて見る。
 *
 * 戻り値:
 *   pending    まだ点数がそろっていない卓の名前
 *   tableCount 卓の数
 *   tops       各卓の1位（卓番号順）
 *   bottoms    各卓の最下位（卓番号順）。**非CPUが1人の卓では出しません**
 *   middles    あいだの人。**順位の昇順 → 卓番号順**に並べてあります
 *   players    非CPUの全員
 *   tied       同点があったか
 */
function summarize(stage) {
  var order = stage.order.slice().sort(byNumber);
  var pending = [], tops = [], bottoms = [], middles = [], players = [], tied = false;

  for (var t = 0; t < order.length; t++) {
    var res = rankTable(stage.tables[order[t]]);
    if (!res.done) { pending.push(order[t]); continue; }
    if (res.tied) tied = true;

    for (var p = 0; p < res.players.length; p++) {
      var seat = res.players[p];
      seat.tableIndex = t;
      players.push(seat);
      // **1人しかいない卓では、1位が最下位を兼ねます。**
      // そのときは決勝を優先し、最下位決定戦へは送りません。
      if (p === 0) tops.push(seat);
      else if (p === res.players.length - 1) bottoms.push(seat);
      else middles.push(seat);
    }
  }

  // 順位の昇順 → 卓番号順。**予選の卓順のまま配ると「2位だけの卓」と
  // 「3位だけの卓」に分かれ、素点で比べるこの方式では不公平になります。**
  middles.sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.tableIndex - b.tableIndex;
  });

  return {
    pending: pending, tableCount: order.length,
    tops: tops, bottoms: bottoms, middles: middles,
    players: players, tied: tied
  };
}


/** 人を卓へ順ぐりに配る。出身の卓が固まらないようにするため。 */
function spread(people) {
  var n = Math.max(1, Math.ceil(people.length / SEAT));
  var tables = [];
  for (var i = 0; i < n; i++) tables.push([]);
  for (var k = 0; k < people.length; k++) tables[k % n].push(people[k]);
  return tables;
}


/** 同点があったときのひとこと。**黙って決めたくないので必ず添えます。** */
function tieNote(tied, label) {
  return tied
    ? '　※' + label + 'に同点がありました。上の行を上位として扱っています。順番を変えるなら行を入れ替えてください。'
    : '';
}


/**
 * 行をシートの末尾に足して、足した人数を返す。
 *
 * **触るのは「回戦・卓・参加者」が収まる範囲だけです。**
 * シートの幅をまるごと書くと、「実行」列に置いたチェックボックスや
 * メモ列まで空白で上書きしてしまいます。
 */
function write(sheet, idx, rows) {
  if (!rows.length) return 0;
  var lastRow = sheet.getLastRow();
  var from = Math.min(idx.round, idx.table, idx.name);
  var to = Math.max(idx.round, idx.table, idx.name);
  var width = to - from + 1;

  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var line = [];
    for (var c = 0; c < width; c++) line.push('');
    line[idx.round - from] = rows[i].stage;
    line[idx.table - from] = rows[i].vc;
    line[idx.name - from] = rows[i].name;
    out.push(line);
  }
  var range = sheet.getRange(lastRow + 1, from + 1, out.length, width);
  range.setValues(out);

  // どこが増えたのか分かるように、少しだけ色を付けて知らせる。
  // **色付けに失敗しても、行はもう足してあるので握りつぶします。**
  // （シートを「テーブル」にしていると、書式はテーブル側が握っています）
  try {
    range.setBackground('#FFF3D6');
  } catch (err) {
    // 色が付かないだけ。行は入っています
  }
  return out.length;
}


/** 作れなかったときの戻り値。理由をそのまま画面に出します。 */
function no(message) {
  return { added: 0, message: message };
}
