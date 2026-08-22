"""対戦表を index.html に書き込む。

`draw_tables.py --save` が作った JSON を読み、`index.html` の

    <!-- BRACKET:START -->  …ここだけ書き換わる…  <!-- BRACKET:END -->

の間を組み直します。**マーカーの外は一切触りません。**

使いかた:

    python tools/update_bracket.py tournament.json          # 表を書き込む
    python tools/update_bracket.py tournament.json --dry    # 書き込まずに結果だけ見る

## ふだんはこれを使いません

当日の更新は**スプレッドシートに点数を入れるだけ**で足ります（`tools/bracket.gs`）。
ページを開くたびにシートを読みに行くので、`git` も `python` も要りません。

これを使うのは、**大会が終わったあとに最終結果をHTMLへ焼き付けたいとき**だけです。
スプレッドシートを消してもページに結果が残ります。

## 当日の流れ（焼き付けを使う場合）

1. 前日: `python tools/draw_tables.py 参加者.csv --save tournament.json`
2. 対局が終わったら **tournament.json の `scores` に3戦ぶんの点数を書く**

       {"name": "ふろん", "scores": [12300, 8400, 15100]}

3. `python tools/update_bracket.py tournament.json`
   → 次の段が自動で組まれ、表も更新されます
4. GitHub Pages で公開しているなら `git add -A && git commit -m "予選の結果" && git push`

## scores の書きかた

- **3戦ぶんすべて**入れて初めて、その卓の順位が出ます。まだなら `null` のままに
- **空欄を 0 にしないでください。** 0点と「まだ入れていない」は別のことです
- CPU は `"CPU"` という名前にします。**順位にも進出にも入りません**
"""
import argparse
import html
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from format_rules import SEAT, GAMES, QUAL, RANK, FINAL, LAST  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), "index.html")
START = "<!-- BRACKET:START -->"
END = "<!-- BRACKET:END -->"
INDENT = " " * 6


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def is_cpu(name):
    return str(name).strip().lower() == "cpu"


def total_of(seat):
    """入っている点数の合計。1つも入っていなければ None。"""
    got = [s for s in seat.get("scores") or [] if s is not None]
    return sum(got) if got else None


def is_done(seat):
    scores = seat.get("scores") or []
    return len(scores) >= GAMES and all(s is not None for s in scores[:GAMES])


def rank_table(table):
    """卓の中で順位を付ける。**全員が3戦とも入っていなければ何もしません。**

    戻り値は (確定したか, 合計点の高い順にならべた非CPUの席)。
    同点はJSONで上にある席を上位とします。
    """
    players = [s for s in table["seats"] if not is_cpu(s["name"])]
    if not players or not all(is_done(s) for s in players):
        return False, players

    order = sorted(range(len(players)), key=lambda i: (-total_of(players[i]), i))
    ranked = [players[i] for i in order]
    for i, seat in enumerate(ranked):
        seat["rank"] = i + 1
    return True, ranked


def summarize(stage):
    """1つの段をまとめて見る。`bracket.gs` の summarize と同じ振り分けです。"""
    pending, tops, bottoms, middles, players = [], [], [], [], []
    for ti, table in enumerate(stage["tables"]):
        done, ranked = rank_table(table)
        if not done:
            pending.append(table["vc"])
            continue
        table["done"] = True
        for p, seat in enumerate(ranked):
            seat["_table"] = ti
            players.append(seat)
            # **1人しかいない卓では、1位が最下位を兼ねます。** 決勝を優先します。
            if p == 0:
                tops.append(seat)
            elif p == len(ranked) - 1:
                bottoms.append(seat)
            else:
                middles.append(seat)

    # 順位の昇順 → 卓番号順。**予選の卓順のまま配ると「2位だけの卓」と
    # 「3位だけの卓」に分かれ、素点で比べるこの方式では不公平になります。**
    middles.sort(key=lambda s: (s["rank"], s["_table"]))
    return {
        "pending": pending, "tables_n": len(stage["tables"]),
        "tops": tops, "bottoms": bottoms, "middles": middles, "players": players,
    }


def seat(name):
    return {"name": name, "scores": [None] * GAMES}


def spread(people):
    """人を卓へ順ぐりに配る。出身の卓が固まらないようにするため。"""
    n = max(1, math.ceil(len(people) / SEAT))
    tables = [[] for _ in range(n)]
    for i, p in enumerate(people):
        tables[i % n].append(p)
    return tables


def find_stage(state, label):
    for s in state["stages"]:
        if s["label"] == label:
            return s
    return None


