"""HagiiZ 災害レビュー：台帳（xlsx）から静的なWebサイトを作る。

使い方:
  python3 gen.py 台帳.xlsx 出力フォルダ                 本番用（アドレスは /saigai/isewan-taifu/ の形）
  python3 gen.py 台帳.xlsx 出力フォルダ --preview       確認用（リンクに index.html を付ける。ファイルを直接開いても動く）
  オプション: --api URL（答えの受け皿。空なら試作モード） --base URL（公開するアドレス。OGPとsitemapに使う）
  設定は config.json でも指定できる（オプションが優先）。

台帳の「サイトの公開」が「する」の災害・法律だけページを作る。「準備中」はカードだけ出る。
"""
import argparse
import json
import os
import re
import shutil
from collections import OrderedDict, defaultdict
from datetime import date

from jinja2 import Environment, FileSystemLoader, select_autoescape
from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------- 台帳を読む ----------------
def load(path):
    wb = load_workbook(path, data_only=True)
    D = {}
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        h = [str(x).strip() if x is not None else "" for x in rows[0]]
        out = []
        for r in rows[1:]:
            if not any(v not in (None, "") for v in r):
                continue
            rec = {}
            for i, v in enumerate(r):
                if i < len(h) and h[i]:
                    if v is None:
                        v = ""
                    elif isinstance(v, float) and v.is_integer():
                        v = str(int(v))
                    else:
                        v = str(v).strip()
                    rec[h[i]] = v
            out.append(rec)
        D[ws.title] = out
    return D


def ids(s):
    return [x.strip() for x in re.split(r"[,、，\s]+", s or "") if x.strip()]


def youtube_embed(url):
    if not url:
        return ""
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([A-Za-z0-9_-]{11})", url)
    return f"https://www.youtube-nocookie.com/embed/{m.group(1)}" if m else ""


def num(v):
    s = str(v)
    return f"{int(s):,}" if s.isdigit() else s


