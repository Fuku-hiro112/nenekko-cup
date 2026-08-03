#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
サイトで使う画像を Stable Diffusion WebUI Forge で生成する。

前提:
  Forge を start_forge_api.bat から起動しておくこと（--api が必要）。

使い方:
  python tools/generate_nene.py --preset hero --count 4   # 候補を4枚出す
  python tools/generate_nene.py --preset about            # 1枚生成して採用
  python tools/generate_nene.py --preset hero --seed 4142397257
  python tools/generate_nene.py --preset ogp              # OGP画像を合成
  python tools/generate_nene.py --list                    # プリセット一覧

候補は tools/candidates/ に出る。--count 1 のときだけ直接 assets/img/ に保存する。

キャラクターのプロンプトは Forge の変数マネージャの定義をそのまま使っている。
  $桃鈴ねね → momosuzu_nene, hololive, 1girl, orange_hair, orange_eyes
"""

import argparse
import base64
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:7860"
PROJECT = Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT / "assets" / "img"
CANDIDATE_DIR = PROJECT / "tools" / "candidates"

# $桃鈴ねね（変数マネージャの定義）
NENE = "momosuzu_nene, hololive, 1girl, orange_hair, orange_eyes"

QUALITY = (
    "masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, "
    "illustration, official art, key visual"
)
PLAIN_BG = "simple background, white background"

# 透かし・署名の除去は強めに指定する。
# このモデルは「© COVER Corp」風の偽の著作権表記を描くことがあり、
# それを載せると公式と誤解されうるため、絶対に混入させない。
NEGATIVE = (
    "(watermark:1.5), (signature:1.5), (artist name:1.5), (copyright notice:1.5), "
    "(text:1.4), (english text:1.4), (logo:1.4), username, dated, web address, "
    "lowres, worst quality, low quality, bad anatomy, bad hands, "
    "missing fingers, extra digit, fewer digits, extra fingers, fused fingers, "
    "error, cropped, jpeg artifacts, multiple views, multiple girls, "
    "nsfw, cleavage, revealing clothes"
)

# ---------------------------------------------------------------------------
#  プリセット
#    subject : キャラクター指定
#    pose    : 構図・ポーズ・表情
#    size    : 生成解像度
#    width   : 保存時の横幅（表示サイズの約2倍にする）
#    out     : 保存先ファイル名
# ---------------------------------------------------------------------------
PRESETS = {
    "hero": {
        "subject": NENE,
        "pose": (
            "holding fanned playing cards, showing cards to viewer, "
            "idol costume, frilled dress, wink, open mouth, cheerful smile, "
            "energetic pose, standing, cowboy shot, looking at viewer"
        ),
        "size": (832, 1216), "width": 740, "out": "nene.webp",
        "note": "ヒーロー右下。カードを見せているポーズ",
    },
    "about": {
        "subject": NENE,
        "pose": (
            "idol costume, frilled dress, gentle smile, one hand raised in explanation, "
            "upper body, bust shot, looking at viewer, head tilt"
        ),
        "size": (896, 1152), "width": 560, "out": "nene-about.webp",
        "note": "ABOUT 左カラム下。説明しているバストアップ",
    },
    "entry": {
        "subject": NENE,
        "pose": (
            "idol costume, frilled dress, beckoning, waving hand, big smile, "
            "open mouth, pointing at viewer, upper body, looking at viewer"
        ),
        "size": (896, 1152), "width": 480, "out": "nene-entry.webp",
        "note": "ENTRY の CTA 横。招いているポーズ",
    },
    "splash": {
        "subject": NENE,
        "pose": (
            "idol costume, frilled dress, closed eyes, happy smile, "
            "hands clasped together, portrait, face focus, looking at viewer"
        ),
        "size": (1024, 1024), "width": 400, "out": "nene-splash.webp",
        "note": "ローディング画面。顔まわりのアップ",
    },
    "nekko": {
        # ねねのファンマスコット。モデルがこのタグを知っているかは要検証。
        "subject": "nekko_(momosuzu_nene), hololive, mascot, chibi, no humans",
        "pose": "full body, standing, facing viewer, cute, simple shape",
        "size": (1024, 1024), "width": 320, "out": "nekko.webp",
        "note": "ねっこマスコット（タグが通るか要検証）",
    },
    "chibi": {
        # nekko タグが通らなかったときの代替
        "subject": NENE,
        "pose": (
            "chibi, chibi only, super deformed, 2heads, full body, standing, "
            "idol costume, big smile, holding playing card, facing viewer"
        ),
        "size": (1024, 1024), "width": 320, "out": "chibi.webp",
        "note": "二頭身のねね（nekko の代替）",
    },
}


# ---------------------------------------------------------------------------
#  API
# ---------------------------------------------------------------------------
def post(path, payload, timeout=1200):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def check_api():
    try:
        with urllib.request.urlopen(API + "/sdapi/v1/sd-models", timeout=10) as res:
            return [m["model_name"] for m in json.loads(res.read().decode("utf-8"))]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(
                "Forge は起動していますが API が無効です。\n"
                "stable-diffusion-webui-forge\\start_forge_api.bat から起動し直してください。",
                file=sys.stderr,
            )
        else:
            print(f"API エラー: HTTP {e.code}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Forge に接続できません（{API}）: {e}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
#  後処理
# ---------------------------------------------------------------------------
def label_components(mask):
    """真偽マスクの連結成分にラベルを振る。戻り値は (ラベル配列, 面積リスト)。"""
    import numpy as np

    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    sizes = [0]
    current = 0

    for sy in range(h):
        row = mask[sy]
        for sx in range(w):
            if not row[sx] or labels[sy, sx]:
                continue
            current += 1
            count = 0
            stack = [(sy, sx)]
            while stack:
                y, x = stack.pop()
                if labels[y, x] or not mask[y, x]:
                    continue
                labels[y, x] = current
                count += 1
                if y > 0:     stack.append((y - 1, x))
                if y < h - 1: stack.append((y + 1, x))
                if x > 0:     stack.append((y, x - 1))
                if x < w - 1: stack.append((y, x + 1))
            sizes.append(count)

    return labels, sizes


def cutout_white(img, tolerance=18, enclosed_min=0.002):
    """白背景を透過にする。

    1) 外周から連結している白を消す（衣装や目のハイライトの白は残る）
    2) 髪や腕で囲まれてできた「閉じた白い背景」も消す。
       衣装の白と誤爆しないよう、ほぼ純白だけを対象にする。
    """
    import numpy as np
    from PIL import Image

    img = img.convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]

    white = (arr[:, :, :3] >= 255 - tolerance).all(axis=2)

    # 四隅（外周）から白い領域を辿る
    reachable = np.zeros((h, w), dtype=bool)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x]:
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x]:
                stack.append((y, x))

    while stack:
        y, x = stack.pop()
        if reachable[y, x] or not white[y, x]:
            continue
        reachable[y, x] = True
        if y > 0:     stack.append((y - 1, x))
        if y < h - 1: stack.append((y + 1, x))
        if x > 0:     stack.append((y, x - 1))
        if x < w - 1: stack.append((y, x + 1))

    arr[:, :, 3] = np.where(reachable, 0, arr[:, :, 3])

    # 2) 囲まれてできた純白の抜けを消す
    pure = (arr[:, :, :3] >= 252).all(axis=2) & ~reachable
    if pure.any():
        labels, sizes = label_components(pure)
        floor = h * w * enclosed_min
        doomed = [i for i, n in enumerate(sizes) if i > 0 and n >= floor]
        if doomed:
            arr[:, :, 3] = np.where(np.isin(labels, doomed), 0, arr[:, :, 3])

    return Image.fromarray(arr, "RGBA")


def drop_specks(img, keep_ratio=0.04):
    """本体から離れた小さな不透明の塊を消す。

    透かしや署名は切り抜き後に「孤立した小さな島」として残るため、
    最大の塊に対して極端に小さいものを落とす。戻り値は (画像, 落とした数)。
    """
    import numpy as np
    from PIL import Image

    arr = np.array(img)
    solid = arr[:, :, 3] > 40
    h, w = solid.shape

    labels = np.zeros((h, w), dtype=np.int32)
    sizes = [0]
    current = 0

    for sy in range(h):
        for sx in range(w):
            if not solid[sy, sx] or labels[sy, sx]:
                continue
            current += 1
            count = 0
            stack = [(sy, sx)]
            while stack:
                y, x = stack.pop()
                if labels[y, x] or not solid[y, x]:
                    continue
                labels[y, x] = current
                count += 1
                if y > 0:     stack.append((y - 1, x))
                if y < h - 1: stack.append((y + 1, x))
                if x > 0:     stack.append((y, x - 1))
                if x < w - 1: stack.append((y, x + 1))
            sizes.append(count)

    if current <= 1:
        return img, 0

    biggest = max(sizes)
    doomed = [i for i, n in enumerate(sizes) if i > 0 and n < biggest * keep_ratio]
    if not doomed:
        return img, 0

    mask = np.isin(labels, doomed)
    arr[:, :, 3] = np.where(mask, 0, arr[:, :, 3])
    return Image.fromarray(arr, "RGBA"), len(doomed)


def trim_transparent(img, padding=6):
    """透明な余白を切り落として、キャラクターが画面いっぱいに入るようにする。"""
    box = img.getchannel("A").getbbox()
    if not box:
        return img
    left, top, right, bottom = box
    return img.crop((
        max(0, left - padding),
        max(0, top - padding),
        min(img.width, right + padding),
        min(img.height, bottom + padding),
    ))


def fit_width(img, width):
    """表示サイズに合わせて縮小する。拡大はしない。"""
    if img.width <= width:
        return img
    height = round(img.height * width / img.width)
    from PIL import Image
    return img.resize((width, height), Image.LANCZOS)


def finish(img, width):
    img = cutout_white(img)
    img, dropped = drop_specks(img)
    img = trim_transparent(img)
    img = fit_width(img, width)
    return img, dropped


def save_image(img, path):
    """透過つき WebP で保存する。

    同じ絵柄でも PNG の 1/6 程度に収まる。Discord から開くページなので、
    見た目より先に読み込みの軽さを優先する。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".webp":
        img.save(path, "WEBP", quality=85, method=6)
    else:
        img.save(path, optimize=True)
    return path


