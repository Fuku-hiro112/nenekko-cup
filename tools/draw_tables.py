"""参加者リストから1回戦の卓分けを抽選し、トーナメントの段数を試算する。

サイトに書いてある大会ルールを、そのままコードにしたものです。

  - 4人卓の勝ち上がりトーナメント
  - 卓分けは運営が事前に抽選で決める
  - **ポカジャン未解放の人だけで1卓が埋まらないようにする**
    （FLOW 02 のとおり、ルームを作るのは解放している人なので、各卓に最低1人必要）
  - 4人に満たない卓は、そのまま開始して空席にCPUが入る

使いかた:

    python tools/draw_tables.py 参加者.csv                 # 抽選して表示
    python tools/draw_tables.py 参加者.csv --advance 2     # 各卓から2名が勝ち抜け（既定）
    python tools/draw_tables.py 参加者.csv --seed 20260814 # 同じ結果を出し直す
    python tools/draw_tables.py 参加者.csv --md            # Discordに貼れる形で出す

参加者.csv の書きかた（1行目は見出し。**列の順番だけ合っていれば見出しの文字は自由**）:

    名前,解放
    ふろん,解放
    てるてる,未解放
    花園美咲,○
    しゃるろって,

  2列目が空欄・「未」「未解放」「x」「×」「no」「false」のいずれかなら**未解放**、
  それ以外（「解放」「○」「o」「yes」など）は**解放済み**として扱います。

**抽選結果は毎回変わります。** 確定させたいときは表示された seed を控えて
`--seed` で渡し直してください。同じ並びが再現できます。
"""
import argparse
import csv
import math
import random
import sys

SEAT = 4                       # 1卓の人数

# 2列目がこれらのいずれか（前後の空白は無視・大文字小文字は問わない）なら未解放とみなす
UNLOCKED_NG = {"", "未", "未解放", "x", "×", "no", "false", "0", "-"}


def load_players(path):
    """CSVを読んで [(名前, 解放済みか), ...] にする。"""
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for i, row in enumerate(csv.reader(f)):
            if not row or not row[0].strip():
                continue
            if i == 0:                                  # 見出し行は読み飛ばす
                continue
            name = row[0].strip()
            flag = row[1].strip() if len(row) > 1 else ""
            rows.append((name, flag.lower() not in UNLOCKED_NG))
    if not rows:
        sys.exit(f"参加者が1人も読み取れませんでした: {path}\n"
                 f"1行目は見出しとして読み飛ばします。2行目以降に「名前,解放」を書いてください。")

    names = [n for n, _ in rows]
    dup = {n for n in names if names.count(n) > 1}
    if dup:
        sys.exit(f"同じ名前が複数あります: {'、'.join(sorted(dup))}\n"
                 f"当日の呼び分けができないので、区別できる名前にしてください。")
    return rows


def draw(players, rng):
    """卓分けする。各卓に解放者が最低1人入るように配ってから、残りを埋める。

    戻り値は卓ごとの [(名前, 解放済みか), ...] のリスト。
    """
    unlocked = [p for p in players if p[1]]
    locked = [p for p in players if not p[1]]
    tables_n = max(1, math.ceil(len(players) / SEAT))

    if len(unlocked) < tables_n:
        sys.exit(
            f"解放している人が足りません。{tables_n}卓に対して解放者は{len(unlocked)}人です。\n"
            f"各卓にルームを作れる人が1人ずつ要るので、"
            f"卓を減らす（＝1卓あたりの人数を増やす）か、解放者を増やしてください。"
        )

    rng.shuffle(unlocked)
    rng.shuffle(locked)

    # 1. まず各卓に解放者を1人ずつ置く（ルームを作る人）
    tables = [[unlocked[i]] for i in range(tables_n)]

    # 2. 残り全員を混ぜて、席が空いている卓へ順に配る
    rest = unlocked[tables_n:] + locked
    rng.shuffle(rest)
    for p in rest:
        tables.sort(key=len)                            # 少ない卓から埋める
        tables[0].append(p)

    # 表示の順番が毎回変わると読みにくいので、卓の並びは人数の多い順で固定する
    tables.sort(key=lambda t: (-len(t), t[0][0]))
    return tables