# ---------------- データを組み立てる ----------------
def build(D):
    M = {}
    pub_src = [s for s in D["資料"] if s.get("公開", "する") != "しない"]
    S = {s["資料ID"]: s for s in pub_src}
    A = {a["改正ID"]: a for a in D.get("改正", [])}

    # 災害・法律
    dis = []
    for d in D["災害"]:
        d = dict(d)
        d["open"] = d.get("サイトの公開", "する") == "する"
        d["year"] = d.get("発生年月日", "")[:4]
        d["img"] = d.get("画像") or "typhoon"
        d["name"] = re.sub(r"（.*?）", "", d["災害名"])
        dis.append(d)
    dis.sort(key=lambda d: d["発生年月日"])
    DI = {d["災害ID"]: d for d in dis}
    laws = []
    for l in D["法律"]:
        l = dict(l)
        l["open"] = l.get("サイトの公開", "する") == "する"
        l["embed"] = youtube_embed(l.get("動画URL", ""))
        laws.append(l)
    laws.sort(key=lambda l: l["制定年"])
    L = {l["法律ID"]: l for l in laws}
    P = {p["現象ID"]: dict(p) for p in D.get("科学", [])}

    pairs = []
    for x in D["法律×災害"]:
        if x["関係"] == "制定のきっかけ" and x["法律ID"] in L and x["災害ID"] in DI:
            d, l = DI[x["災害ID"]], L[x["法律ID"]]
            pairs.append({"d": d, "l": l, "open": d["open"] and l["open"]})
    pairs.sort(key=lambda p: p["d"]["発生年月日"])
    for d in dis:
        d["laws"] = [L[x["法律ID"]] for x in D["法律×災害"] if x["災害ID"] == d["災害ID"] and x["法律ID"] in L]
        d["phen"] = [P[x["現象ID"]] for x in D.get("災害×科学", []) if x["災害ID"] == d["災害ID"] and x["現象ID"] in P]
    for l in laws:
        l["disasters"] = [DI[x["災害ID"]] for x in D["法律×災害"] if x["法律ID"] == l["法律ID"] and x["災害ID"] in DI]

    # 根拠カード
    cards = OrderedDict()
    for c in D.get("根拠カード", []):
        src = S.get(c.get("資料ID", ""))
        am = A.get(c.get("改正ID", ""))
        refs = []
        if src:
            refs.append({"t": src["タイトル"], "u": src.get("URL", ""), "by": src.get("作成者・発行者", "")})
        if am:
            refs.append({"t": am["改正法"], "u": am.get("日本法令索引のURL", ""), "by": "日本法令索引"})
        cards[c["カードID"]] = {"id": c["カードID"], "t": c["1文"], "refs": refs, "d": c.get("災害ID", ""), "l": c.get("法律ID", "")}

    # 未来への問い
    qs = []
    for t in D["未来への問い"]:
        if not t.get("公開用の名前"):
            continue
        t = dict(t)
        d = DI.get(t.get("災害ID", ""))
        if d and not d["open"]:
            continue
        t["slug"] = t["公開用の名前"]
        t["order"] = int(t.get("表示順") or 999)
        t["q"] = t.get("問い（やさしく）") or t.get("問い（1文）")
        t["then"] = t.get("あのとき", "")
        t["h"] = t.get("見出し", "")
        t["kind"] = t.get("種類") or "教訓"
        t["d"] = d
        t["l"] = L.get(t.get("法律ID", ""))
        t["src"] = S.get(t.get("根拠の資料ID", ""))
        t["cards"] = [c for c in ids(t.get("根拠カードID")) if c in cards]
        t["tags"] = ids(t.get("タグ", ""))
        qs.append(t)
    qs.sort(key=lambda t: t["order"])
    kind_n = {}
    for i, t in enumerate(qs, 1):
        t["no"] = f"{i:02d}"
        kind_n[t["kind"]] = kind_n.get(t["kind"], 0) + 1
        t["kno"] = f"{kind_n[t['kind']]:02d}"
    for c in cards.values():
        c["qs"] = [t for t in qs if c["id"] in t["cards"]]

    # 数字
    nums = defaultdict(lambda: OrderedDict())
    for n in D.get("数字", []):
        g = nums[n["災害ID"]].setdefault(n["範囲"], OrderedDict()).setdefault(n["項目"], [])
        x = dict(n)
        x["v"] = num(n["値"])
        x["src"] = S.get(n.get("資料ID", ""))
        g.append(x)
    numgroups = {}
    for did, scopes in nums.items():
        out = []
        for scope, items in scopes.items():
            rows = []
            for k, vals in items.items():
                rows.append({"k": k, "vals": vals, "diff": len({(v["値"], v.get("単位", "")) for v in vals}) > 1})
            out.append({"scope": scope, "rows": rows})
        numgroups[did] = out

    # 資料
    for d in dis:
        d["sources"] = [s for s in pub_src if s.get("災害ID") == d["災害ID"] and s["種類"] != "国会の議事録"]
        d["kinds"] = sorted({s["種類"] for s in d["sources"]})
        d["nums"] = numgroups.get(d["災害ID"], [])
        d["n_nums"] = sum(len(r["vals"]) for g in d["nums"] for r in g["rows"])
        d["qs"] = [t for t in qs if t["d"] is d]
        d["cards"] = [c for c in cards.values() if c["d"] == d["災害ID"]]
    for l in laws:
        dids = [d["災害ID"] for d in l["disasters"]]
        tl = [s for s in pub_src if s["種類"] == "国会の議事録" and s.get("日付（会議日など）")
              and (s.get("法律ID") == l["法律ID"] or (not s.get("法律ID") and s.get("災害ID") in dids))]
        tl.sort(key=lambda s: s["日付（会議日など）"])
        for s in tl:
            s["hi"] = any(k in s["タイトル"] for k in ("附帯決議", "可決", "修正議決", "採決"))
        l["timeline"] = tl
        l["amends"] = sorted([a for a in D.get("改正", []) if a["法律ID"] == l["法律ID"]], key=lambda a: a["公布日"])
        l["qs"] = [t for t in qs if t["l"] is l and t["kind"] == "国会"]
        l["sources"] = [s for s in pub_src if s.get("法律ID") == l["法律ID"] and s["種類"] != "国会の議事録"]
        l["lessons"] = sorted([dict(r, cards=[cards[c] for c in ids(r.get("根拠カードID")) if c in cards])
                               for r in D.get("レッスン", []) if r.get("法律ID") == l["法律ID"]], key=lambda r: int(r["番号"]))

    # 被災した地域
    MU = {m["全国地方公共団体コード"]: m for m in D.get("自治体", [])}
    for d in dis:
        d["munis"] = []
        for m in D.get("災害×自治体", []):
            if m["災害ID"] == d["災害ID"]:
                mm = dict(m)
                mm["url"] = MU.get(m["全国地方公共団体コード"], {}).get("地域防災計画のURL", "")
                d["munis"].append(mm)

    # 地域（全国）
    prefs = OrderedDict()
    for m in D.get("自治体", []):
        if m.get("種別") == "都道府県":
            prefs[m["全国地方公共団体コード"][:2]] = {"name": m["都道府県名"], "short": re.sub(r"(都|府|県)$", "", m["都道府県名"]) if m["都道府県名"] != "北海道" else "北海道",
                                                    "code": m["全国地方公共団体コード"], "url": m.get("地域防災計画のURL", ""), "munis": OrderedDict(), "hit": False}
    for m in D.get("自治体", []):
        if m.get("種別") != "都道府県" and m["全国地方公共団体コード"][:2] in prefs:
            prefs[m["全国地方公共団体コード"][:2]]["munis"][m["全国地方公共団体コード"]] = {"name": m["自治体名"], "url": m.get("地域防災計画のURL", ""), "dis": []}
    for d in dis:
        if not d["open"]:
            continue
        for m in d["munis"]:
            code = m["全国地方公共団体コード"]
            pf = prefs.get(code[:2])
            if not pf:
                continue
            pf["hit"] = True
            if code == pf["code"]:
                pf.setdefault("dis", []).append(d)
                continue
            mu = pf["munis"].setdefault(code, {"name": m["今の自治体名"], "url": m.get("url", ""), "dis": []})
            mu["dis"].append(d)
    M.update(dis=dis, laws=laws, pairs=pairs, qs=qs, cards=cards, sources=pub_src, prefs=prefs, phen=P,
             n_src_all=len(pub_src))
    return M