# ---------------------------------------------------------------------------
#  OGP 画像の合成
# ---------------------------------------------------------------------------
def build_ogp():
    """1200x630 のリンクプレビュー画像を組み立てる。

    キャラクターは assets/img/nene.png を流用する（無ければ文字だけで作る）。
    """
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1200, 630
    canvas = Image.new("RGB", (W, H), "#FFF7F3")
    draw = ImageDraw.Draw(canvas)

    # 桃 → クリーム → 金 の横グラデーション
    top, bottom = (255, 233, 241), (255, 243, 232)
    for y in range(H):
        t = y / H
        draw.line([(0, y), (W, y)], fill=(
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
        ))

    # 上下の金の帯
    draw.rectangle([0, 0, W, 10], fill="#F7C13F")
    draw.rectangle([0, H - 10, W, H], fill="#F7C13F")

    def font(size, bold=True):
        for name in ("YuGothB.ttc" if bold else "YuGothR.ttc", "meiryob.ttc", "meiryo.ttc", "msgothic.ttc"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default(size)

    # ▼ 文字はここに直書きされています（このスクリプトは sd-images.json を読みません）。
    #    **OGP を作り直すときは、こちらではなく共有版を使ってください。**
    #
    #        python ../.claude/skills/illust-forge/scripts/sd_generate.py --preset ogp
    #
    #    共有版は sd-images.json の ogp.lines を読むので、設定と画像がずれません。
    #    ここを使うと、設定を直したのに画像だけ古いままになります（実際に踏みました）。
    #    保険として、下の内容は sd-images.json と同じにそろえてあります。
    draw.text((72, 150), "ねっこ集会所 presents", font=font(30), fill="#A82355")
    draw.text((72, 205), "ねっ子", font=font(52), fill="#3A2430")
    draw.text((72, 275), "ポカジャン大会", font=font(84), fill="#D22C6B")
    draw.text((72, 400), "2026.08.30 SUN 20:00", font=font(40), fill="#3A2430")
    draw.text((72, 460), "Discord「ねっこ集会所」／ 未解放でも参加OK", font=font(28, False), fill="#6E5560")

    chara = OUT_DIR / "nene.webp"
    if chara.exists():
        art = Image.open(chara).convert("RGBA")
        scale = (H - 40) / art.height
        art = art.resize((round(art.width * scale), H - 40), Image.LANCZOS)
        canvas.paste(art, (W - art.width - 40, 40), art)
    else:
        print("  （assets/img/nene.webp が無いので文字だけで作りました）")

    # 透過は要らないので JPEG。プレビュー取得を軽くする
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / "ogp.jpg"
    canvas.save(path, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"  保存: {path.relative_to(PROJECT)}  ({path.stat().st_size // 1024} KB)")
    return path


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", default="hero", help="プリセット名（--list で一覧）")
    ap.add_argument("--seed", type=int, default=-1)
    ap.add_argument("--count", type=int, default=1, help="候補の枚数")
    ap.add_argument("--no-cutout", action="store_true", help="白背景を残す")
    ap.add_argument("--list", action="store_true", help="プリセット一覧を表示")
    args = ap.parse_args()

    if args.list:
        for name, p in PRESETS.items():
            print(f"  {name:8s} {p['out']:20s} {p['note']}")
        return

    if args.preset == "ogp":
        build_ogp()
        return

    if args.preset not in PRESETS:
        print(f"不明なプリセット: {args.preset}（--list で一覧）", file=sys.stderr)
        sys.exit(1)

    preset = PRESETS[args.preset]
    from PIL import Image

    check_api()

    payload = {
        "prompt": f"{preset['subject']}, {preset['pose']}, {QUALITY}, {PLAIN_BG}",
        "negative_prompt": NEGATIVE,
        "steps": 30,
        "cfg_scale": 5.0,
        "width": preset["size"][0],
        "height": preset["size"][1],
        "sampler_name": "Euler a",
        "seed": args.seed,
        "batch_size": 1,
        "n_iter": args.count,
        "override_settings": {"sd_model_checkpoint": "waiIllustriousSDXL_v170"},
        "override_settings_restore_afterwards": True,
    }

    print(f"[{args.preset}] {preset['note']}")
    print(f"生成中… {args.count}枚 / {payload['width']}x{payload['height']}")

    result = post("/sdapi/v1/txt2img", payload)
    info = json.loads(result["info"])
    seeds = info.get("all_seeds", [info.get("seed")])

    for idx, b64 in enumerate(result["images"]):
        img = Image.open(io.BytesIO(base64.b64decode(b64.split(",", 1)[-1])))
        dropped = 0
        if not args.no_cutout:
            img, dropped = finish(img, preset["width"])

        if args.count == 1:
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            path = OUT_DIR / preset["out"]
        else:
            CANDIDATE_DIR.mkdir(parents=True, exist_ok=True)
            path = CANDIDATE_DIR / f"{args.preset}_{seeds[idx]}.webp"

        save_image(img, path)
        note = f"  （孤立した塊を{dropped}個除去）" if dropped else ""
        print(f"  保存: {path.relative_to(PROJECT)}  "
              f"{img.width}x{img.height}  {path.stat().st_size // 1024}KB  seed={seeds[idx]}{note}")

    if args.count > 1:
        print("\n候補から1枚選んで assets/img/ にコピーしてください。"
              f"\n気に入ったseedがあれば --preset {args.preset} --seed <番号> で作り直せます。")
    print("\n※ 採用前に画像の四隅を目視で確認してください（偽の著作権表記が混ざることがあります）")


if __name__ == "__main__":
    main()
