#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
キービジュアルの絵（assets/img/kv-art.webp）を原本から書き出す。

原本は tools/src-img/ねね壁紙.png。壁紙ビューアで開いた画面を保存したものなので、
そのままでは次の2つが写り込んでいる:

  - 上端に、CPU/GPU の使用率を出すモニタの帯
  - 左右に、画面を埋めるためのぼかした帯

どちらも絵の一部ではないので、くっきりしている範囲だけを切り出す。
切り出す位置は固定値ではなく、隣り合う画素の差（＝細かさ）から毎回求めるので、
原本を撮り直しても同じ手順で通る。

使いかた:
  python tools/build_kv_art.py
  python tools/build_kv_art.py --width 1800 --quality 86
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
SRC = PROJECT / "tools" / "src-img" / "ねね壁紙.png"
OUT = PROJECT / "assets" / "img" / "kv-art.webp"

# モニタの帯は上端だけに出るので、この高さまでを候補として捨てる
TOP_BAR_MAX = 40


def sharp_columns(arr, ratio=0.18):
    """横方向の細かさが閾値を超える列の範囲を返す。ぼかした帯はここから外れる。"""
    fineness = np.abs(np.diff(arr, axis=1)).mean(axis=(0, 2))
    hit = np.where(fineness > fineness.max() * ratio)[0]
    if hit.size == 0:
        raise SystemExit("くっきりした範囲が見つかりませんでした。原本を確認してください。")
    return int(hit.min()), int(hit.max()) + 1


def top_bar_height(arr):
    """上端のモニタ帯の高さを求める。帯は下の絵と色がはっきり切り替わる。"""
    rows = np.abs(np.diff(arr[:TOP_BAR_MAX + 4], axis=0)).mean(axis=(1, 2))
    # いちばん段差の大きい行を境目とみなす。段差が小さければ帯なしと判断する。
    edge = int(rows.argmax())
    return edge + 1 if rows[edge] > rows.mean() * 2.5 else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=1800, help="書き出す横幅")
    ap.add_argument("--quality", type=int, default=86, help="WebP の品質")
    args = ap.parse_args()

    if not SRC.exists():
        print(f"原本が見つかりません: {SRC}", file=sys.stderr)
        sys.exit(1)

    im = Image.open(SRC).convert("RGB")
    arr = np.asarray(im).astype(np.int16)

    left, right = sharp_columns(arr)
    top = top_bar_height(arr)
    im = im.crop((left, top, right, im.height))
    print(f"切り出し: 左{left} 上{top} 右{right} → {im.size}")

    height = round(im.height * args.width / im.width)
    im = im.resize((args.width, height), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT, "WEBP", quality=args.quality, method=6)

    kb = round(OUT.stat().st_size / 1024)
    print(f"書き出し: {OUT.relative_to(PROJECT)}  {im.size[0]}x{im.size[1]}  {kb}KB")


if __name__ == "__main__":
    main()
