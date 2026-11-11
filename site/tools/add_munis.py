"""台帳の「自治体」シートに、全国1,741市区町村の行を足す（何度実行しても同じ結果）。

使い方:
  python3 tools/add_munis.py 台帳.xlsx localgovjp-utf8.csv

- 元のデータ: code4fukui/localgovjp（CC0）
  https://github.com/code4fukui/localgovjp
- 政令指定都市の「区」は入れない（地域防災計画は市がつくるため）。東京23区は入れる。
- 「地域防災計画のURL」は空のまま。すでに書いてある行は上書きしない。
- 「公式サイトのURL（調べる起点）」は、計画のページを探すときの入口。サイトには表示しない。
"""
import csv
import sys

import openpyxl
from openpyxl.styles import PatternFill

NEW_COL = "公式サイトのURL（調べる起点）"
PINK = PatternFill("solid", fgColor="FDE7F1")


def kind(name):
    if name.endswith("区"):
        return "特別区"
    return {"市": "市", "町": "町", "村": "村"}[name[-1]]


def main(xlsx, src):
    rows = [r for r in csv.DictReader(open(src, encoding="utf-8-sig")) if " " not in r["city"] and "　" not in r["city"]]
    wb = openpyxl.load_workbook(xlsx)
    ws = wb["自治体"]
    head = [c.value for c in ws[1]]
    if NEW_COL not in head:
        ws.cell(row=1, column=len(head) + 1, value=NEW_COL).fill = PINK
        head.append(NEW_COL)
    col = {h: i for i, h in enumerate(head)}
    data = [list(r) + [None] * (len(head) - len(r)) for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0]]
    by_code = {str(r[col["全国地方公共団体コード"]]): r for r in data}
    added = 0
    for r in rows:
        code = r["lgcode"]
        row = by_code.get(code)
        if row is None:
            row = [None] * len(head)
            row[col["全国地方公共団体コード"]] = code
            row[col["都道府県名"]] = r["pref"]
            row[col["自治体名"]] = r["city"]
            row[col["種別"]] = kind(r["city"])
            row[col["リンクの状態"]] = "未確認"
            by_code[code] = row
            added += 1
        if not row[col[NEW_COL]] and r.get("url"):
            row[col[NEW_COL]] = r["url"]
    # 都道府県 → 市区町村の順、コード順に並べる
    out = sorted(by_code.values(), key=lambda r: (str(r[col["全国地方公共団体コード"]])[:2], 0 if r[col["種別"]] == "都道府県" else 1, str(r[col["全国地方公共団体コード"]])))
    ws.delete_rows(2, ws.max_row)
    for r in out:
        ws.append(r)
    for c in ws["A"][1:]:
        c.number_format = "@"
    wb.save(xlsx)
    n_mun = sum(1 for r in out if r[col["種別"]] != "都道府県")
    print(f"自治体シート：都道府県 {len(out) - n_mun}、市区町村 {n_mun}（今回追加 {added}）")

    # 「災害×自治体」のコードを、名前と照らし合わせる（同じ都道府県の中で名前が1つに決まるときだけ直す）
    if "災害×自治体" in wb.sheetnames:
        ws2 = wb["災害×自治体"]
        h2 = {c.value: i + 1 for i, c in enumerate(ws2[1])}
        name_of = {str(r[col["全国地方公共団体コード"]]): r[col["自治体名"]] for r in out}
        fixed = []
        for rr in range(2, ws2.max_row + 1):
            code = str(ws2.cell(rr, h2["全国地方公共団体コード"]).value or "")
            name = ws2.cell(rr, h2["今の自治体名"]).value
            if not code or not name:
                continue
            if name_of.get(code) == name:
                if ws2.cell(rr, h2["コードの確認"]).value in (None, "", "要確認"):
                    ws2.cell(rr, h2["コードの確認"]).value = "照合済み"
                continue
            cand = [c for c, n in name_of.items() if n == name and c[:2] == code[:2]]
            if len(cand) == 1:
                ws2.cell(rr, h2["全国地方公共団体コード"]).value = cand[0]
                ws2.cell(rr, h2["コードの確認"]).value = f"照合済み（{code}から直した）"
                fixed.append(f"{name} {code}→{cand[0]}")
            else:
                ws2.cell(rr, h2["コードの確認"]).value = "要確認（コードと名前が合わない）"
                fixed.append(f"{name} {code}：要確認")
        wb.save(xlsx)
        print("災害×自治体：" + ("、".join(fixed) if fixed else "すべてコードと名前が一致"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
