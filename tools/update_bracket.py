"""トーナメント表を index.html に書き込む。

`draw_tables.py --save` が作った JSON を読み、`index.html` の

    <!-- BRACKET:START -->  …ここだけ書き換わる…  <!-- BRACKET:END -->

の間を組み直します。**マーカーの外は一切触りません。**

使いかた:

    python tools/update_bracket.py tournament.json          # 表を書き込む
    python tools/update_bracket.py tournament.json --dry    # 書き込まずに結果だけ見る

## 当日の流れ

1. 前日: `python tools/draw_tables.py 参加者.csv --save tournament.json`
2. 当日、1回戦が終わったら **tournament.json の `winners` に勝ち上がった人の名前を書く**

       "winners": ["ふろん", "アオ"]

3. `python tools/update_bracket.py tournament.json`
   → 次の回戦が自動で組まれ、表も更新されます
4. GitHub Pages で公開しているなら `git add -A && git commit -m "1回戦の結果" && git push`

飛び入りで人数が変わったときは、**参加者CSVに行を足して手順1からやり直してください。**
（対局が始まる前ならこれで問題ありません）

## winners の書きかた

- その卓から勝ち上がった人の名前を、**参加者と同じ表記で**書きます
- 人数は `advance`（既定2名）と同じにします
- **まだ終わっていない卓は空のまま**にしてください。全卓が埋まって初めて次の回戦を組みます
"""
import argparse
import html
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), "index.html")
START = "<!-- BRACKET:START -->"
END = "<!-- BRACKET:END -->"
SEAT = 4
INDENT = " " * 6


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def round_label(i, tables_n):
    return "決勝" if tables_n == 1 else f"{i + 1}回戦"


def advance_round(state):
    """全卓の winners が埋まっていれば、次の回戦を組んで state に足す。

    戻り値は「足したかどうか」。決勝が終わっていれば何もしません。
    """
    rounds = state["rounds"]
    last = rounds[-1]
    if len(last["tables"]) == 1:
        return False                                    # 決勝まで組み終わっている

    need = state.get("advance", 2)
    done = []
    for t in last["tables"]:
        w = t.get("winners") or []
        if not w:
            return False                                # まだ終わっていない卓がある
        if len(w) != need:
            sys.exit(f"{last['label']} {t['vc']} の winners が{len(w)}人です。"
                     f"advance が {need} なので {need} 人にしてください。")
        known = set(t["players"])
        for name in w:
            if name not in known:
                sys.exit(f"{last['label']} {t['vc']} に「{name}」がいません。"
                         f"その卓の参加者は {'、'.join(t['players'])} です。"
                         f"名前の表記を合わせてください。")
        done.extend(w)

    tables_n = max(1, math.ceil(len(done) / SEAT))
    tables = [[] for _ in range(tables_n)]
    # 同じ卓から上がった人がまた同座しにくいよう、順に配る（勝者の並び順を崩さない）
    for i, name in enumerate(done):
        tables[i % tables_n].append(name)

    rounds.append({
        "label": round_label(len(rounds), tables_n),
        "tables": [{"vc": f"卓{i + 1}", "players": t, "winners": []}
                   for i, t in enumerate(tables)],
    })
    return True


def render(state):
    """マーカーの間に入れる HTML を組み立てる。"""
    e = html.escape
    unlocked = {p["name"]: p.get("unlocked", True) for p in state.get("players", [])}
    out = ['<div class="rounds">']

    rounds = state["rounds"]
    for ri, rnd in enumerate(rounds):
        # 最後の回戦かつ1卓なら決勝。ここの勝者は「勝ち上がり」ではなく優勝者
        is_final = ri == len(rounds) - 1 and len(rnd["tables"]) == 1
        out.append(f'{INDENT}  <div class="round">')
        out.append(f'{INDENT}    <h3 class="round__label">{e(rnd["label"])}</h3>')
        out.append(f'{INDENT}    <div class="round__tables">')

        for t in rnd["tables"]:
            winners = set(t.get("winners") or [])
            cpu = SEAT - len(t["players"])
            out.append(f'{INDENT}      <div class="tablecard">')
            out.append(f'{INDENT}        <h4 class="tablecard__name">{e(t["vc"])}</h4>')
            out.append(f'{INDENT}        <ul class="tablecard__seats">')
            for name in t["players"]:
                if name in winners:
                    cls = ' class="is-winner is-champion"' if is_final else ' class="is-winner"'
                else:
                    cls = ""
                nb = "" if unlocked.get(name, True) else '<span class="seat__note">未解放</span>'
                out.append(f'{INDENT}          <li{cls}>{e(name)}{nb}</li>')
            for _ in range(cpu):
                out.append(f'{INDENT}          <li class="is-cpu">CPU</li>')
            out.append(f'{INDENT}        </ul>')
            out.append(f'{INDENT}      </div>')

        out.append(f'{INDENT}    </div>')
        out.append(f'{INDENT}  </div>')

    out.append(f'{INDENT}</div>')
    return "\n".join(out)


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
    ap = argparse.ArgumentParser(description="トーナメント表を index.html に書き込む")
    ap.add_argument("json", help="draw_tables.py --save で作った JSON")
    ap.add_argument("--dry", action="store_true", help="書き込まずに結果だけ表示する")
    args = ap.parse_args()

    state = load(args.json)

    added = 0
    while advance_round(state):                         # 埋まっているぶんだけ先に進める
        added += 1
    if added and not args.dry:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write("\n")

    changed = write_page(render(state), args.dry)

    for rnd in state["rounds"]:
        done = sum(1 for t in rnd["tables"] if t.get("winners"))
        print(f"{rnd['label']}: {len(rnd['tables'])}卓（結果が入っているのは {done}卓）")
    if added:
        print(f"\n次の回戦を {added} つ組みました（{args.json} に保存済み）。")
    if args.dry:
        print("\n--dry なので index.html は書き換えていません。")
    elif changed:
        print("\nindex.html を更新しました。公開するには commit して push してください。")
    else:
        print("\n内容に変化がないため、index.html はそのままです。")


if __name__ == "__main__":
    main()