def advance_stage(state):
    """前の段が終わっていれば、次の段を組んで state に足す。

    戻り値は「足したかどうか」。決勝まで組み終わっていれば何もしません。
    """
    if find_stage(state, FINAL) or find_stage(state, LAST):
        return False

    qual = find_stage(state, QUAL)
    if qual is None:
        sys.exit(f"JSON に「{QUAL}」の段がありません。draw_tables.py --save で作り直してください。")

    q = summarize(qual)
    if q["pending"]:
        return False                                    # まだ終わっていない卓がある

    n = q["tables_n"]
    if not 2 <= n <= 4:
        sys.exit(f"{QUAL}が{n}卓あります。この方式は2〜4卓（5〜16人）で使ってください。")

    # ── 順位決定戦 ────────────────────────────────
    rank = find_stage(state, RANK)
    if rank is None:
        if not q["middles"]:
            return False                                # 中間の順位の人がいない
        tables = spread(q["middles"])
        state["stages"].append({
            "label": RANK,
            "tables": [{"vc": f"卓{i + 1}", "seats": [seat(p["name"]) for p in t]}
                       for i, t in enumerate(tables)],
        })
        return True

    # ── 決勝と最下位決定戦 ─────────────────────────
    r = summarize(rank)
    if r["pending"]:
        return False

    # 卓をまたいで、合計点そのもので通し順位を付ける
    overall = sorted(r["players"], key=lambda s: -total_of(s))
    k = min(max(0, SEAT - n), len(overall) // 2)

    to_final = [s["name"] for s in q["tops"]] + [s["name"] for s in overall[:k]]
    to_last = [s["name"] for s in q["bottoms"]] + ([s["name"] for s in overall[-k:]] if k else [])

    state["stages"].append({"label": FINAL,
                            "tables": [{"vc": "卓1", "seats": [seat(n_) for n_ in to_final]}]})
    state["stages"].append({"label": LAST,
                            "tables": [{"vc": "卓1", "seats": [seat(n_) for n_ in to_last]}]})
    return True


def mark_seats(state):  # noqa: C901
    """「決勝へ」「最下位決定戦へ」「優勝」の印を席に付ける。

    印の付けかたは `assets/script.js` の plan() と同じにしてあります。
    片方だけ直すと、シートから作った表と焼き付けた表が食い違います。
    """
    for s in state["stages"]:
        for t in s["tables"]:
            for seat_ in t["seats"]:
                seat_["_mark"] = None

    qual = find_stage(state, QUAL)
    if qual is None:
        return
    q = summarize(qual)
    for s in q["tops"]:
        s["_mark"] = "up"
    for s in q["bottoms"]:
        s["_mark"] = "down"

    k = 0
    rank = find_stage(state, RANK)
    if rank is not None:
        r = summarize(rank)
        if not r["pending"]:
            overall = sorted(r["players"], key=lambda s: -total_of(s))
            k = min(max(0, SEAT - q["tables_n"]), len(overall) // 2)
            for s in overall[:k]:
                s["_mark"] = "up"
            if k:
                for s in overall[-k:]:
                    s["_mark"] = "down"

    # **優勝が出るのは決勝だけ。** 最下位決定戦の1位に王冠は付けません。
    final = find_stage(state, FINAL)
    if final is not None:
        f = summarize(final)
        for s in f["tops"]:
            s["_mark"] = "champ"
    return k


def fmt(n):
    return f"{n:,}"


def render(state):
    """マーカーの間に入れる HTML を組み立てる。

    出す形は `assets/script.js` の render() と同じです。
    **決勝と最下位決定戦は、横に並べて1段にします。**
    """
    e = html.escape
    k = mark_seats(state)

    # 表示は「新しい段が上」。決勝と最下位決定戦はひとまとめ。
    groups = []
    for label in (QUAL, RANK):
        s = find_stage(state, label)
        if not s:
            continue
        # **K が 0 のときは、この段から上下へ抜ける人がいません。**
        # 印が1つも付かないと壊れて見えるので、何のための段なのかを書きます
        # （assets/script.js の plan() と同じ扱い）。
        note = "（ここで順位が決まります）" if label == RANK and not k else ""
        groups.append((label, False, note, [(t["vc"], False, t) for t in s["tables"]]))
    last_row = []
    for label, gold in ((FINAL, True), (LAST, False)):
        s = find_stage(state, label)
        if s:
            last_row += [(label, gold, t) for t in s["tables"]]
    if last_row:
        groups.append((f"{FINAL}・{LAST}", True, "", last_row))

    out = ['<div class="rounds">']
    for label, is_final, note, tables in reversed(groups):
        tag = f'<span class="round__note">{e(note)}</span>' if note else ""
        out.append(f'{INDENT}  <div class="round{" round--final" if is_final else ""}">')
        out.append(f'{INDENT}    <h3 class="round__label">{e(label)}{tag}</h3>')
        out.append(f'{INDENT}    <div class="round__tables">')

        for title, gold, t in tables:
            out.append(f'{INDENT}      <div class="tablecard{" tablecard--gold" if gold else ""}">')
            out.append(f'{INDENT}        <h4 class="tablecard__name">{e(title)}</h4>')
            out.append(f'{INDENT}        <ul class="tablecard__seats">')

            # 確定した卓は順位順に並べる（並び順そのものが順位になります）
            seats = list(t["seats"])
            if t.get("done"):
                seats.sort(key=lambda s: (1, 0) if is_cpu(s["name"]) else (0, s.get("rank", 99)))

            for s in seats:
                if is_cpu(s["name"]):
                    cls = ' class="is-cpu"'
                elif s.get("_mark") == "champ":
                    cls = ' class="is-winner is-champion"'
                elif s.get("_mark") == "up":
                    cls = ' class="is-winner"'
                elif s.get("_mark") == "down":
                    cls = ' class="is-drop"'
                else:
                    cls = ""
                # 優勝の席には点数を出しません（卓の幅が240pxしかないため）
                total = total_of(s)
                note = ""
                if s.get("_mark") != "champ" and total is not None:
                    note = f'<span class="seat__note">{fmt(total)}</span>'
                out.append(f'{INDENT}          <li{cls}>{e(s["name"])}{note}</li>')

            for _ in range(SEAT - len(seats)):
                out.append(f'{INDENT}          <li class="is-cpu">CPU</li>')
            out.append(f'{INDENT}        </ul>')
            out.append(f'{INDENT}      </div>')

        out.append(f'{INDENT}    </div>')
        out.append(f'{INDENT}  </div>')

    out.append(f'{INDENT}</div>')
    return "\n".join(out)


def clean(state):
    """計算用に足した印を JSON から落とす（保存する中身を汚さないため）。"""
    for s in state["stages"]:
        for t in s["tables"]:
            t.pop("done", None)
            for seat_ in t["seats"]:
                seat_.pop("_mark", None)
                seat_.pop("_table", None)
                seat_.pop("rank", None)


def write_page(body, dry):
    with open(PAGE, encoding="utf-8") as f:
        page = f.read()

    i, j = page.find(START), page.find(END)
    if i < 0 or j < 0:
        sys.exit(f"index.html に {START} / {END} が見つかりません。\n"
                 f"BRACKET セクションのマーカーを消していないか確認してください。")
    if j < i:
        sys.exit("BRACKET:END が BRACKET:START より前にあります。順番を直してください。")

    new = page[:i + len(START)] + "\n" + INDENT + body.lstrip() + "\n" + INDENT + page[j:]
    if dry:
        print(body)
        return False
    if new == page:
        return False
    with open(PAGE, "w", encoding="utf-8", newline="") as f:
        f.write(new)
    return True


def main():
    ap = argparse.ArgumentParser(description="対戦表を index.html に書き込む")
    ap.add_argument("json", help="draw_tables.py --save で作った JSON")
    ap.add_argument("--dry", action="store_true", help="書き込まずに結果だけ表示する")
    args = ap.parse_args()

    state = load(args.json)
    if "stages" not in state:
        sys.exit("この JSON は古い形（rounds / winners）です。\n"
                 "draw_tables.py --save で作り直してください。点数を入れる形に変わりました。")

    added = 0
    while advance_stage(state):                         # 埋まっているぶんだけ先に進める
        added += 1

    body = render(state)
    clean(state)

    if added and not args.dry:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write("\n")

    changed = write_page(body, args.dry)

    for s in state["stages"]:
        people = sum(len(t["seats"]) for t in s["tables"])
        done = sum(1 for t in s["tables"]
                   if all(is_done(x) for x in t["seats"] if not is_cpu(x["name"])))
        print(f"{s['label']}: {people}人 / {len(s['tables'])}卓（3戦そろったのは {done}卓）")
    if added:
        where = "画面に出しただけで保存していません" if args.dry else f"{args.json} に保存済み"
        print(f"\n次の段を {added} つ組みました（{where}）。")
    if args.dry:
        print("\n--dry なので index.html は書き換えていません。")
    elif changed:
        print("\nindex.html を更新しました。公開するには commit して push してください。")
    else:
        print("\n内容に変化がないため、index.html はそのままです。")


if __name__ == "__main__":
    main()
