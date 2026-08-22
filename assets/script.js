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

  /* ---------- 6.5 優勝の祝い ----------
     優勝者が決まっている間は、トーナメント表の中でずっと祝い続けます。

     紙吹雪は画面全体ではなく表の中だけに降らせます。層を .bracket の中に置き、
     はみ出したぶんは切っているので、他の欄には落ちません。

     表はスプレッドシートから作られることも、update_bracket.py で HTML に
     焼き付けられることもあるので、どちらでも動くように
     「.is-champion があるか」だけを見ています。

     表が画面の外にある間は紙を止めます。ずっと動かし続ける必要がないうえ、
     止めておけばその間の描画をまるごと省けるためです。 */
  var CONFETTI = 90;
  var confettiLayer = null;

  var buildConfetti = function (host) {
    var layer = document.createElement('div');
    layer.className = 'confetti';
    layer.setAttribute('aria-hidden', 'true');
    var colors = ['#FF7FB0', '#FF9A3C', '#FFD84D', '#7ED957', '#5BC8E8', '#FFFFFF', '#F0B429'];
    var html = '';
    for (var i = 0; i < CONFETTI; i++) {
      var w = 6 + Math.random() * 9;
      html += '<i style="' +
        '--x:'   + (Math.random() * 100).toFixed(1) + '%;' +
        '--w:'   + w.toFixed(1) + 'px;' +
        '--h:'   + (w * (0.4 + Math.random() * 1.3)).toFixed(1) + 'px;' +
        '--c:'   + colors[i % colors.length] + ';' +
        '--r:'   + (Math.random() < 0.35 ? '50%' : '2px') + ';' +
        '--dx:'  + (Math.random() * 220 - 110).toFixed(0) + 'px;' +
        '--rot:' + (Math.random() * 1440 - 720).toFixed(0) + 'deg;' +
        '--dur:' + (3.2 + Math.random() * 3.4).toFixed(2) + 's;' +
        '--d:'   + (Math.random() * -6).toFixed(2) + 's;' +   // 負の遅延で、開いた時点から降っている状態にする
        '"></i>';
    }
    layer.innerHTML = html;
    host.appendChild(layer);
    return layer;
  };

  // 落ちる距離は表の高さに合わせます。回戦が増えると表が伸びるためです
  var sizeConfetti = function (host) {
    if (confettiLayer) confettiLayer.style.setProperty('--fall', (host.offsetHeight + 80) + 'px');
  };

  var syncCelebration = function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var host = document.querySelector('.bracket');
    if (!host) return;
    var champ = host.querySelector('.is-champion');

    if (!champ) {                                  // まだ優勝者がいない
      if (confettiLayer) {
        confettiLayer.parentNode.removeChild(confettiLayer);
        confettiLayer = null;
      }
      return;
    }

    if (!confettiLayer) {                          // ここで一式を用意する
      champ.classList.add('is-celebrating');
      if (!champ.querySelector('.champ-rays')) {
        var rays = document.createElement('span');
        rays.className = 'champ-rays';
        rays.setAttribute('aria-hidden', 'true');
        champ.appendChild(rays);
      }
      confettiLayer = buildConfetti(host);
      sizeConfetti(host);
    }

    // 表が画面に入っている間だけ紙を動かす
    var r = host.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    confettiLayer.classList.toggle('is-running', r.bottom > 0 && r.top < vh);
  };

  window.addEventListener('scroll', syncCelebration, { passive: true });
  window.addEventListener('resize', function () {
    var host = document.querySelector('.bracket');
    if (host) sizeConfetti(host);
    syncCelebration();
  });
  // HTMLに焼き付けてある場合は、この時点でもう優勝者がいます
  syncCelebration();

  /* ---------- 7. トーナメント表をスプレッドシートから作る ----------
     当日、主催者が動けなくても誰かが結果を入れられるようにするための仕組みです。
     Googleスプレッドシートに**点数を入れるだけ**で、この表が変わります。
     GitHub も Python も要りません。

     大会は3段階です（仕様は docs/detail-design.md 章7-1）。

         予選 → 順位決定戦 → 決勝 ＋ 最下位決定戦

     **どの卓も3戦**打ち、**3戦の合計点**で順位を決めます。
     順位も、次の段に誰が行くかも、ここで計算します。

     シートはこの6列です（1行目は見出し）。

         回戦 | 卓 | 参加者 | 1戦目 | 2戦目 | 3戦目
         予選 | 卓1 | ふろん | 12300 | 8400 | 15100

     **先の段はシートに書かなくて構いません。** 前の段が終わっていれば、
     ここで組み立てて「（予定）」として先に見せます。

     取得に JSONP を使っているのは、Googleのスプレッドシートが
     `Access-Control-Allow-Origin` を返さず、fetch では読めないためです
     （実測して確認しました）。script タグでの読み込みなら制限を受けません。 */
  var bracket = document.querySelector('[data-sheet]');

  if (bracket && bracket.dataset.sheet) {
    var SEAT = 4;                 // 1卓の人数
    var GAMES = 3;                // 1つの卓で打つ回数
    var CB = 'nenekkoBracket';

    var STAGE_QUAL = '予選';
    var STAGE_RANK = '順位決定戦';
    var STAGE_FINAL = '決勝';
    var STAGE_LAST = '最下位決定戦';

    var esc = function (s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };

    // 3桁ごとに区切る。桁が多い点数を、そのまま並べると読み取れないため。
    var fmt = function (n) {
      if (typeof n !== 'number' || !isFinite(n)) return '';
      if (n !== Math.floor(n)) return String(n);
      var s = String(Math.abs(n)), out = '';
      while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
      return (n < 0 ? '-' : '') + s + out;
    };

    // 点数を数値にする。入っていなければ null。
    // **空欄を 0 として扱ってはいけません。** 0点と「まだ入れていない」は別のことで、
    // 混ぜると対局中の卓に順位が出てしまいます。
    var parseScore = function (v) {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'number') return isFinite(v) ? v : null;
      if (typeof v === 'boolean') return null;
      var s = String(v)
        .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
        .replace(/＋/g, '+')
        .replace(/[－ー−–—]/g, '-')
        .replace(/[,，\s]/g, '');
      if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
      return Number(s);
    };

    // **CPUは順位に入れません。**（席が埋まらないときに入る相手なので）
    // 点数が入っていても、進出の計算からは外します。
    var isCpu = function (name) {
      return /^cpu$/i.test(String(name).trim());
    };

    // 卓を番号順に並べる。**シートに書いた順のままだと「卓2, 卓1, 卓3」のように出ます。**
    // 表示だけでなく、次の段へ配る順番もこれで決まるので、ここでそろえておきます。
    var byNumber = function (a, b) {
      var na = parseInt(String(a).replace(/[^0-9]/g, ''), 10);
      var nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    };

    // 1つの席。seq はシートに出てきた順で、同点のときの並びに使います。
    var makeSeat = function (name, scores, seq) {
      var total = 0, filled = 0;
      for (var i = 0; i < scores.length; i++) if (scores[i] !== null) { total += scores[i]; filled++; }
      return {
        name: name, scores: scores, seq: seq,
        cpu: isCpu(name),
        total: filled ? total : null,
        filled: filled,
        done: filled === GAMES,
        rank: null, mark: null
      };
    };

    // 合計点の高い順。同点なら、シートで上にある行を先にする。
    var compareSeats = function (a, b) {
      if (a.total !== b.total) return b.total - a.total;
      return a.seq - b.seq;
    };

    // 卓の中で順位を付ける。**全員が3戦とも入っていなければ、何もしません。**
    var rankTable = function (table) {
      var players = table.seats.filter(function (s) { return !s.cpu; });
      if (!players.length) return { done: false, players: [] };
      var done = players.every(function (s) { return s.done; });
      if (!done) return { done: false, players: players };

      players.sort(compareSeats);
      players.forEach(function (s, i) { s.rank = i + 1; });
      table.done = true;
      return { done: true, players: players };
    };

    // 1つの段をまとめて見る。GAS版（tools/bracket.gs の summarize）と同じ振り分けです。
    var summarize = function (stage) {
      var order = stage.order.slice().sort(byNumber);
      var pending = [], tops = [], bottoms = [], middles = [], players = [];

      order.forEach(function (vc, t) {
        var res = rankTable(stage.tables[vc]);
        if (!res.done) { pending.push(vc); return; }
        res.players.forEach(function (seat, p) {
          seat.tableIndex = t;
          players.push(seat);
          // **1人しかいない卓では、1位が最下位を兼ねます。**決勝を優先します。
          if (p === 0) tops.push(seat);
          else if (p === res.players.length - 1) bottoms.push(seat);
          else middles.push(seat);
        });
      });

      // 順位の昇順 → 卓番号順。**予選の卓順のまま配ると「2位だけの卓」と
      // 「3位だけの卓」に分かれ、素点で比べるこの方式では不公平になります。**
      middles.sort(function (a, b) {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.tableIndex - b.tableIndex;
      });

      return {
        pending: pending, tableCount: order.length, order: order,
        tops: tops, bottoms: bottoms, middles: middles, players: players
      };
    };

    // 人を卓へ順ぐりに配る（tools/bracket.gs の spread と同じ配りかた）
    var spread = function (people) {
      var n = Math.max(1, Math.ceil(people.length / SEAT));
      var tables = [];
      for (var i = 0; i < n; i++) tables.push({ vc: '卓' + (i + 1), seats: [], done: false });
      people.forEach(function (p, i) {
        tables[i % n].seats.push(makeSeat(p.name, [null, null, null], i));
      });
      return tables;
    };

    // 名前だけの卓を作る（決勝・最下位決定戦は必ず1卓）
    var makeTable = function (vc, people) {
      var seats = people.map(function (p, i) { return makeSeat(p.name, [null, null, null], i); });
      return { vc: vc, seats: seats, done: false };
    };

    /* 段をそろえて、画面に出す形にする。
       シートに書かれている段はそのまま、まだ無い段は前の段から組み立てて
       「（予定）」として見せます。 */
    var plan = function (sheetStages) {
      var stages = [];
      var qualStage = sheetStages[STAGE_QUAL];

      // 「予選」の行が無いときは、書かれている段をそのまま出します。
      // **黙って「当日をお楽しみに」に戻ると、入力が反映されていないのか
      // 読めていないのか分からなくなるためです。**
      if (!qualStage) {
        var asIs = [];
        Object.keys(sheetStages).forEach(function (key) {
          var st = sheetStages[key];
          var sum = summarize(st);
          asIs.push({ label: key, preview: false, tables: orderedTables(st, sum.order) });
        });
        return asIs;
      }

      var qual = summarize(qualStage);
      stages.push({ label: STAGE_QUAL, preview: false, tables: orderedTables(qualStage, qual.order) });
      qual.tops.forEach(function (s) { s.mark = 'up'; });
      qual.bottoms.forEach(function (s) { s.mark = 'down'; });

      // ── 順位決定戦 ──────────────────────────────
      var rankTables = null, rankPreview = false, rank = null;
      if (sheetStages[STAGE_RANK]) {
        rank = summarize(sheetStages[STAGE_RANK]);
        rankTables = orderedTables(sheetStages[STAGE_RANK], rank.order);
      } else if (!qual.pending.length && qual.middles.length) {
        rankTables = spread(qual.middles);
        rankPreview = true;
      }
      var rankStage = null;
      if (rankTables) {
        rankStage = { label: STAGE_RANK, preview: rankPreview, tables: rankTables };
        stages.push(rankStage);
      }

      // 通し順位（卓をまたいで、合計点そのもので比べる）
      var overall = rank && !rank.pending.length ? rank.players.slice().sort(compareSeats) : null;
      // **中間の人が少ないと「上へK人・下へK人」が取れません。**（7人以下で起きます）
      // そのときは K を減らし、決勝と最下位決定戦の空席はCPUに任せます。
      var K = overall
        ? Math.min(Math.max(0, SEAT - qual.tableCount), Math.floor(overall.length / 2))
        : Math.max(0, SEAT - qual.tableCount);
      if (overall) {
        for (var u = 0; u < K; u++) overall[u].mark = 'up';
        for (var d = 0; d < K; d++) overall[overall.length - K + d].mark = 'down';
      }

      // **K が 0 のときは、この段から上下へ抜ける人がいません。**
      // （予選が4卓だと、決勝の4席が予選1位だけで埋まるためです）
      // 印が1つも付かないと壊れて見えるので、何のための段なのかを書きます。
      if (rankStage && !K && !rankStage.preview) {
        rankStage.note = '（ここで順位が決まります）';
      }

      // ── 決勝と最下位決定戦（横に並べて1段にする） ─────────
      var finalTables = [], preview = false;
      if (sheetStages[STAGE_FINAL] || sheetStages[STAGE_LAST]) {
        [[STAGE_FINAL, 'gold'], [STAGE_LAST, '']].forEach(function (pair) {
          var st = sheetStages[pair[0]];
          if (!st) return;
          var sum = summarize(st);
          orderedTables(st, sum.order).forEach(function (t) {
            t.title = pair[0];
            t.gold = pair[1] === 'gold';
            finalTables.push(t);
          });
          // **優勝が出るのは決勝だけ。** 最下位決定戦の1位に王冠は付けません。
          if (pair[0] === STAGE_FINAL) sum.tops.forEach(function (s) { s.mark = 'champ'; });
        });
      } else if (overall && !qual.pending.length) {
        var toFinal = qual.tops.concat(overall.slice(0, K));
        var toLast = qual.bottoms.concat(K ? overall.slice(overall.length - K) : []);
        var ft = makeTable(STAGE_FINAL, toFinal); ft.title = STAGE_FINAL; ft.gold = true;
        var lt = makeTable(STAGE_LAST, toLast); lt.title = STAGE_LAST; lt.gold = false;
        finalTables = [ft, lt];
        preview = true;
      }
      if (finalTables.length) {
        stages.push({ label: STAGE_FINAL + '・' + STAGE_LAST, preview: preview, tables: finalTables, isFinal: true });
      }
      return stages;
    };

    // 卓を番号順に並べ替えて返す。確定した卓は順位順、まだの卓はシートの順のまま。
    var orderedTables = function (stage, order) {
      return order.map(function (vc) {
        var t = stage.tables[vc];
        if (!t.title) t.title = vc;
        return t;
      });
    };

    var render = function (stages) {
      // **新しい段を上に出します**（決勝 → 順位決定戦 → 予選）。
      // 当日いちばん見たいのは最新の組み合わせなので、下までたどらせないため。
      var html = '<div class="rounds">';
      stages.slice().reverse().forEach(function (stage) {
        html += '<div class="round' + (stage.isFinal ? ' round--final' : '') + '">';
        html += '<h3 class="round__label">' + esc(stage.label);
        if (stage.preview) html += '<span class="round__note">（予定）</span>';
        else if (stage.note) html += '<span class="round__note">' + esc(stage.note) + '</span>';
        html += '</h3><div class="round__tables">';

        stage.tables.forEach(function (t) {
          html += '<div class="tablecard' + (t.gold ? ' tablecard--gold' : '') + '">';
          html += '<h4 class="tablecard__name">' + esc(t.title || t.vc);
          if (!t.done && hasScore(t)) html += '<span class="tablecard__state">対局中</span>';
          html += '</h4><ul class="tablecard__seats">';

          // 確定した卓は順位順に並べる（並び順そのものが順位になります）
          var seats = t.seats.slice();
          if (t.done) seats.sort(function (a, b) {
            if (a.cpu !== b.cpu) return a.cpu ? 1 : -1;
            return a.cpu ? 0 : a.rank - b.rank;
          });

          seats.forEach(function (s) {
            var cls = s.cpu ? 'is-cpu'
              : s.mark === 'champ' ? 'is-winner is-champion'
              : s.mark === 'up' ? 'is-winner'
              : s.mark === 'down' ? 'is-drop' : '';
            html += '<li' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(s.name);
            // 優勝の席には点数を出しません。**卓の幅は240pxしかなく、
            // 王冠と「優勝」の札で横が詰まっているためです。**
            if (s.mark !== 'champ' && s.total !== null) {
              html += '<span class="seat__note">' + fmt(s.total) + '</span>';
            }
            html += '</li>';
          });

          // 4人に満たない卓は、そのまま始めると空席にCPUが入る
          for (var k = seats.length; k < SEAT; k++) html += '<li class="is-cpu">CPU</li>';
          html += '</ul></div>';
        });
        html += '</div></div>';
      });
      bracket.innerHTML = html + '</div>';
    };

    // 1つでも点数が入っていれば「対局中」。まだ何も入っていない卓には出しません。
    var hasScore = function (t) {
      return t.seats.some(function (s) { return s.filled > 0; });
    };

    // 見出しから列の位置を探す。メモ列を足したり並べ替えたりしても動くようにするため。
    // 見出しで見つからない列は、左から 回戦 / 卓 / 参加者 / 1戦目 / 2戦目 / 3戦目 の順とみなします。
    var pickColumns = function (cols) {
      var idx = { round: -1, table: -1, name: -1, scores: [-1, -1, -1] };
      (cols || []).forEach(function (c, i) {
        var label = String((c && (c.label || '')) || '').trim();
        if (!label) return;
        if (idx.round < 0 && /回戦|ラウンド|段/.test(label)) { idx.round = i; return; }
        if (idx.table < 0 && /卓|テーブル|部屋/.test(label)) { idx.table = i; return; }
        if (idx.name < 0 && /参加者|名前|プレイヤー|ユーザー/.test(label)) { idx.name = i; return; }
        var m = label.match(/([1-3１-３])\s*(戦|試合|回|局)/);
        if (m) {
          var zen = '１２３'.indexOf(m[1]);
          idx.scores[(zen >= 0 ? zen + 1 : Number(m[1])) - 1] = i;
          return;
        }
        if (/点|score/i.test(label)) {
          for (var s = 0; s < GAMES; s++) if (idx.scores[s] < 0) { idx.scores[s] = i; break; }
        }
      });
      if (idx.round < 0) idx.round = 0;
      if (idx.table < 0) idx.table = 1;
      if (idx.name < 0) idx.name = 2;
      for (var k = 0; k < GAMES; k++) if (idx.scores[k] < 0) idx.scores[k] = 3 + k;
      return idx;
    };

    var build = function (rows, idx) {
      // 「段 → 卓 → 参加者」の順にまとめる。シートの並び順をそのまま活かす
      var stages = {}, seq = 0;
      rows.forEach(function (r) {
        var stage = (r[idx.round] || '').trim(),
            vc = (r[idx.table] || '').trim(),
            name = (r[idx.name] || '').trim();
        if (!stage || !vc || !name) return;

        var scores = [];
        for (var g = 0; g < GAMES; g++) scores.push(parseScore(r[idx.scores[g]]));

        if (!stages[stage]) stages[stage] = { label: stage, order: [], tables: {} };
        var S = stages[stage];
        if (!S.tables[vc]) { S.tables[vc] = { vc: vc, seats: [], done: false }; S.order.push(vc); }
        S.tables[vc].seats.push(makeSeat(name, scores, seq++));
      });
      return stages;
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
        var stages = plan(build(rows, idx));
        if (stages && stages.length) { render(stages); syncCelebration(); }
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