# ---------------- 書き出す ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("out")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--api")
    ap.add_argument("--base")
    a = ap.parse_args()
    cfg = {}
    cp = os.path.join(HERE, "config.json")
    if os.path.exists(cp):
        cfg = json.load(open(cp, encoding="utf-8"))
    api = a.api if a.api is not None else cfg.get("api", "")
    base = (a.base or cfg.get("base_url", "")).rstrip("/")

    D = load(a.xlsx)
    M = build(D)
    env = Environment(loader=FileSystemLoader(os.path.join(HERE, "templates")), autoescape=select_autoescape(["html", "xml"]),
                      trim_blocks=True, lstrip_blocks=True)
    out = a.out
    if os.path.exists(out):
        shutil.rmtree(out)
    shutil.copytree(os.path.join(HERE, "static"), os.path.join(out, "static"))
    pages = []

    def write(path, tpl, absolute=False, **kw):
        depth = path.count("/")
        r = "/" if (absolute and not a.preview) else "../" * depth

        def url(p=""):
            if p.startswith("http"):
                return p
            if a.preview and (p == "" or p.endswith("/")):
                p = p + "index.html"
            return (r + p) if (r + p) else "./"

        def asset(p):
            return r + "static/" + p
        canonical = base + "/" + (path[:-10] if path.endswith("index.html") else path)
        html = env.get_template(tpl).render(url=url, asset=asset, cfg=cfg, api=api, demo=not api, canonical=canonical,
                                            base=base, today=date.today().isoformat(), M=M, **kw)
        p = os.path.join(out, path)
        os.makedirs(os.path.dirname(p) or out, exist_ok=True)
        open(p, "w", encoding="utf-8").write(html)
        pages.append(path)

    dis_open = [d for d in M["dis"] if d["open"]]
    laws_open = [l for l in M["laws"] if l["open"]]
    open_q = M["qs"]
    threads = []
    for p in M["pairs"]:
        if p["open"]:
            threads.append(["d-" + p["d"]["公開用の名前"], "l-" + p["l"]["公開用の名前"], "open"])
            for t in p["d"]["qs"][:9]:
                threads.append(["l-" + p["l"]["公開用の名前"], "q-" + t["slug"], "open"])

    write("index.html", "index.html", title="", nav="board", threads=threads, og="og.png")
    write("saigai/index.html", "saigai_list.html", title="災害", nav="saigai")
    for d in dis_open:
        b = f"saigai/{d['公開用の名前']}/"
        write(b + "index.html", "saigai.html", title=d["name"], nav="saigai", d=d)
        write(b + "suuji/index.html", "suuji.html", title=d["name"] + "：資料によって違う数字", nav="saigai", d=d)
        write(b + "konkyo/index.html", "konkyo.html", title=d["name"] + "：根拠カード", nav="saigai", d=d)
        write(b + "ima/index.html", "ima.html", title=d["name"] + "：被災した地域は、いま", nav="saigai", d=d)
        write(b + "shiryo/index.html", "shiryo.html", title=d["name"] + "：資料", nav="saigai", d=d, items=d["sources"], kinds=d["kinds"])
    write("hou/index.html", "hou_list.html", title="法律", nav="saigai")
    for l in laws_open:
        write(f"hou/{l['公開用の名前']}/index.html", "hou.html", title=l["法律名"], nav="saigai", l=l)
    write("toi/index.html", "toi_list.html", title="未来への問い", nav="toi")
    cards_js = {k: {"t": v["t"]} for k, v in M["cards"].items()}
    for t in open_q:
        rel = [M["cards"][c] for c in t["cards"]]
        others = [c for c in M["cards"].values() if c["d"] == (t["d"] or {}).get("災害ID") and c["id"] not in t["cards"]]
        write(f"toi/{t['slug']}/index.html", "toi.html", title=t["q"], nav="toi", t=t, rel=rel, others=others,
              cards_js=cards_js, og=f"og/{t['slug']}.png")
    write("me/index.html", "me.html", title="わたしの答え", nav="")
    write("manabu/index.html", "manabu.html", title="学ぶ", nav="manabu", laws=laws_open)
    phen_open = {p["現象ID"]: p for d in dis_open for p in d["phen"]}
    for p in phen_open.values():
        write(f"kagaku/{p['公開用の名前']}/index.html", "kagaku.html", title=p["現象名"], nav="saigai", p=p,
              pdis=[d for d in dis_open if p in d["phen"]])
    write("chiiki/index.html", "chiiki.html", title="地域", nav="chiiki")
    write("about/index.html", "about.html", title="このサイトについて", nav="")
    write("teikyo/index.html", "teikyo.html", title="知らせる・提供する", nav="")
    write("404.html", "404.html", absolute=True, title="ページが見つかりません", nav="")

    # robots.txt・sitemap・Cloudflare Pagesのヘッダー
    bots = ["GPTBot", "ChatGPT-User", "Google-Extended", "CCBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Bytespider", "Applebot-Extended", "meta-externalagent"]
    robots = "".join(f"User-agent: {b}\nDisallow: /\n\n" for b in bots) + "User-agent: *\nAllow: /\n"
    if base:
        robots += f"\nSitemap: {base}/sitemap.xml\n"
    open(os.path.join(out, "robots.txt"), "w").write(robots)
    if base:
        urls = "".join(f"<url><loc>{base}/{p[:-10] if p.endswith('index.html') else p}</loc></url>" for p in pages if p != "404.html")
        open(os.path.join(out, "sitemap.xml"), "w").write(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>')
    open(os.path.join(out, "_headers"), "w").write(
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n"
        "/static/*\n  Cache-Control: public, max-age=86400\n")

    # OGP画像（Pillowと日本語フォントがあれば作る）
    try:
        import og_image
        og_image.make_all(out, M, os.path.join(HERE, "static", "img"))
    except Exception as e:  # noqa
        print("OGP画像は作りませんでした:", e)

    print(f"{len(pages)}ページを書き出しました → {out}（公開する資料 {len(M['sources'])}件、未来への問い {len(open_q)}件、根拠カード {len(M['cards'])}枚）"
          + ("［試作モード：答えはこの端末だけに保存］" if not api else ""))


if __name__ == "__main__":
    main()
