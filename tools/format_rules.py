"""大会方式の決まりごと。`draw_tables.py` と `update_bracket.py` が共有します。

**仕様の正本は `docs/detail-design.md` 章7-1です。** 同じ振り分けを
`assets/script.js` と `tools/bracket.gs` でも書いているので、
**ここを直したら、あの2つも直してください。**（片方だけ直すと当日ちぐはぐな表になります）

    予選 → 順位決定戦 → 決勝 ＋ 最下位決定戦

どの卓も3戦打ち、3戦の合計点で順位を決めます。
"""
import math

SEAT = 4                       # 1卓の人数
GAMES = 3                      # 1つの卓で打つ回数

QUAL = "予選"
RANK = "順位決定戦"
FINAL = "決勝"
LAST = "最下位決定戦"

MIN_QUAL_TABLES = 2            # 1卓しかないと予選にならない
MAX_QUAL_TABLES = 4            # 5卓以上は予選を2段にする必要があり、いまは未対応


class Unsupported(Exception):
    """この方式では組めない人数。呼び出し側が理由をそのまま出せるようにしている。"""


def qual_tables(players_n):
    """予選の卓数 N。"""
    return max(1, math.ceil(players_n / SEAT))


def table_sizes(players_n):
    """予選の卓ごとの人数。**なるべく均等に配ります**（draw() と同じ考えかた）。"""
    n = qual_tables(players_n)
    base, extra = divmod(players_n, n)
    return [base + (1 if i < extra else 0) for i in range(n)]


def counts(players_n):
    """(1位の人数, 最下位の人数, 中間の人数) を返す。

    **非CPUが2人以下の卓では、1位が最下位を兼ねます。** そのときは決勝を優先し、
    最下位決定戦へは送りません（`bracket.gs` の summarize と同じ扱い）。
    """
    tops = bottoms = middles = 0
    for size in table_sizes(players_n):
        if size <= 0:
            continue
        tops += 1
        if size >= 2:
            bottoms += 1
        middles += max(0, size - 2)
    return tops, bottoms, middles


def advance_k(players_n):
    """順位決定戦から上下それぞれ何人が進むか。

    **K = min(4 − N, ⌊中間人数 ÷ 2⌋)**
    前半で決勝の席をちょうど4つにし、後半で「中間が足りないのに上下2人ずつ抜く」
    のを防ぎます。K が減ったぶんの空席にはCPUが入ります。
    """
    _, _, middles = counts(players_n)
    return min(max(0, SEAT - qual_tables(players_n)), middles // 2)


def check(players_n):
    """組めない人数なら Unsupported を投げる。"""
    n = qual_tables(players_n)
    if n < MIN_QUAL_TABLES:
        raise Unsupported(
            f"参加者が{players_n}人だと予選が{n}卓にしかなりません。\n"
            f"この方式は{MIN_QUAL_TABLES}卓以上（{SEAT * MIN_QUAL_TABLES - 3}人以上）で使ってください。"
        )
    if n > MAX_QUAL_TABLES:
        raise Unsupported(
            f"参加者が{players_n}人だと予選が{n}卓になります。\n"
            f"{MAX_QUAL_TABLES + 1}卓以上（{SEAT * MAX_QUAL_TABLES + 1}人以上）は予選を2段に分ける必要があり、"
            f"いまの仕組みでは組めません。運営に相談してください。"
        )


def plan_stages(players_n):
    """段ごとの人数を試算する。[(段の名前, 人数, 卓数, 空席数), ...] を返す。

    空席にはCPUが入ります。**席がちょうど埋まるのは 8人・12人・16人だけです。**
    """
    check(players_n)
    tops, bottoms, middles = counts(players_n)
    k = advance_k(players_n)
    n = qual_tables(players_n)
    rank_n = max(1, math.ceil(middles / SEAT)) if middles else 0

    stages = [(QUAL, players_n, n, n * SEAT - players_n)]
    if middles:
        stages.append((RANK, middles, rank_n, rank_n * SEAT - middles))
    stages.append((FINAL, tops + k, 1, SEAT - (tops + k)))
    stages.append((LAST, bottoms + k, 1, SEAT - (bottoms + k)))
    return stages


def warnings(players_n):
    """運営が先に知っておいたほうがよい点を挙げる。"""
    notes = []
    for label, n, tables_n, empty in plan_stages(players_n):
        if empty > 0:
            notes.append(f"{label}は{n}人で{tables_n}卓のため、{empty}席がCPUになります。")

    _, _, middles = counts(players_n)
    if middles and advance_k(players_n) < SEAT - qual_tables(players_n):
        notes.append(
            f"中間の順位が{middles}人しかいないため、順位決定戦から上下へ進む人数を減らしています。"
        )

    # **抽選で解放者を散らせるのは予選だけです。** 先の卓は成績で決まるので、
    # ルームを作れる人がいない卓ができることがあります。
    notes.append(
        "順位決定戦から先の卓は成績で決まります。**ポカジャンを解放している人が"
        "その卓に1人もいないと、ルームを立てられません。** そのときは"
        "運営が席を入れ替えるか、解放している観戦者に立ててもらってください。"
    )
    return notes
