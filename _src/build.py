#!/usr/bin/env python3
"""Static site builder for the Lunar Landing Site Navigator.

The site is deliberately build-free at runtime: Python + Jinja render plain
HTML, one CSS file and two JavaScript files.  No API keys, no external
requests in the browser.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from bs4 import BeautifulSoup
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "_src"
PAGES_DIR = SRC / "pages"
TEMPLATES = SRC / "templates"
STATIC = SRC / "static"
ASSETS = ROOT / "assets"

sys.path.insert(0, str(SRC))
from sources import SOURCES, SOURCE_MAP  # noqa: E402

BUILD_DATE = "2026-11-04"
SITE = {
    "title": "مُوجِّه مواقع الهبوط القمرية",
    "titleEn": "Lunar Landing Site Navigator",
    "desc": "دليل عربي تفاعلي لفهم تحدّي NASA Space Apps 2026: اختيار مواقع الهبوط في القطب الجنوبي للقمر، الإضاءة، الطاقة الشمسية، ورؤية الأرض.",
    "challengeUrl": "https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/",
    "dates": "14–15 نوفمبر 2026",
    "buildDate": BUILD_DATE,
}

# slug -> metadata.  `file` is relative to _src/pages.
PAGES = [
    dict(slug="index", file="index.html", nav="index", section="", hero=False, toc=False,
         title="مُوجِّه مواقع الهبوط القمرية", kicker="NASA SPACE APPS 2026",
         lead="من نص التحدي إلى قرار هندسي: دليل عربي لاختيار مواقع الهبوط في القطب الجنوبي للقمر.",
         desc="دليل عربي تفاعلي لتحدّي Lunar Landing Site Navigator: العلم، البيانات، الرياضيات، الهندسة، وتجربة المستخدم."),
    dict(slug="challenge", file="challenge.html", nav="challenge", section="A", toc=True,
         title="فهم التحدي", kicker="A · نقطة البداية",
         lead="ما الذي يطلبه التحدي بالضبط؟ ومن المستخدم؟ وما حدود ما نعرفه حتى 4 نوفمبر 2026؟",
         desc="تحليل نص تحدّي Lunar Landing Site Navigator، المستخدمين، المتطلبات، وما لم يُنشر بعد."),
    dict(slug="clps", file="clps.html", nav="clps", section="B", toc=True,
         title="CLPS والمهام", kicker="B · السياق البرنامجي",
         lead="كيف تشتري ناسا خدمات الهبوط التجاري؟ وما حالة المهام حتى تاريخ البناء؟",
         desc="شرح CLPS ومزوّديها ومهامها وحالة كل مهمة حتى 2026-11-04."),
    dict(slug="science", file="science.html", nav="science", section="C", toc=True,
         title="علم القطب الجنوبي", kicker="C · الإضاءة والظلال",
         lead="لماذا لا تشرق الشمس عند القطب كما نتوقع؟ ولماذا يصبح التضاريس هو الساعة الحقيقية؟",
         desc="علم إضاءة القطب الجنوبي للقمر، المناطق المظلمة دائمًا، الجليد، ورؤية الأرض."),
    dict(slug="power-comms", file="power-comms.html", nav="power-comms", section="D", toc=True,
         title="الطاقة والاتصالات", kicker="D · البقاء على قيد الحياة",
         lead="شمس منخفضة، ألواح شبه أفقية، أرض منخفضة، ونوافذ اتصال لا تشبه الأرض.",
         desc="حسابات الطاقة الشمسية عند القطب، ميزانية الوصلة، ونوافذ الاتصال المباشر بالأرض."),
    dict(slug="coordinates", file="coordinates.html", nav="coordinates", section="E", toc=True,
         title="الإحداثيات والزمن", kicker="E · أين ومتى؟",
         lead="خطأ واحد في الإطار أو خط الطول يهدم كل حساب. هنا نبني الأساس بدقة.",
         desc="إطارات القمر، الإحداثيات السيلينوغرافية، الإسقاط القطبي، ENU، والأزمنة."),
    dict(slug="datasets", file="datasets.html", nav="datasets", section="F", toc=True,
         title="مجموعات البيانات", kicker="F · المادة الخام",
         lead="LOLA، Diviner، LROC، Horizons، SPICE: ماذا نأخذ من كل مصدر، وبأي دقة، وبأي حدود؟",
         desc="كتالوج مصادر البيانات القمرية الرسمية، صيغها، دقتها، وطريقة الوصول إليها."),
    dict(slug="data-engineering", file="data-engineering.html", nav="data-engineering", section="G", toc=True,
         title="هندسة البيانات", kicker="G · من الملف إلى الخدمة",
         lead="كيف نحوّل تيرابايتات من البيانات إلى أفق تضاريسي يظهر في أقل من ثانية؟",
         desc="معمارية البيانات، خط الأنابيب، نموذج البيانات، التخزين، والتخزين المؤقت."),
    dict(slug="models", file="models.html", nav="models", section="H", toc=True,
         title="النماذج الحسابية", kicker="H · الرياضيات التي تقرر",
         lead="الظل ليس صورة؛ إنه تقاطع شعاع مع تضاريس. والطاقة ليست رقمًا واحدًا؛ إنها سلسلة افتراضات.",
         desc="نماذج الإضاءة، الطاقة، الحرارة، الاتصالات، المخاطر، والتحقق من عدم اليقين."),
    dict(slug="ux", file="ux.html", nav="ux", section="I", toc=True,
         title="تجربة المستخدم", kicker="I · القرار على الشاشة",
         lead="ثلاثة مستخدمين، ثلاث مهام، وواجهة واحدة يجب أن تشرح نفسها دون أن تكذب.",
         desc="تصميم تجربة مستخدم عربية RTL لاختيار مواقع الهبوط: التدفقات، العروض، والوصول."),
    dict(slug="landscape", file="landscape.html", nav="landscape", section="J", toc=True,
         title="المشهد التنافسي", kicker="J · أين نختلف؟",
         lead="ليست المشكلة غياب الأدوات؛ بل غياب أداة تجمع القرار والشرح والبيانات الحقيقية بالعربية.",
         desc="تحليل أدوات القطب الجنوبي الحالية، الفجوات، وموقع هذا المشروع بينها."),
    dict(slug="stack", file="stack.html", nav="stack", section="K", toc=True,
         title="التقنيات والبنية", kicker="K · ماذا نبني به؟",
         lead="خيارات البنية من هاكاثون 48 ساعة إلى نظام تشغيلي، مع مبرر لكل اختيار.",
         desc="مكدس تقني مقترح للهاكاثون والإنتاج: الواجهة، الخرائط، البيانات، الخلفية، والنشر."),
    dict(slug="roadmap", file="roadmap.html", nav="roadmap", section="L", toc=True,
         title="خارطة الطريق", kicker="L · 48 ساعة ثم ما بعدها",
         lead="خطة قابلة للتنفيذ، لا قائمة أمنيات: ما نبنيه أولًا، وما نؤجله، وما نحذفه عند الضغط.",
         desc="خطة تنفيذ تفاعلية من البحث إلى التسليم، مع مخاطر ومعايير قبول."),
    dict(slug="mvp", file="mvp.html", nav="mvp", section="M", toc=True,
         title="MVP مقابل المتقدم", kicker="M · ما يستحق البناء",
         lead="النسخة الدنيا ليست نسخة ناقصة؛ إنها أصغر منتج يثبت الفكرة ويصمد أمام الأسئلة.",
         desc="تعريف MVP، الميزات الأساسية والمتقدمة، حالة التنفيذ، وسيناريو عرض."),
    dict(slug="validation", file="validation.html", nav="validation", section="N", toc=True,
         title="التحقق والثقة", kicker="N · كيف نعرف أننا محقون؟",
         lead="كل رقم في هذا الموقع له اختبار، وكل افتراض له عنوان. الثقة ليست شعارًا.",
         desc="منهجية التحقق، مقارنة مع Horizons وSPICE، ميزانية الخطأ، واختبارات تفاعلية."),
    dict(slug="glossary", file="glossary.html", nav="glossary", section="O", toc=True,
         title="المسرد التفاعلي", kicker="O · لغة مشتركة",
         lead="130 مصطلحًا عربيًا وإنجليزيًا، مع تعريفات قصيرة وروابط للسياق.",
         desc="مسرد تفاعلي لـ 130 مصطلحًا في القمر والبيانات والملاحة والطاقة والاتصالات."),
    dict(slug="learn", file="learn.html", nav="learn", section="P", toc=True,
         title="مسار التعلّم", kicker="P · من الصفر إلى نموذج",
         lead="ستة وحدات، تمارين قصيرة، ومشروع ختامي يربط العلم بالكود.",
         desc="مسار تعلم منظم لفهم التحدي وبناء نموذج أولي في 12–18 ساعة."),
    dict(slug="labs", file="labs.html", nav="labs", section="", toc=False, hero=False,
         title="المختبرات التفاعلية", kicker="LABS · جرّب بنفسك",
         lead="أفق حقيقي من LOLA، شمس وأرض من Horizons، وحاسبات شفافة. لا صور مرسومة.",
         desc="15 مكوّنًا تفاعليًا: مستكشف المواقع، الأفق التضاريسي، الشمس والأرض، الطاقة، الاتصالات، والمزيد."),
    dict(slug="sources", file="sources.html", nav="sources", section="", toc=True,
         title="المصادر والمراجع", kicker="SOURCES · كل ادعاء له عنوان",
         lead="قائمة كاملة بالمصادر الرسمية والبيانات والأدوات، مع تاريخ الوصول ونوع كل مصدر.",
         desc="مصادر التحدي وCLPS وLOLA وDiviner وHorizons وSPICE، مع روابط وتاريخ الوصول."),
    dict(slug="search", file="search.html", nav="", section="", toc=False, hero=False,
         title="البحث", kicker="SEARCH", lead="ابحث في كل صفحات الموقع.",
         desc="بحث داخلي في محتوى موقع مُوجِّه مواقع الهبوط القمرية."),
]

PAGE_MAP = {p["slug"]: p for p in PAGES}

NAV = [
    {"label": "الرئيسية", "slug": "index"},
    {"label": "التحدي", "slug": "challenge", "children": ["challenge", "clps", "landscape"]},
    {"label": "العلم", "slug": "science", "children": ["science", "coordinates", "models", "power-comms"]},
    {"label": "البيانات", "slug": "datasets", "children": ["datasets", "data-engineering"]},
    {"label": "البناء", "slug": "stack", "children": ["stack", "roadmap", "mvp", "validation", "ux"]},
    {"label": "المختبرات", "slug": "labs"},
    {"label": "تعلّم", "slug": "learn", "children": ["glossary", "learn"]},
    {"label": "المصادر", "slug": "sources"},
]

TAG_MAP = {
    "O": ("official", "مصدر رسمي"),
    "D": ("data", "بيانات"),
    "E": ("assumption", "افتراض هندسي"),
    "S": ("suggestion", "اقتراح تنفيذي"),
    "H": ("hypothetical", "مثال افتراضي"),
}


def load_sites():
    p = ASSETS / "data" / "sites.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return None


def build_toc_and_content(html: str):
    soup = BeautifulSoup(html, "lxml")
    headings = []
    used = set()
    for i, h in enumerate(soup.find_all(["h2", "h3"])):
        if h.get("data-no-toc") is not None:
            continue
        if not h.get("id"):
            base = "sec"
            n = i + 1
            while f"{base}-{n}" in used:
                n += 1
            h["id"] = f"{base}-{n}"
        used.add(h["id"])
        headings.append({
            "level": int(h.name[1]),
            "id": h["id"],
            "text": h.get_text(" ", strip=True),
        })
    # wrap tables
    for table in soup.find_all("table"):
        if table.parent and "table-wrap" in (table.parent.get("class") or []):
            continue
        wrap = soup.new_tag("div")
        wrap["class"] = "table-wrap"
        table.insert_before(wrap)
        wrap.append(table)
        table["class"] = table.get("class", []) + ["data-table"]
    # lazy images
    for img in soup.find_all("img"):
        if not img.get("loading") and img.get("data-eager") is None:
            img["loading"] = "lazy"
        img["decoding"] = "async"
        if not img.get("alt"):
            img["alt"] = ""
    return soup, headings


def count_words(html: str) -> int:
    text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
    words = re.findall(r"[\u0600-\u06FF]+|[A-Za-z0-9]+", text)
    return len(words)


def citation_html(match):
    raw = match.group(1)
    # Accept both [[S2,S3]] and the more readable [[S2],[S3]].
    if not re.fullmatch(r"[\s,\[\]S\d]+", raw) or not re.search(r"S\d+", raw):
        return match.group(0)
    ids = re.findall(r"S\d+", raw)
    out = []
    for sid in ids:
        src = SOURCE_MAP.get(sid)
        if not src:
            print(f"WARNING: unknown source {sid}")
            out.append(f'<span class="cite cite-missing">[{sid}?]</span>')
            continue
        out.append(
            f'<a class="cite" href="sources.html#{sid.lower()}" '
            f'title="{src["title"]} — {src["org"]}">[{sid}]</a>'
        )
    return " ".join(out)


def expand_shorthand(html: str) -> str:
    html = re.sub(r"\[\[(.*?)\]\]", citation_html, html)
    for key, (cls, label) in TAG_MAP.items():
        html = html.replace(f"[!{key}]", f'<span class="tag tag-{cls}">{label}</span>')
    return html


def render_page(page):
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    body_src = (PAGES_DIR / page["file"]).read_text(encoding="utf-8")
    template = env.from_string(body_src)
    content = template.render(page=page, site=SITE, pages=PAGES, page_map=PAGE_MAP, nav=NAV,
                              sources=SOURCES, source_map=SOURCE_MAP, sites=load_sites())
    content = expand_shorthand(content)
    soup, toc = build_toc_and_content(content)
    content = str(soup)

    words = count_words(content)
    read_min = max(1, round(words / 180))
    cited = sorted(set(re.findall(r"\[(S\d+)\]", content)), key=lambda x: int(x[1:]))
    page = dict(page)
    page["readMin"] = read_min
    page["words"] = words
    page["sourceIds"] = cited
    page["sourceCount"] = len(cited)

    # Prev/next in the main narrative (exclude index/labs/sources/search)
    narrative = [p for p in PAGES if p["section"]]
    idx = next((i for i, p in enumerate(narrative) if p["slug"] == page["slug"]), None)
    prev_page = narrative[idx - 1] if idx not in (None, 0) else None
    next_page = narrative[idx + 1] if idx is not None and idx + 1 < len(narrative) else None

    base = env.get_template("base.html")
    html = base.render(content=Markup(content), page=page, site=SITE, pages=PAGES, page_map=PAGE_MAP,
                       nav=NAV, toc=toc, prev_page=prev_page, next_page=next_page,
                       sources=SOURCES, source_map=SOURCE_MAP, sites=load_sites())

    out = ROOT / ("index.html" if page["slug"] == "index" else f"{page['slug']}.html")
    out.write_text(html, encoding="utf-8")
    return out, soup, toc, page


def clean_search_text(text: str) -> str:
    """Strip citation markers and claim tags from search excerpts."""
    text = re.sub(r"\[\s*S\d+\s*\]", "", text)
    text = re.sub(r"\[![A-Z]\]", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def build_search_index(rendered):
    entries = []
    for slug, soup, toc, page in rendered:
        url = "index.html" if slug == "index" else f"{slug}.html"
        entries.append({
            "u": url,
            "p": page["title"],
            "h": page["title"],
            "a": "",
            "x": clean_search_text(page.get("lead", ""))[:260],
            "k": "page",
        })
        for h in soup.find_all(["h2", "h3"]):
            if h.get("data-no-toc") is not None:
                continue
            hid = h.get("id")
            if not hid:
                continue
            texts = []
            for sib in h.find_all_next():
                if sib.name in ("h2", "h3"):
                    break
                if sib.name in ("p", "li", "td", "figcaption") and sib.get_text(strip=True):
                    texts.append(sib.get_text(" ", strip=True))
                if sum(len(t) for t in texts) > 420:
                    break
            entries.append({
                "u": url,
                "p": page["title"],
                "h": clean_search_text(h.get_text(" ", strip=True)),
                "a": hid,
                "x": clean_search_text(" ".join(texts))[:420],
                "k": h.name,
            })
    (ASSETS / "data" / "search.json").write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return len(entries)


def write_sitemap():
    base = os.environ.get("SITE_URL", "").strip().rstrip("/")
    if not base:
        # No placeholder domain is invented: a sitemap needs absolute URLs.
        # Set SITE_URL (for example https://user.github.io/lunar-portal) to enable it.
        stale = ROOT / "sitemap.xml"
        if stale.exists():
            stale.unlink()
        (ROOT / "robots.txt").write_text(
            "User-agent: *\nAllow: /\n",
            encoding="utf-8",
        )
        print("sitemap: skipped (SITE_URL not set); robots.txt written without a sitemap")
        return
    base += "/"
    urls = []
    for p in PAGES:
        if p["slug"] == "search":
            continue
        loc = base + ("index.html" if p["slug"] == "index" else f"{p['slug']}.html")
        urls.append(f"  <url><loc>{loc}</loc><lastmod>{BUILD_DATE}</lastmod></url>")
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"
    (ROOT / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    (ROOT / "robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: " + base + "sitemap.xml\n", encoding="utf-8")
    print(f"sitemap: {len(urls)} URLs under {base}")


def check_links(rendered):
    errors = []
    for slug, soup, toc, page in rendered:
        fname = "index.html" if slug == "index" else f"{slug}.html"
        for tag, attr in (("a", "href"), ("img", "src"), ("script", "src"), ("link", "href")):
            for el in soup.find_all(tag):
                v = el.get(attr)
                if not v or v.startswith(("http://", "https://", "mailto:", "tel:", "data:", "#")):
                    continue
                path, _, anchor = v.partition("#")
                target = (ROOT / path).resolve()
                if not target.exists():
                    errors.append(f"{fname}: missing {v}")
                    continue
                if anchor and target.suffix == ".html":
                    tsoup = BeautifulSoup(target.read_text(encoding="utf-8"), "lxml")
                    if not tsoup.find(id=anchor):
                        errors.append(f"{fname}: missing anchor {v}")
    return errors


def verify_manifest():
    """Verify the SHA-256 manifest of the derived data products."""
    path = ASSETS / "data" / "manifest.json"
    if not path.exists():
        print("data manifest: missing")
        return False
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("data manifest: unreadable:", exc)
        return False

    errors = []
    files = manifest.get("files", [])
    for item in files:
        target = ASSETS / "data" / item.get("name", "")
        if not target.is_file():
            errors.append(f"{item.get('name')}: missing")
            continue
        if target.stat().st_size != item.get("bytes"):
            errors.append(f"{item.get('name')}: size mismatch")
            continue
        if hashlib.sha256(target.read_bytes()).hexdigest() != item.get("sha256"):
            errors.append(f"{item.get('name')}: hash mismatch")

    if errors:
        print("DATA MANIFEST ERRORS:")
        for error in errors:
            print("  -", error)
        print("  run: python3 _src/build_data.py --out assets --manifest-only")
        return False

    print(f"data manifest: {len(files)} files OK (generated {manifest.get('generated', '?')})")
    return True


def main():
    if not verify_manifest():
        sys.exit(1)

    # copy static assets
    for d in ("css", "js", "img", "fonts"):
        (ASSETS / d).mkdir(parents=True, exist_ok=True)
    for item in (STATIC / "css").glob("*"):
        shutil.copy2(item, ASSETS / "css" / item.name)
    for item in (STATIC / "js").glob("*"):
        shutil.copy2(item, ASSETS / "js" / item.name)
    for item in (STATIC / "img").glob("*"):
        shutil.copy2(item, ASSETS / "img" / item.name)
    for item in (STATIC / "fonts").glob("*"):
        shutil.copy2(item, ASSETS / "fonts" / item.name)

    # glossary data consumed by the interactive glossary lab
    glossary_src = SRC / "data" / "glossary.json"
    if glossary_src.exists():
        (ASSETS / "data").mkdir(parents=True, exist_ok=True)
        shutil.copy2(glossary_src, ASSETS / "data" / "glossary.json")
        glossary_payload = json.loads(glossary_src.read_text(encoding="utf-8"))
        n_terms = len(glossary_payload.get("terms", glossary_payload))
        print(f"glossary data: {n_terms} terms")
    else:
        print("WARNING: _src/data/glossary.json is missing; glossary lab will show an error")

    rendered = []
    for page in PAGES:
        out, soup, toc, meta = render_page(page)
        rendered.append((page["slug"], soup, toc, meta))
        print(f"built {out.relative_to(ROOT)}  ({meta['words']} words, {meta['readMin']} min, {meta['sourceCount']} sources)")

    # 404 page
    env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))
    page404 = dict(slug="404", title="الصفحة غير موجودة", kicker="404", lead="الرابط الذي تبحث عنه غير موجود.",
                   desc="404", section="", nav="", toc=False, hero=True, readMin=0, sourceCount=0)
    site_url = os.environ.get("SITE_URL", "").strip().rstrip("/")
    base = f"{site_url}/" if site_url else "/"
    html404 = env.get_template("404.html").render(page=page404, site=SITE, nav=NAV, pages=PAGES, base=base)
    (ROOT / "404.html").write_text(html404, encoding="utf-8")

    n = build_search_index(rendered)
    print(f"search index: {n} entries")
    write_sitemap()
    errors = check_links(rendered)
    if errors:
        print("\nLINK ERRORS:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("link check: OK")


if __name__ == "__main__":
    main()
