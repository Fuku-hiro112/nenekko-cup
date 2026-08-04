/**
 * ねっこ杯 ポカジャン大会 / script.js
 *
 * このファイルは「演出」と「ナビゲーション」だけを担当します。
 * 大会情報などの文言は index.html に直接書かれています（JSが動かなくても全文が読めます）。
 *
 *  1. 画像スロット   … assets/img/ の画像を、読み込めたものだけ表示
 *  2. カウントダウン … 開催日時までの残り。日時そのものはHTML側にも書いてあります
 *  3. reveal        … スクロールでセクションの中身をずらして表示
 *  4. ヘッダー       … スクロール量に応じて浮かせる
 *  5. ナビ開閉       … モバイルのハンバーガーメニュー
 *  6. 流れる帯       … 画面を埋めるのに足りないぶんセットを複製
 *  7. トーナメント表 … Googleスプレッドシートを読んで組み立て
 *
 * ローディングと配牌はCSSだけで完結させてあります。
 * このファイルの読み込みに失敗しても、本文が隠れたままになることはありません。
 */
(function () {
  'use strict';

  // reveal で要素を隠すのは、このファイルが実際に動いたときだけにする
  document.documentElement.classList.add('anim');

  /* ---------- 1. 画像スロット ----------
     ファイルが無いときに壊れた画像アイコンを出さないため、
     読み込めたことを確認してから hidden を外します。

       [data-img-slot]              … 画像1枚ぶんの枠
       [data-reveals="名前"]         … 読み込めたら、その名前のまとまりも一緒に出す
       [data-img-group="名前"]       … 見出しなど、まとまり側の要素

     ゲーム画面のスクショのように「1枚も置かれていないかもしれない」画像は、
     見出しごと消えるようにしておく。 */
  document.querySelectorAll('[data-img-slot]').forEach(function (slot) {
    var img = slot.querySelector('img');
    if (!img) return;

    var reveal = function () {
      if (img.naturalWidth === 0) return;
      slot.hidden = false;

      var group = slot.dataset.reveals;
      if (!group) return;
      document.querySelectorAll('[data-img-group="' + group + '"]').forEach(function (owner) {
        owner.hidden = false;
      });
    };

    if (img.complete) reveal();
    else img.addEventListener('load', reveal);
  });

  /* ---------- 2. カウントダウン ---------- */
  var countdown = document.querySelector('.countdown');
  if (countdown && countdown.dataset.deadline) {
    var target = new Date(countdown.dataset.deadline);

    if (!isNaN(target.getTime())) {
      var cells = {};
      countdown.querySelectorAll('[data-unit]').forEach(function (el) {
        cells[el.dataset.unit] = el;
      });

      // 値が変わったセルだけ小さく跳ねさせる
      var put = function (el, value) {
        var next = String(value);
        if (el.textContent === next) return;
        el.textContent = next;
        el.classList.remove('is-bumped');
        void el.offsetWidth;         // アニメーションを再生し直すための強制リフロー
        el.classList.add('is-bumped');
      };

      var first = true;
      var tick = function () {
        var minutes = Math.floor((target - new Date()) / 60000);
        if (minutes < 0) {          // 開催日を過ぎたら黙って消す
          countdown.hidden = true;
          return false;
        }
        if (first) {                // 初回は跳ねさせない（入場アニメと重なるため）
          cells.days.textContent = Math.floor(minutes / 1440);
          cells.hours.textContent = Math.floor((minutes % 1440) / 60);
          cells.minutes.textContent = minutes % 60;
          first = false;
        } else {
          put(cells.days, Math.floor(minutes / 1440));
          put(cells.hours, Math.floor((minutes % 1440) / 60));
          put(cells.minutes, minutes % 60);
        }
        countdown.hidden = false;
        return true;
      };

      if (tick()) setInterval(tick, 30000);
    }
  }

  /* ---------- 3. スクロール reveal ---------- */
  var revealTargets = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target); // 一度きり
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });

    revealTargets.forEach(function (el) { observer.observe(el); });
  } else {
    // 非対応ブラウザでは最初から表示する
    revealTargets.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- 4. スクロールでヘッダーを浮かせる ---------- */
  var root = document.documentElement;
  var onScroll = function () {
    root.classList.toggle('is-scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 5. モバイルナビ ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    // メニュー内のリンクを押したら閉じる
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      setOpen(false);
      toggle.focus();
    });
  }

  /* ---------- 6. 流れる帯のセットを画面幅に合わせる ----------
     帯は「1セット分だけ左へ動かして、次のセットが同じ位置に来たら折り返す」作りです。
     そのため、1セットが画面より狭いと折り返す直前に右側が空きます
     （1セット982px・画面1674px のとき、右に692pxの空白が出ていました）。

     画面を埋めるのに足りない分をここで複製し、セット数を --marquee-sets に入れます。
     移動量はCSS側で 100% ÷ セット数＝常に1セット分になるので、
     何セットに増えても流れる速さは変わりません。 */
  var track = document.querySelector('.marquee__track');
  var master = track && track.querySelector('.marquee__set');

  if (track && master) {
    var fitMarquee = function () {
      // 画面が広がったときに測り直せるよう、いったん元の1セットまで戻す
      while (track.children.length > 1) track.removeChild(track.lastElementChild);

      var setWidth = master.getBoundingClientRect().width;
      if (!setWidth) return;                  // 表示前などで測れないときは何もしない

      // 動く1セット分に加えて、画面を覆えるだけのセットを用意する
      var needed = Math.ceil(window.innerWidth / setWidth) + 1;
      for (var i = 1; i < needed; i++) track.appendChild(master.cloneNode(true));

      track.style.setProperty('--marquee-sets', needed);

      // 動かしてよいのは複製が済んだここから。CSS はこのクラスを見て初めて流し始める
      // （このファイルが読めなかったときに、1セットのまま動いて帯が消えるのを防ぐ）
      track.classList.add('is-fitted');

      // keyframes の移動量は変数から計算されるので、変えたら animation を作り直す
      track.style.animation = 'none';
      void track.offsetWidth;                 // 強制リフロー
      track.style.animation = '';
    };

    fitMarquee();

    // 幅が変わったときだけ組み直す（スマホのアドレスバー開閉で高さだけ動くのは無視）
    var lastWidth = window.innerWidth;
    var resizeTimer;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitMarquee, 200);
    });

    // Webフォントが後から入ると文字幅が変わるため、その時点で測り直す
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitMarquee);
  }

  /* ---------- 7. トーナメント表をスプレッドシートから作る ----------
     当日、主催者が動けなくても誰かが結果を入れられるようにするための仕組みです。
     Googleスプレッドシートの「勝ち」欄に印を入れるだけで、この表が変わります。
     GitHub も Python も要りません。

     シートはこの4列です（1行目は見出し）。

         回戦 | 卓 | 参加者 | 勝ち
         1回戦 | 卓1 | ふろん | ○

     **2回戦以降はシートに書かなくて構いません。** 勝った人を集めて、
     ここで自動的に組み直します。

     取得に JSONP を使っているのは、Googleのスプレッドシートが
     `Access-Control-Allow-Origin` を返さず、fetch では読めないためです
     （実測して確認しました）。script タグでの読み込みなら制限を受けません。 */
  var bracket = document.querySelector('[data-sheet]');

  if (bracket && bracket.dataset.sheet) {
    var SEAT = 4;
    var CB = 'nenekkoBracket';

    var esc = function (s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };

    // 「勝ち」の欄がこれらのときは、勝ちにしません。
    // **チェックボックスは、外していても false という値が入ります。**
    // 「何か入っていれば勝ち」にすると、外したチェックや「×」まで勝ちになります
    // （実際にそうなっていました）。負けを表す書きかたはここに足してください。
    var NOT_WON = ['', 'false', '0', '×', 'ｘ', 'x', '✕', '✗', '-', '－', 'ー',
                   'なし', '負け', 'まけ', 'no', 'n'];

    var isWon = function (v) {
      return NOT_WON.indexOf(String(v == null ? '' : v).trim().toLowerCase()) < 0;
    };

    // **CPUは勝ち上がりません。**（上位に入ったら、その下の人が繰り上がる決まり）
    // 間違って印を付けても次の回戦に出てこないよう、ここで弾いています。
    var isCpu = function (name) {
      return /^cpu$/i.test(String(name).trim());
    };

    // 卓を番号順に並べる。**シートに書いた順のままだと「卓2, 卓1, 卓3」のように出ます。**
    // 表示だけでなく、次の回戦へ配る順番もこれで決まるので、ここでそろえておきます。
    var byNumber = function (a, b) {
      var na = parseInt(String(a).replace(/[^0-9]/g, ''), 10);
      var nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    };

    // 勝った人を集めて次の回戦を組む（update_bracket.py と同じ配りかた）
    var nextRound = function (winners) {
      var n = Math.max(1, Math.ceil(winners.length / SEAT));
      var tables = [];
      for (var i = 0; i < n; i++) tables.push({ vc: '卓' + (i + 1), seats: [] });
      winners.forEach(function (name, i) {
        tables[i % n].seats.push({ name: name, won: false });
      });
      return tables;
    };

    var render = function (rounds) {
      var html = '<div class="rounds">';
      rounds.forEach(function (rnd, ri) {
        // 「優勝」を出すのは決勝だけ。**卓が1つでも、見出しが決勝でなければ出さない**
        // （参加者が4人以下だと1回戦がそのまま1卓になり、優勝と誤表示していました）
        var isFinal = ri === rounds.length - 1 && rnd.tables.length === 1 &&
                      rnd.label.indexOf('決勝') >= 0;
        html += '<div class="round"><h3 class="round__label">' + esc(rnd.label) + '</h3>';
        html += '<div class="round__tables">';
        rnd.tables.forEach(function (t) {
          html += '<div class="tablecard"><h4 class="tablecard__name">' + esc(t.vc) + '</h4>';
          html += '<ul class="tablecard__seats">';
          t.seats.forEach(function (s) {
            var cls = s.name === 'CPU' ? ' class="is-cpu"'
              : s.won ? (isFinal ? ' class="is-winner is-champion"' : ' class="is-winner"') : '';
            html += '<li' + cls + '>' + esc(s.name) + '</li>';
          });
          // 4人に満たない卓は、そのまま始めると空席にCPUが入る
          for (var k = t.seats.length; k < SEAT; k++) html += '<li class="is-cpu">CPU</li>';
          html += '</ul></div>';
        });
        html += '</div></div>';
      });
      bracket.innerHTML = html + '</div>';
    };

    // 見出しから列の位置を探す。メモ列を足したり並べ替えたりしても動くようにするため。
    // 見出しで見つからない列は、左から 回戦 / 卓 / 参加者 / 勝ち の順とみなします。
    var pickColumns = function (cols) {
      var idx = { round: 0, table: 1, name: 2, win: 3 };
      (cols || []).forEach(function (c, i) {
        var label = String((c && (c.label || '')) || '').trim();
        if (!label) return;
        if (/回戦|ラウンド/.test(label)) idx.round = i;
        else if (/卓|テーブル|部屋/.test(label)) idx.table = i;
        else if (/参加者|名前|プレイヤー|ユーザー/.test(label)) idx.name = i;
        else if (/勝/.test(label)) idx.win = i;
      });
      return idx;
    };

    var build = function (rows, idx) {
      // 「回戦 → 卓 → 参加者」の順にまとめる。シートの並び順をそのまま活かす
      var order = [], byRound = {};
      rows.forEach(function (r) {
        var round = (r[idx.round] || '').trim(),
            vc = (r[idx.table] || '').trim(),
            name = (r[idx.name] || '').trim();
        if (!round || !vc || !name) return;
        if (!byRound[round]) { byRound[round] = { label: round, order: [], tables: {} }; order.push(round); }
        var R = byRound[round];
        if (!R.tables[vc]) { R.tables[vc] = { vc: vc, seats: [] }; R.order.push(vc); }
        R.tables[vc].seats.push({ name: name, won: !isCpu(name) && isWon(r[idx.win]) });
      });
      if (!order.length) return null;

      var rounds = order.map(function (k) {
        var R = byRound[k];
        return { label: R.label, tables: R.order.slice().sort(byNumber).map(function (v) { return R.tables[v]; }) };
      });

      // シートに無い先の回戦は、勝った人から組み立てる
      var guard = 0;
      while (guard++ < 10) {
        var last = rounds[rounds.length - 1];
        if (last.tables.length === 1) break;                    // 決勝まで来た
        var perTable = [];
        var done = last.tables.every(function (t) {
          var w = t.seats.filter(function (s) { return s.won; });
          if (!w.length) return false;                          // まだ手が付いていない卓がある
          perTable.push(w);
          return true;
        });
        if (!done) break;

        // **勝ち上がる人数は卓によって違ってかまいません。**（参加人数で変わるため）
        // 各卓に1人でも印があれば次の回戦を組みます。
        var winners = [];
        perTable.forEach(function (w) {
          w.forEach(function (s) { winners.push(s.name); });
        });
        if (!winners.length) break;
        var tables = nextRound(winners);
        rounds.push({ label: tables.length === 1 ? '決勝' : (rounds.length + 1) + '回戦', tables: tables });
      }
      return rounds;
    };

    window[CB] = function (res) {
      try {
        if (!res || !res.table || !res.table.rows) return;
        var rows = res.table.rows.map(function (row) {
          return (row.c || []).map(function (cell) { return cell && cell.v != null ? String(cell.v) : ''; });
        });
        // URL に headers=1 を付けているので、見出し行は普通ここに入ってきません。
        // 入ってきたときのために落としますが、**1列目がちょうど「回戦」のときだけ**です。
        // 緩く判定すると「決勝」で始まる行まで見出しとみなして捨ててしまいます（実際に踏みました）。
        var idx = pickColumns(res.table.cols);
        if (rows.length && (rows[0][idx.round] || '').trim() === '回戦') rows.shift();
        var rounds = build(rows, idx);
        if (rounds) render(rounds);
      } catch (e) {
        // 表が出ないだけで、ページの他は動き続けてほしいので握りつぶす
      }
    };

    var url = 'https://docs.google.com/spreadsheets/d/' + bracket.dataset.sheet +
      '/gviz/tq?tqx=responseHandler:' + CB +
      (bracket.dataset.sheetName ? '&sheet=' + encodeURIComponent(bracket.dataset.sheetName) : '') +
      '&headers=1&_=' + Date.now();                             // キャッシュ避け

    var tag = document.createElement('script');
    tag.src = url;
    tag.async = true;
    // 読めなかったときは、HTMLに書いてある「当日をお楽しみに」がそのまま残る
    document.head.appendChild(tag);
  }
})();
