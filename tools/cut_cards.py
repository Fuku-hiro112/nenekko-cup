"""RULE「役の作りかた」に並ぶ札を、プレイ画面のスクショから切り出す。

原本は `tools/src-img/`（Gitに乗りません）。**原本が手元にある人だけ動かせます。**
出力はそのまま `assets/img/` に入ります。

    python tools/cut_cards.py            # assets/img/ へ書き出す
    python tools/cut_cards.py <出力先>    # 確認用に別の場所へ出す（_sheet.png も作られます）

切り出す場所と選んだ理由:

| 出力 | 原本 | 何を切っているか |
|---|---|---|
| `board-cards`  | 今回登場するグループ.webp | 画面まるごと（縮小のみ） |
| `yaku-same`    | ポカジャン出来る場合.webp | 手札の中の、同じ絵柄の ID Gen1 が3枚 |
| `yaku-group`   | ホロドリ盤面 (1).png      | 役一覧「5」の行にいる4名（グループ全員の例） |
| `yaku-wait`    | ホロドリ盤面 (2)_masked.png | 手札の右端、そろっている ID Gen1 の2枚 |

座標は原本のピクセルです。**原本を撮り直したら座標も取り直してください。**
手札は隙間なく並ぶので、左右を2pxずつ内側に寄せて隣の縁を拾わないようにしています。
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src-img")
DEFAULT_OUT = os.path.join(os.path.dirname(HERE), "assets", "img")

H = 130          # 札を書き出す高さ。表示は76pxなので約1.7倍
SHOT_W = 900     # スクショの書き出し幅

JOBS = [
    # (出力名, 原本, [(left, top, right, bottom), ...])
    ("yaku-same", "ポカジャン出来る場合.webp", [
        (332, 398, 400, 500),
        (404, 398, 473, 500),
        (774, 398, 845, 500),
    ]),
    ("yaku-group", "ホロドリ盤面 (1).png", [
        (35, 546, 185, 745),
        (189, 546, 339, 745),
        (343, 546, 494, 745),
        (497, 546, 648, 745),
    ]),
    ("yaku-wait", "ホロドリ盤面 (2)_masked.png", [
        (1860, 1095, 2058, 1381),
        (2063, 1095, 2261, 1381),
    ]),
    # ねねち賞用。手札6枚目の、青い桃鈴ねね1枚だけを切る。
    # 3枚そろった実物の画面は無いので、ページ側でこの1枚を3回並べて「同色3枚」を表す。
    ("yaku-nene", "ねねち賞用.webp", [
        (570, 366, 632, 459),
    ]),
]


def build_board_cards(out):
    """RULE の2枚目のスクショ。グループ一覧とBONUSが写ったもの。"""
    im = Image.open(os.path.join(SRC, "今回登場するグループ.webp")).convert("RGB")
    im = im.resize((SHOT_W, round(im.height * SHOT_W / im.width)), Image.LANCZOS)
    path = os.path.join(out, "board-cards.webp")
    im.save(path, "WEBP", quality=82, method=6)
    print(f"{'board-cards.webp':20s} -> {im.size}  {os.path.getsize(path) / 1024:.1f}KB")


def build_sheet(parts, out):
    """目視用のコンタクトシート。役ごとに1行で並べる。"""
    rows, cur, last = [], [], None
    for stem, img in parts:
        if stem != last and cur:
            rows.append(cur)
            cur = []
        cur.append(img)
        last = stem
    rows.append(cur)

    gap = 12
    w = max(sum(i.width for i in r) + gap * (len(r) - 1) for r in rows)
    h = len(rows) * H + gap * (len(rows) - 1)
    sheet = Image.new("RGB", (w, h), (250, 235, 242))
    y = 0
    for r in rows:
        x = 0
        for img in r:
            sheet.paste(img, (x, y))
            x += img.width + gap
        y += H + gap
    sheet.resize((w * 2, h * 2), Image.LANCZOS).save(os.path.join(out, "_sheet.png"))
    print("\nコンタクトシート: _sheet.png")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    if not os.path.isdir(SRC):
        sys.exit(f"原本のフォルダがありません: {SRC}\n（Gitには乗らないので、手元に置いてから実行してください）")

    build_board_cards(out)

    parts = []
    for stem, src, boxes in JOBS:
        im = Image.open(os.path.join(SRC, src)).convert("RGB")
        for i, box in enumerate(boxes, 1):
            crop = im.crop(box)
            crop = crop.resize((round(crop.width * H / crop.height), H), Image.LANCZOS)
            # 1枚しか切らないものは連番を付けない（他にもあると読めてしまうため）
            name = f"{stem}-{i}.webp" if len(boxes) > 1 else f"{stem}.webp"
            crop.save(os.path.join(out, name), "WEBP", quality=88, method=6)
            size = os.path.getsize(os.path.join(out, name))
            print(f"{name:20s} {box} -> {crop.size}  {size / 1024:.1f}KB")
            parts.append((stem, crop))

    # 確認用に別の場所へ出したときだけシートも作る（assets/img を汚さない）
    if out != DEFAULT_OUT:
        build_sheet(parts, out)


if __name__ == "__main__":
    main()
