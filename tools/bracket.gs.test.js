/**
 * bracket.gs のロジックを、スプレッドシートを模して検証する。
 *
 *     node tools/bracket.gs.test.js
 *
 * GAS は Google 側でしか動かないので、使っている API だけ偽物を用意している。
 * **bracket.gs を直したら、これを流してから貼り直すこと。**
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'bracket.gs');
const code = fs.readFileSync(SRC, 'utf8');

function makeSheet(header, rows) {
  const grid = [header, ...rows.map(r => {
    const line = new Array(header.length).fill('');
    r.forEach((v, i) => line[i] = v);
    return line;
  })];
  return {
    _grid: grid,
    _toasts: [],
    getLastRow: () => grid.length,
    getLastColumn: () => header.length,
    getRange(row, col, numRows, numCols) {
      return {
        getValues: () => grid.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
        setValues: (vals) => { vals.forEach((v, i) => grid[row - 1 + i] = v.slice()); },
        setBackground: () => {},
        getColumn: () => col,
        getSheet: () => null,
      };
    },
  };
}

function run(name, header, rows, expect) {
  const sheet = makeSheet(header, rows);
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ toast: (m) => sheet._toasts.push(m) }) },
    console,
  };
  const fn = new Function('SpreadsheetApp', code + '\nreturn { findColumns, addNextRound, isWon };');
  const api = fn(sandbox.SpreadsheetApp);

  const idx = api.findColumns(sheet);
  api.addNextRound(sheet, idx);

  const added = sheet._grid.slice(1 + rows.length);
  const summary = added.length
    ? added.map(r => `${r[idx.round]}/${r[idx.table]}/${r[idx.name]}`).join(', ')
    : '(追加なし)';
  const ok = summary === expect;
  console.log(`${ok ? 'OK  ' : '!!  '} ${name}`);
  console.log(`      期待: ${expect}`);
  if (!ok) console.log(`      実際: ${summary}`);
  else if (added.length) console.log(`      実際: ${summary}`);
  return ok;
}

const H = ['回戦', '卓', '参加者', '勝ち'];
let pass = 0, total = 0;
const check = (...a) => { total++; if (run(...a)) pass++; console.log(); };

// ① 1回戦が全部終わった → 2回戦（この例は8人→勝者4人なので決勝）
check('8人・1回戦が全卓終了 → 決勝ができる', H, [
  ['1回戦','卓1','ふろん','○'], ['1回戦','卓1','てるてる',''],
  ['1回戦','卓1','アシエンSS','○'], ['1回戦','卓1','どこばか',''],
  ['1回戦','卓2','花園美咲','○'], ['1回戦','卓2','しゃるろって',''],
  ['1回戦','卓2','Fukagami','○'], ['1回戦','卓2','アオ',''],
], '決勝/卓1/ふろん, 決勝/卓1/アシエンSS, 決勝/卓1/花園美咲, 決勝/卓1/Fukagami');

// ② 卓2がまだ終わっていない → 何も足さない
check('1卓でも未了なら足さない', H, [
  ['1回戦','卓1','ふろん','○'], ['1回戦','卓1','てるてる',''],
  ['1回戦','卓1','アシエンSS','○'], ['1回戦','卓1','どこばか',''],
  ['1回戦','卓2','花園美咲',''], ['1回戦','卓2','しゃるろって',''],
  ['1回戦','卓2','Fukagami',''], ['1回戦','卓2','アオ',''],
], '(追加なし)');

// ③ チェックボックス（false）が負けとして扱われるか
check('チェックボックスの false は負け', H, [
  ['1回戦','卓1','ふろん',true], ['1回戦','卓1','てるてる',false],
  ['1回戦','卓1','アシエンSS',true], ['1回戦','卓1','どこばか',false],
  ['1回戦','卓2','花園美咲',true], ['1回戦','卓2','しゃるろって',false],
  ['1回戦','卓2','Fukagami',true], ['1回戦','卓2','アオ',false],
], '決勝/卓1/ふろん, 決勝/卓1/アシエンSS, 決勝/卓1/花園美咲, 決勝/卓1/Fukagami');

// ④ 決勝まで来ていたら、それ以上足さない
check('決勝の勝者を入れても足さない', H, [
  ['決勝','卓1','ふろん','○'], ['決勝','卓1','アシエンSS',''],
  ['決勝','卓1','花園美咲',''], ['決勝','卓1','Fukagami',''],
], '(追加なし)');

// ⑤ 12人3卓 → 2回戦は6人2卓。出身の卓がばらけるか
check('12人3卓 → 2回戦6人2卓／出身卓がばらける', H, [
  ['1回戦','卓1','A','○'], ['1回戦','卓1','B','○'], ['1回戦','卓1','C',''], ['1回戦','卓1','D',''],
  ['1回戦','卓2','E','○'], ['1回戦','卓2','F','○'], ['1回戦','卓2','G',''], ['1回戦','卓2','H',''],
  ['1回戦','卓3','I','○'], ['1回戦','卓3','J','○'], ['1回戦','卓3','K',''], ['1回戦','卓3','L',''],
], '2回戦/卓1/A, 2回戦/卓1/E, 2回戦/卓1/I, 2回戦/卓2/B, 2回戦/卓2/F, 2回戦/卓2/J');

// ⑥ すでに2回戦が書かれていて未了 → 足さない（二重に増えないか）
check('2回戦が未了なら重ねて足さない', H, [
  ['1回戦','卓1','A','○'], ['1回戦','卓1','B','○'], ['1回戦','卓1','C',''], ['1回戦','卓1','D',''],
  ['1回戦','卓2','E','○'], ['1回戦','卓2','F','○'], ['1回戦','卓2','G',''], ['1回戦','卓2','H',''],
  ['2回戦','卓1','A',''], ['2回戦','卓1','E',''], ['2回戦','卓1','B',''], ['2回戦','卓1','F',''],
], '(追加なし)');

// ⑦ メモ列が先頭にあっても、見出しから列を見つけられるか
check('メモ列があっても列を見つける', ['メモ','回戦','卓','参加者','勝ち'], [
  ['','1回戦','卓1','A','○'], ['','1回戦','卓1','B','○'], ['','1回戦','卓1','C',''], ['','1回戦','卓1','D',''],
  ['','1回戦','卓2','E','○'], ['','1回戦','卓2','F','○'], ['','1回戦','卓2','G',''], ['','1回戦','卓2','H',''],
], '決勝/卓1/A, 決勝/卓1/B, 決勝/卓1/E, 決勝/卓1/F');

console.log(`\n${pass}/${total} 件が期待どおり`);
process.exit(pass === total ? 0 : 1);
