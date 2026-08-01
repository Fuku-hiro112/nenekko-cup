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
})();