def plan_rounds(players_n, advance):
    """段数を試算する。[(段の名前, 人数, 卓数, 空席数), ...] を返す。

    空席にはCPUが入ります。**決勝が4人に満たないと、決勝までCPU入りになります。**
    人数と勝ち抜け数の組み合わせ次第で起きるので、呼び出し側で注意を出しています。
    """
    rounds, n, i = [], players_n, 1
    while True:
        tables_n = max(1, math.ceil(n / SEAT))
        label = "決勝" if tables_n == 1 else f"{i}回戦"
        rounds.append((label, n, tables_n, tables_n * SEAT - n))
        if tables_n == 1:
            break
        nxt = tables_n * advance                        # 各卓から advance 名が次へ
        if nxt >= n:                                    # 減らないなら止める（設定ミス）
            sys.exit(f"--advance {advance} だと人数が減りません（{n}人 → {nxt}人）。"
                     f"もっと小さい値にしてください。")
        n = nxt
        i += 1
    return rounds


def warn_rounds(rounds, advance):
    """試算の結果、運営が気にしたほうがよい点を挙げる。"""
    notes = []
    final = rounds[-1]
    if final[1] < SEAT:
        notes.append(
            f"決勝が{final[1]}人しかいません（{final[3]}席がCPU）。"
            f"--advance を変えるか、参加人数の区切りを調整すると{SEAT}人にできます。"
        )
    for label, n, tables_n, empty in rounds[:-1]:
        if empty >= tables_n * 2:                       # 平均で半分以上が空席
            notes.append(f"{label}は{n}人で{tables_n}卓のため、{empty}席がCPUになります。")
    return notes


def main():
    ap = argparse.ArgumentParser(description="ねっ子ポカジャン大会の卓分け抽選")
    ap.add_argument("csv", help="参加者のCSV（名前,解放）")
    ap.add_argument("--advance", type=int, default=2, help="各卓から次に進む人数（既定: 2）")
    ap.add_argument("--seed", type=int, help="同じ抽選結果を再現したいときに指定")
    ap.add_argument("--md", action="store_true", help="Discordに貼れる形で出す")
    args = ap.parse_args()

    if not 1 <= args.advance < SEAT:
        sys.exit(f"--advance は 1〜{SEAT - 1} の範囲で指定してください。")

    players = load_players(args.csv)
    seed = args.seed if args.seed is not None else random.randrange(10 ** 8)
    tables = draw(players, random.Random(seed))
    rounds = plan_rounds(len(players), args.advance)

    n_unlocked = sum(1 for _, u in players if u)
    mark = (lambda u: "" if u else "（未解放）") if not args.md else (lambda u: "" if u else " ※未解放")

    if args.md:
        print(f"**1回戦の卓分け**（参加 {len(players)}人／抽選 seed `{seed}`）\n")
        for i, t in enumerate(tables):
            cpu = SEAT - len(t)
            note = f"　※空席{cpu}はCPU" if cpu else ""
            print(f"__{chr(65 + i)}卓__{note}")
            for name, u in t:
                print(f"- {name}{mark(u)}")
            print()
        print("**進行**")
        for label, n, tn, empty in rounds:
            cpu = f"（うち{empty}席CPU）" if empty else ""
            print(f"- {label}：{n}人 / {tn}卓{cpu}")
        return

    print(f"参加者 {len(players)}人（解放 {n_unlocked} / 未解放 {len(players) - n_unlocked}）")
    print(f"抽選 seed: {seed}   ← 同じ結果を出すには --seed {seed}")
    print()
    for i, t in enumerate(tables):
        cpu = SEAT - len(t)
        note = f"  ← 空席{cpu}にCPUが入ります" if cpu else ""
        print(f"[{chr(65 + i)}卓]{note}")
        for j, (name, u) in enumerate(t):
            room = "  ルーム作成" if j == 0 else ""
            print(f"   {name}{mark(u)}{room}")
    print()
    print(f"進行（各卓から上位{args.advance}名が勝ち上がり）")
    for label, n, tn, empty in rounds:
        cpu = f"  空席{empty}はCPU" if empty else ""
        print(f"   {label}: {n}人 / {tn}卓{cpu}")

    notes = warn_rounds(rounds, args.advance)
    if notes:
        print()
        print("気になる点")
        for note in notes:
            print(f"   - {note}")


if __name__ == "__main__":
    main()
