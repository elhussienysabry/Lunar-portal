/* ==========================================================================
   Lunar Landing Site Navigator — content & planning labs
   Dataset explorer, glossary, stack explorer, roadmap, quiz.
   ========================================================================== */
(function () {
  "use strict";
  const L = window.LAB;
  if (!L) return;
  const { $, $$, fmt, status, errorBox, loadingBox, clamp } = L;
  const U = window.LLSN || {};

  /* ==========================================================================
     LAB 11 — dataset format explorer
     ========================================================================== */
  const DATASETS = [
    {
      id: "lola-site01",
      name: "LOLA Site01 — Connecting Ridge, 5 m/px",
      org: "NASA GSFC PGDA / LOLA",
      type: "dem",
      typeAr: "نموذج ارتفاع رقمي",
      format: "GeoTIFF (مع ملف وصف)",
      res: "5 m/px",
      coverage: "نافذة محلية حول حافة الاتصال",
      used: "نموذج التضاريس والأفق في الموقع 01",
      limits: "نافذة محدودة، وليست خريطة للقمر كله؛ لا تُستخدم للتحقق من سلامة الهبوط.",
      url: "https://pgda.gsfc.nasa.gov/products/78",
      source: "S9",
      sample:
        '{"product":"LOLA 5m south-pole DEM","crs":"south polar stereographic","pixel_m":5,"x0_m":-19000,"y0_m":-4000,"grid":"800x800 after 4x downsample","noData":-32768}',
    },
    {
      id: "lola-site04",
      name: "LOLA Site04 — Shackleton rim, 5 m/px",
      org: "NASA GSFC PGDA / LOLA",
      type: "dem",
      typeAr: "نموذج ارتفاع رقمي",
      format: "GeoTIFF",
      res: "5 m/px",
      coverage: "نافذة حول حافة شاكليتون",
      used: "نموذج التضاريس للقمة والحافة المنخفضة",
      limits: "دقة النموذج لا تعني دقة مطلقة للارتفاع؛ لا بد من هامش خطأ.",
      url: "https://pgda.gsfc.nasa.gov/products/78",
      source: "S9",
      sample:
        '{"product":"LOLA Site04","pixel_m":5,"subset_window_km":18,"interactive_grid":"20 m/px, 800x800","elevation_datatype":"int16 metres"}',
    },
    {
      id: "lola-mosaic",
      name: "LOLA South Pole Mosaic (87°S–90°S)",
      org: "NASA GSFC PGDA",
      type: "dem",
      typeAr: "فسيفساء ارتفاع",
      format: "GeoTIFF / IMG مع وصف",
      res: "راجع صفحة المنتج — تختلف عن النوافذ المحلية",
      coverage: "القطب الجنوبي 87°–90°",
      used: "خلفية الخريطة القطبية في هذا الموقع",
      limits: "منتج مركّب؛ يجب قراءة الوصف للدقة والإصدار قبل الاستخدام العلمي.",
      url: "https://pgda.gsfc.nasa.gov/products/81",
      source: "S10",
      sample:
        '{"product":"south polar DEM mosaic","coverage":"87S..90S","crs":"polar stereographic","note":"see product label for exact resolution and version"}',
    },
    {
      id: "lola-pds",
      name: "LOLA PDS Geosciences Node — GDR",
      org: "NASA PDS / Washington University",
      type: "dem",
      typeAr: "شبكات عالمية",
      format: "IMG / JPEG2000 + detached labels",
      res: "متغيرة حسب الشبكة والمنتج",
      coverage: "القمر بأكمله، مع منتجات قطبية",
      used: "مرجع للتحقق وللبيانات خارج النوافذ المحلية",
      limits: "الأحجام كبيرة، وتنسيق PDS يحتاج قارئًا مناسبًا.",
      url: "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
      source: "S11",
      sample:
        'PDS4 label:\n  product_id = LRO-L-LOLA-4-GDR-V1.0\n  axes = 2\n  object = IMAGE\n  note = read the detached .LBL before parsing the .IMG',
    },
    {
      id: "diviner",
      name: "Diviner Lunar Radiometer — PDS",
      org: "NASA PDS / UCLA",
      type: "thermal",
      typeAr: "بيانات حرارية",
      format: "جداول PDS / شبكات حرارية",
      res: "تختلف حسب المنتج",
      coverage: "القمر، بما فيه القطب الجنوبي",
      used: "سياق علمي لدرجات الحرارة والظلال — لا يُستخدم في حسابات هذا الموقع",
      limits: "لا تخلط بين درجة حرارة السطح ودرجة حرارة الهواء؛ القمر لا يملك غلافًا جويًا.",
      url: "https://pds-geosciences.wustl.edu/missions/lro/diviner.htm",
      source: "S13",
      sample:
        '{"product":"Diviner derived products","variables":["brightness temperature","bolometric temperature"],"note":"product resolution varies; consult label"}',
    },
    {
      id: "horizons",
      name: "JPL Horizons — observer ephemerides",
      org: "NASA JPL",
      type: "ephem",
      typeAr: "تقويم فلكي",
      format: "نص / CSV / JSON عبر الواجهة أو API",
      res: "خطوة زمنية يختارها المستخدم (ساعة هنا)",
      coverage: "أي موقع على القمر، 2026-11-01 إلى 2027-11-01",
      used: "مواضع الشمس والأرض الساعية لثلاث نقاط",
      limits: "مواضع هندسية طوبوغرافية؛ لا تتضمن حجب التضاريس تلقائيًا. يجب دمجها مع DEM.",
      url: "https://ssd.jpl.nasa.gov/horizons/manual.html",
      source: "S14,S15",
      sample:
        'Date (UTC)        Sun_Az  Sun_El  Earth_Az  Earth_El\n2026-11-01 00:00  62.3    1.72    141.1     2.50\n2026-11-01 01:00  61.8    1.72    141.1     2.44',
    },
    {
      id: "spice",
      name: "NAIF SPICE — kernels and frames",
      org: "NASA NAIF",
      type: "kernel",
      typeAr: "نوى هندسية",
      format: "BSP / TF / TPC / TSP",
      res: "يعتمد على النواة",
      coverage: "هندسة القمر والأرض والشمس والإطارات",
      used: "مرجع للتحقق من الإطارات والتحويلات (لم نشغّل SpiceyPy هنا)",
      limits: "يحتاج إدارة نوى وإصدارات؛ خطأ نواة واحد يفسد النتائج.",
      url: "https://naif.jpl.nasa.gov/naif/tutorials.html",
      source: "S16,S17",
      sample:
        "KPL/FK moon_080317.tf\n  FRAME_MOON_ME          = 31006\n  TKFRAME_31006_RELATIVE = 'MOON_PA'\n  TKFRAME_31006_ANGLES   = ( ... )",
    },
    {
      id: "svs",
      name: "SVS — Illumination at the Moon’s South Pole",
      org: "NASA Scientific Visualization Studio",
      type: "product",
      typeAr: "منتج مرئي",
      format: "صور / فيديو / بيانات مصاحبة",
      res: "حسب المنتج",
      coverage: "القطب الجنوبي، 2023–2030",
      used: "سياق تعليمي ومقارنة بصرية",
      limits: "منتج توضيحي وليس بديلًا عن حساب الأفق المحلي بدقة.",
      url: "https://svs.gsfc.nasa.gov/4930/",
      source: "S33,S34",
      sample:
        '{"product":"illumination visualization","time_span":"2023-2030","type":"rendered product","note":"not a substitute for local horizon geometry"}',
    },
    {
      id: "lroc",
      name: "LROC QuickMap — imagery basemaps",
      org: "Arizona State University / NASA",
      type: "image",
      typeAr: "صور مدارية",
      format: "خرائط ويب / صور قابلة للتنزيل",
      res: "NAC عالي الدقة، WAC أوسع",
      coverage: "القمر، مع تغطية قطبية",
      used: "مرجع بصري للفوهات والحافات",
      limits: "الصورة لا تُعطي ارتفاعًا مباشرًا؛ استخدم DEM منفصلًا.",
      url: "https://quickmap.lroc.asu.edu/",
      source: "S29",
      sample:
        '{"tool":"LROC QuickMap","layers":["NAC","WAC","topography"],"use":"visual cross-check, not elevation source"}',
    },
  ];

  function initDatasets() {
    const root = $("#lab-datasets");
    if (!root) return;
    const list = $("#dsList");
    const detail = $("#dsDetail");
    const filterBox = $("#dsFilters");
    let current = DATASETS[0];
    const typeOrder = ["all", "dem", "ephem", "thermal", "kernel", "product", "image"];
    const typeLabels = { all: "الكل", dem: "تضاريس", ephem: "فلك", thermal: "حراري", kernel: "SPICE", product: "منتجات", image: "صور" };
    if (filterBox) {
      typeOrder.forEach((t, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = typeLabels[t];
        if (i === 0) b.classList.add("is-active");
        b.dataset.dstype = t;
        b.addEventListener("click", () => {
          $$("button", filterBox).forEach((x) => x.classList.toggle("is-active", x === b));
          renderList(t);
        });
        filterBox.appendChild(b);
      });
    }
    function renderList(type) {
      list.innerHTML = "";
      const items = DATASETS.filter((d) => type === "all" || d.type === type);
      items.forEach((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "card";
        b.style.cssText = "display:block;width:100%;text-align:right;cursor:pointer;padding:12px;margin-bottom:8px";
        if (d === current) b.style.borderColor = "rgba(90,216,230,.45)";
        b.innerHTML =
          '<span class="card-kicker">' +
          d.typeAr +
          '</span><h3 style="font-size:13px;margin:3px 0">' +
          d.name +
          '</h3><p style="font-size:10.5px;margin:0;color:var(--dim)">' +
          d.format +
          " · " +
          d.res +
          "</p>";
        b.addEventListener("click", () => {
          current = d;
          renderList(type);
          showDetail(d);
        });
        list.appendChild(b);
      });
      if (!items.length) list.innerHTML = '<div class="glossary-empty">لا مجموعات في هذا التصنيف.</div>';
    }
    function showDetail(d) {
      const srcLinks = d.source
        .split(",")
        .map((s) => '<a class="cite" href="sources.html#' + s.toLowerCase() + '">[' + s + "]</a>")
        .join(" ");
      detail.innerHTML =
        '<div class="card" style="margin:0">' +
        '<span class="card-kicker">' +
        d.typeAr +
        "</span><h3 style='font-size:16px;margin:4px 0 8px'>" +
        d.name +
        "</h3>" +
        '<p style="font-size:12px;color:var(--muted);margin:0 0 8px">' +
        d.org +
        "</p>" +
        '<dl class="kv" style="margin:8px 0;grid-template-columns:84px 1fr"><dt>الصيغة</dt><dd>' +
        d.format +
        "</dd><dt>الدقة</dt><dd>" +
        d.res +
        "</dd><dt>التغطية</dt><dd>" +
        d.coverage +
        "</dd><dt>استخدامنا</dt><dd>" +
        d.used +
        "</dd><dt>الحدود</dt><dd>" +
        d.limits +
        "</dd></dl>" +
        '<p style="font-size:10.5px;color:var(--dim);margin:2px 0 8px">مثال توضيحي للبنية، وليس محتوى ملف حقيقيًا.</p>' +
        "<pre style='margin:0;font-size:10px;max-height:170px;overflow:auto;direction:ltr;text-align:left'><code></code></pre>" +
        '<p style="margin:10px 0 0;font-size:11px">' +
        srcLinks +
        ' · <a href="' +
        d.url +
        '" target="_blank" rel="noopener">صفحة الوصول الرسمية ↗</a></p>' +
        "</div>";
      detail.querySelector("code").textContent = d.sample;
      if ($("#dsStatus")) status($("#dsStatus"), "9 مجموعات موثقة · عرض: " + d.name);
    }
    renderList("all");
    showDetail(current);
  }

  /* ==========================================================================
     LAB 12 — searchable glossary (data loaded from JSON)
     ========================================================================== */
  function initGlossary() {
    const root = $("#lab-glossary");
    if (!root) return;
    const input = $("#glossarySearch");
    const cat = $("#glossaryCat");
    const grid = $("#glossaryGrid");
    const count = $("#glossaryCount");
    const empty = $("#glossaryEmpty");
    const statusEl = $("#glossaryStatus");
    let terms = [];
    loadingBox($("#glossaryLoading"), "جارٍ تحميل المسرد…");
    U.fetchJSON("assets/data/glossary.json")
      .then((data) => {
        terms = (data.terms || data).slice().sort((a, b) => a.ar.localeCompare(b.ar, "ar"));
        const cats = Array.from(new Set(terms.map((t) => t.cat)));
        cat.innerHTML = "";
        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = "كل التصنيفات";
        cat.appendChild(allOpt);
        cats.forEach((c) => {
          const o = document.createElement("option");
          o.value = c;
          o.textContent = c;
          cat.appendChild(o);
        });
        render();
        input.addEventListener("input", render);
        cat.addEventListener("change", render);
        if (statusEl) status(statusEl, terms.length + " مصطلحًا · مصادر LOLA/NASA/SPICE");
        const lb = $("#glossaryLoading");
        if (lb) lb.innerHTML = "";
      })
      .catch((e) => errorBox($("#glossaryLoading"), e.message));

    function render() {
      const q = U.normalize ? U.normalize(input.value) : input.value.toLowerCase();
      const c = cat.value;
      const filtered = terms.filter((t) => {
        if (c !== "all" && t.cat !== c) return false;
        if (!q) return true;
        const hay = (t.ar + " " + t.en + " " + t.def).toLowerCase();
        return U.normalize ? U.normalize(hay).indexOf(q) !== -1 : hay.indexOf(q) !== -1;
      });
      grid.innerHTML = "";
      filtered.forEach((t) => {
        const card = document.createElement("div");
        card.className = "term";
        const h = document.createElement("h3");
        h.textContent = t.ar;
        const en = document.createElement("span");
        en.className = "en";
        en.textContent = t.en;
        const p = document.createElement("p");
        p.textContent = t.def;
        const cc = document.createElement("span");
        cc.className = "cat";
        cc.textContent = t.cat;
        card.append(h, en, p, cc);
        grid.appendChild(card);
      });
      empty.hidden = filtered.length > 0;
      count.textContent = filtered.length + " / " + terms.length;
      if (statusEl) status(statusEl, filtered.length + " نتيجة من " + terms.length + " مصطلحًا");
    }
  }

  /* ==========================================================================
     LAB 13 — technology stack explorer
     ========================================================================== */
  const STACK = [
    { id: "html", name: "HTML + CSS + JavaScript", ar: "الواجهة الساكنة", layer: "الواجهة", phase: "both", used: true, role: "بناء موقع بلا اعتماد على أطر عمل ثقيلة.", why: "سرعة، وصول، وسهولة نشر في 48 ساعة.", risk: "إعادة بناء مكوّنات جاهزة يدويًا." },
    { id: "jinja", name: "Python + Jinja2", ar: "مولّد الصفحات", layer: "البناء", phase: "both", used: true, role: "قوالب عربية موحّدة، فهرس بحث، وفحص روابط.", why: "يفصل المحتوى عن التصميم ويُنتج HTML ثابتًا.", risk: "خطوة بناء إضافية قبل النشر." },
    { id: "canvas", name: "Canvas 2D API", ar: "رسوم تفاعلية", layer: "الواجهة", phase: "both", used: true, role: "البانوراما، المقاطع، الرسوم البيانية، والخريطة القطبية.", why: "أداء جيد وأبعاد مضبوطة دون مكتبات.", risk: "اختبار الاتجاه RTL والطباعة اليدوي." },
    { id: "maplibre", name: "MapLibre GL JS", ar: "خرائط متجهية", layer: "الخرائط", phase: "prod", used: false, role: "خريطة تفاعلية ثلاثية الأبعاد مع تضاريس.", why: "بديل مفتوح المصدر لخرائط الويب الثقيلة.", risk: "يحتاج tiles وإعدادًا أكبر من ميزانية الهاكاثون." },
    { id: "leaflet", name: "Leaflet", ar: "خريطة خفيفة", layer: "الخرائط", phase: "hack", used: false, role: "عرض صور/طبقات بسيطة فوق خريطة.", why: "أسرع خيار لإضافة تكبير وتحريك.", risk: "ليس الأمثل للتضاريس ثلاثية الأبعاد." },
    { id: "cog", name: "Cloud Optimized GeoTIFF", ar: "تضاريس قابلة للقراءة", layer: "البيانات", phase: "prod", used: false, role: "قراءة نوافذ DEM دون تنزيل الملف كاملًا.", why: "يقلل زمن التحميل والذاكرة.", risk: "يحتاج استضافة تدعم Range requests." },
    { id: "pmtiles", name: "PMTiles", ar: "حزم بلاطات", layer: "البيانات", phase: "prod", used: false, role: "توزيع بلاطات خرائط/Terrain-RGB كملف واحد.", why: "نشر بسيط وبلا خادم بلاطات معقد.", risk: "أدوات إنتاج البلاطات وتحديثها." },
    { id: "sqlite", name: "SQLite / DuckDB", ar: "تحليل محلي", layer: "البيانات", phase: "hack", used: false, role: "استعلام سريع على ملايين صفوف ephemeris محليًا.", why: "بلا خادم، وسهل النسخ.", risk: "لا يصلح لكتّاب متعددين في الإنتاج." },
    { id: "postgis", name: "PostgreSQL + PostGIS", ar: "قاعدة مكانية", layer: "البيانات", phase: "prod", used: false, role: "فهارس مكانية وزمنية للمواقع والنوافذ.", why: "معيار ناضج للاستعلامات المكانية.", risk: "تشغيل وصيانة قاعدة بيانات." },
    { id: "fastapi", name: "FastAPI", ar: "واجهة برمجية", layer: "الخلفية", phase: "prod", used: false, role: "خدمة حساب الأفق والطاقة والاتصالات.", why: "Python سريع التطوير مع توثيق OpenAPI.", risk: "حاجة إلى تخزين مؤقت وحدود معدل." },
    { id: "static-json", name: "Precomputed JSON", ar: "ملفات محسوبة", layer: "البيانات", phase: "hack", used: true, role: "sites، ephemeris، daily، search، glossary.", why: "صفر زمن استجابة خلفي، ويعمل دون مفاتيح.", risk: "تحديث البيانات يحتاج إعادة بناء." },
    { id: "spice", name: "SPICE / SpiceyPy", ar: "هندسة دقيقة", layer: "العلم", phase: "prod", used: false, role: "تحويل الإطارات وحساب مواضع عالية الدقة.", why: "المعيار المستخدم في الملاحة الكوكبية.", risk: "إدارة النوى والتحقق منها." },
    { id: "horizons", name: "JPL Horizons", ar: "مرجع فلكي", layer: "العلم", phase: "both", used: true, role: "مصدر مواضع الشمس والأرض، مسبق الحساب.", why: "موثوق ومجاني ويمكن أرشفته.", risk: "الاتصال المباشر هش داخل الهاكاثون." },
    { id: "python", name: "NumPy + Pillow", ar: "معالجة التضاريس", layer: "البيانات", phase: "both", used: true, role: "قراءة DEM، بناء الأفق، وتوليد الصور.", why: "متاحان افتراضيًا وسريعان للنوافذ المحلية.", risk: "الملفات الكبيرة تحتاج ذاكرة." },
    { id: "playwright", name: "Playwright", ar: "اختبار المتصفح", layer: "التحقق", phase: "prod", used: false, role: "اختبار التنقل، البحث، والمختبرات.", why: "أتمتة سيناريوهات المستخدم الحقيقية.", risk: "وقت إعداد داخل الهاكاثون." },
    { id: "pytest", name: "pytest", ar: "اختبار الحسابات", layer: "التحقق", phase: "both", used: false, role: "اختبارات تحويل الإحداثيات والأفق والميزانيات.", why: "بسيط وقابل للتشغيل في CI.", risk: "يجب كتابة حالات مرجعية صحيحة." },
    { id: "gh-pages", name: "GitHub Pages / Netlify", ar: "استضافة ساكنة", layer: "النشر", phase: "hack", used: false, role: "نشر الموقع في دقائق.", why: "بلا خادم وبلا تكلفة.", risk: "حدود على الملفات الكبيرة والتحليلات." },
    { id: "cdn", name: "CDN + Object Storage", ar: "توزيع المحتوى", layer: "النشر", phase: "prod", used: false, role: "توزيع DEM والصور والبلاطات.", why: "زمن تحميل منخفض عالميًا.", risk: "تكلفة نطاق ترددي وتكوين تخزين مؤقت." },
    { id: "webworker", name: "Web Workers + WASM", ar: "حساب في المتصفح", layer: "الواجهة", phase: "prod", used: false, role: "حساب الأفق دون تجميد الواجهة.", why: "يبقي التفاعل سلسًا مع DEM أكبر.", risk: "تعقيد بناء ونقل الذاكرة." },
  ];

  function initStack() {
    const root = $("#lab-stack");
    if (!root) return;
    const grid = $("#stackGrid");
    const filters = $("#stackFilters");
    const count = $("#stackCount");
    let phase = "all";
    if (filters) {
      [
        ["all", "الكل"],
        ["hack", "الهاكاثون"],
        ["prod", "الإنتاج"],
      ].forEach(([k, label], i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.dataset.stackphase = k;
        if (i === 0) b.classList.add("is-active");
        b.addEventListener("click", () => {
          phase = k;
          $$("button", filters).forEach((x) => x.classList.toggle("is-active", x === b));
          render();
        });
        filters.appendChild(b);
      });
    }
    function render() {
      const items = STACK.filter((s) => phase === "all" || s.phase === phase || s.phase === "both");
      grid.innerHTML = "";
      items.forEach((s) => {
        const card = document.createElement("div");
        card.className = "card" + (s.used ? " accent" : "");
        card.innerHTML =
          '<span class="card-kicker">' +
          s.layer +
          " · " +
          (s.phase === "both" ? "المرحلتان" : s.phase === "hack" ? "هاكاثون" : "إنتاج") +
          "</span><h3 style='font-size:15px;margin:5px 0 2px'>" +
          s.name +
          "</h3><p style='font-size:11px;color:var(--cyan);margin:0 0 6px'>" +
          s.ar +
          "</p><p style='font-size:11.5px;margin:0 0 6px'>" +
          s.role +
          "</p><p style='font-size:10.5px;color:var(--dim);margin:0 0 4px'><b style='color:var(--muted)'>لماذا:</b> " +
          s.why +
          "</p><p style='font-size:10.5px;color:var(--dim);margin:0'><b style='color:var(--muted)'>الخطر:</b> " +
          s.risk +
          "</p><p style='margin:8px 0 0'><span class='tag " +
          (s.used ? "tag-official" : "tag-suggestion") +
          "'>" +
          (s.used ? "مستخدم في هذا الموقع" : "اقتراح") +
          "</span></p>";
        grid.appendChild(card);
      });
      if (count) count.textContent = items.length + " عنصرًا معروضًا من " + STACK.length;
    }
    render();
  }

  /* ==========================================================================
     LAB 14 — interactive roadmap
     ========================================================================== */
  const ROADMAP = [
    { id: "r1", phase: "pre", title: "قراءة نص التحدي والموارد الرسمية", detail: "لا تفترض المتطلبات؛ اقرأ صفحة التحدي وتبويب الموارد عند نشرها.", effort: "2h", prio: "must" },
    { id: "r2", phase: "pre", title: "تثبيت مصادر البيانات وتراخيصها", detail: "LOLA/PGDA، Horizons، SPICE، وأي صور. سجّل تاريخ الوصول ورابط كل مصدر.", effort: "3h", prio: "must" },
    { id: "r3", phase: "pre", title: "بناء عينة بيانات صغيرة ثلاثية المواقع", detail: "نافذة DEM واحدة و365 يومًا من ephemeris؛ لا تحمّل القمر كله.", effort: "4h", prio: "must" },
    { id: "r4", phase: "pre", title: "تعريف المقاييس والوحدات", detail: "درجات، ساعات UTC، نسب مئوية، واط، dB. اكتب تعريف كل مقياس.", effort: "1h", prio: "must" },
    { id: "r5", phase: "pre", title: "رسم ثلاثة تدفقات مستخدم", detail: "مخطط مهمة، معلم، وعامي. لكل تدفق قرار واحد واضح.", effort: "2h", prio: "should" },
    { id: "r6", phase: "pre", title: "إعداد مسرد عربي إنجليزي", detail: "80 مصطلحًا على الأقل مع تعريف قصير؛ استخدمه في كل الصفحات.", effort: "2h", prio: "should" },
    { id: "r7", phase: "hack", title: "هيكل الموقع والتنقل والبحث", detail: "صفحات ثابتة، RTL، بحث محلي، وحالات تحميل/خطأ.", effort: "3h", prio: "must" },
    { id: "r8", phase: "hack", title: "مستكشف المواقع الحقيقي", detail: "ثلاث نقاط مع خريطة، أرقام إضاءة/أرض، ورسم شهري.", effort: "3h", prio: "must" },
    { id: "r9", phase: "hack", title: "بانوراما الأفق والشمس والأرض", detail: "أفق 360°، مؤشرات الشمس والأرض، وشريط زمني.", effort: "4h", prio: "must" },
    { id: "r10", phase: "hack", title: "مقطع الشمس وحاسبة الطاقة", detail: "ارتفاع الشمس، الحجب، وميزانية مبسطة بافتراضات معلنة.", effort: "3h", prio: "must" },
    { id: "r11", phase: "hack", title: "رؤية الأرض وميزانية الوصلة", detail: "نوافذ سنوية، هامش فوق الأفق، FSPL وEb/N0.", effort: "3h", prio: "must" },
    { id: "r12", phase: "hack", title: "مقارنة السيناريوهات", detail: "أوزان وقيود وترتيب شفاف — مع تحذير أنه ليس توصية رسمية.", effort: "2h", prio: "should" },
    { id: "r13", phase: "hack", title: "الخريطة القطبية ومحول الإحداثيات", detail: "نقر لاختيار نقطة، تحويل ذهابًا وإيابًا، وتغطية DEM.", effort: "2h", prio: "should" },
    { id: "r14", phase: "hack", title: "اختبار الجوال والوصول", detail: "تباين، لوحة مفاتيح، تسميات ARIA، وأحجام لمس.", effort: "2h", prio: "must" },
    { id: "r15", phase: "hack", title: "سكربت تحقق آلي", detail: "تحويلات إحداثيات، حدود الأفق، وروابط الصفحات.", effort: "2h", prio: "should" },
    { id: "r16", phase: "hack", title: "سيناريو عرض 3 دقائق", detail: "مشكلة → قرار → دليل → حدّ. جهّز لقطات احتياطية.", effort: "1h", prio: "must" },
    { id: "r17", phase: "hack", title: "نسخة احتياطية دون اتصال", detail: "فيديو قصير ولقطات شاشة إن فشل الإنترنت أو الخادم.", effort: "1h", prio: "must" },
    { id: "r18", phase: "post", title: "استبدال الافتراضات بنماذج مؤهلة", detail: "تعرض الشمس/الأرض من SPICE، وميل/خشونة من DEM أعلى دقة.", effort: "2–3 weeks", prio: "must" },
    { id: "r19", phase: "post", title: "إدخال موقع مخصص وDEM", detail: "رفع نافذة DEM، التحقق من الإسقاط، وبناء الأفق على الخادم.", effort: "2 weeks", prio: "should" },
    { id: "r20", phase: "post", title: "مراجعة علمية مستقلة", detail: "خبير ملاحة/علوم قمرية يراجع المعادلات والافتراضات.", effort: "1 week", prio: "must" },
    { id: "r21", phase: "post", title: "نشر ومراقبة", detail: "نطاق، CDN، حدود معدل، وخصوصية تحليلات.", effort: "3 days", prio: "should" },
    { id: "r22", phase: "post", title: "اختبار مع معلمين ومخططين", detail: "5–8 جلسات استخدام؛ راقب المهام لا الإعجاب.", effort: "2 weeks", prio: "should" },
  ];

  function initRoadmap() {
    const root = $("#lab-roadmap");
    if (!root) return;
    const list = $("#rmList");
    const bar = $("#rmBar");
    const label = $("#rmCount");
    const reset = $("#rmReset");
    const filters = $("#rmFilters");
    const key = "llsn-roadmap-v1";
    let phase = "all";
    let done = {};
    try {
      done = JSON.parse(localStorage.getItem(key) || "{}");
    } catch (e) {
      done = {};
    }
    function save() {
      try {
        localStorage.setItem(key, JSON.stringify(done));
      } catch (e) {
        /* storage may be unavailable; in-memory still works */
      }
    }
    if (filters) {
      [
        ["all", "كل المراحل"],
        ["pre", "قبل الهاكاثون"],
        ["hack", "48 ساعة"],
        ["post", "بعد الهاكاثون"],
      ].forEach(([k, t], i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = t;
        b.dataset.rmphase = k;
        if (i === 0) b.classList.add("is-active");
        b.addEventListener("click", () => {
          phase = k;
          $$("button", filters).forEach((x) => x.classList.toggle("is-active", x === b));
          render();
        });
        filters.appendChild(b);
      });
    }
    if (reset)
      reset.addEventListener("click", () => {
        done = {};
        save();
        render();
        if ($("#rmStatus")) L.status($("#rmStatus"), "أُعيد ضبط قائمة المهام.");
      });
    function render() {
      const items = ROADMAP.filter((r) => phase === "all" || r.phase === phase);
      list.innerHTML = "";
      items.forEach((r) => {
        const row = document.createElement("div");
        row.className = "rm-item" + (done[r.id] ? " done" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = "rm-" + r.id;
        cb.checked = !!done[r.id];
        cb.addEventListener("change", () => {
          done[r.id] = cb.checked;
          save();
          row.classList.toggle("done", cb.checked);
          updateProgress();
        });
        const lab = document.createElement("label");
        lab.htmlFor = cb.id;
        const b = document.createElement("b");
        b.textContent = r.title;
        const sp = document.createElement("span");
        sp.textContent = r.detail;
        lab.append(b, sp);
        const tag = document.createElement("span");
        tag.className = "rm-tag";
        tag.textContent = r.effort + " · " + (r.prio === "must" ? "ضروري" : "مستحسن");
        row.append(cb, lab, tag);
        list.appendChild(row);
      });
      updateProgress();
    }
    function updateProgress() {
      const n = ROADMAP.filter((r) => done[r.id]).length;
      const pct = Math.round((n / ROADMAP.length) * 100);
      if (bar) bar.style.width = pct + "%";
      if (label) label.textContent = n + " / " + ROADMAP.length + " مهمة (" + pct + "%)";
    }
    render();
  }

  /* ==========================================================================
     LAB 15 — knowledge check
     ========================================================================== */
  const QUIZ = [
    {
      q: "لماذا تبدو الشمس منخفضة دائمًا عند القطب الجنوبي للقمر؟",
      options: [
        "لأن القمر بعيد جدًا عن الشمس",
        "لأن محور القمر شبه عمودي على مستوى مداره، والشمس تبقى قرب الأفق",
        "لأن القطب الجنوبي يقع في ظل الأرض",
        "لأن القمر لا يدور حول نفسه",
      ],
      a: 1,
      why: "محور القمر يميل نحو 1.5° فقط بالنسبة لمستوى مداره، لذا من القطب تكون الشمس قرب الأفق على مدار الشهر القمري.",
    },
    {
      q: "ما الذي يحدد رؤية الشمس عند نقطة قطبية بدقة أكبر من ارتفاع الشمس وحده؟",
      options: ["المسافة إلى الأرض", "لون التربة", "أفق التضاريس المحلي", "سرعة الرياح"],
      a: 2,
      why: "عندما تكون الشمس على ارتفاع 1–2°، فإن أي حافة أعلى من ذلك في اتجاهها تحجبها. الأفق المحلي هو الفيصل.",
    },
    {
      q: "ماذا يعني أن بيانات Horizons «طوبوغرافية» (topocentric)؟",
      options: [
        "أنها محسوبة من مركز القمر",
        "أنها محسوبة من موقع الراصد على السطح",
        "أنها تتضمن الغلاف الجوي",
        "أنها تعطي الحرارة لا الموضع",
      ],
      a: 1,
      why: "topocentric تعني أن الراصد عند نقطة محددة، لا عند مركز الجسم. وهذا ضروري لفروق الأفق الصغيرة.",
    },
    {
      q: "لماذا لا تكون الألواح الشمسية الأفقية فعالة عند القطب؟",
      options: [
        "لأن الشمس حارة جدًا",
        "لأن الشمس منخفضة جدًا، وزاوية سقوط الضوء على السطح الأفقي قريبة من 90°",
        "لأن الغبار يغطيها فورًا",
        "لأن الطاقة الشمسية لا تصل إلى القطب",
      ],
      a: 1,
      why: "سطوع الشمس موجود، لكن الهندسة سيئة: الأشعة شبه موازية للسطح. الألواح العمودية أو المتتبعة للسمت أفضل بكثير.",
    },
    {
      q: "أي عبارة عن رؤية الأرض من القطب صحيحة؟",
      options: [
        "الأرض ظاهرة دائمًا بنسبة 100%",
        "رؤية الأرض تتغير مع الليبراسيون والتضاريس، وليست ثابتة",
        "الأرض لا تُرى أبدًا من القمر",
        "رؤية الأرض تعتمد على طقس القمر",
      ],
      a: 1,
      why: "ليبراسيون الأرض (±6.7° تقريبًا) يحرّك الأرض في السماء، والتضاريس قد تحجبها. النسبة تختلف بشدة بين نقطة وأخرى.",
    },
    {
      q: "ما الفرق الأساسي بين خط العرض الكوكبي المركز والكوكبي الجغرافي؟",
      options: [
        "لا فرق إطلاقًا",
        "المركزي يعرّف بالمستوى عبر المركز، والجغرافي يعرّف بالمستوى المماس للسطح",
        "الجغرافي يستخدم فقط للأرض",
        "المركزي يُقاس بالكيلومترات",
      ],
      a: 1,
      why: "لأن القمر ليس كرة مثالية، يختلف خط العرض الجغرافي عن المركزي. SPICE توفر تحويلات بين الإطارين.",
    },
    {
      q: "لماذا لا نضيف انكسارًا جويًا عند حساب الأفق القمري؟",
      options: [
        "لأن الانكسار صغير جدًا في الفراغ",
        "لأن الغلاف الجوي القمري ضئيل جدًا، فلا انكسار مؤثر",
        "لأن الانكسار يحدث فقط ليلًا",
        "لأن ناسا تمنع استخدامه",
      ],
      a: 1,
      why: "القمر بلا غلاف جوي مؤثر؛ الأفق هندسي بحت، ويحدده التضاريس وانحناء السطح.",
    },
    {
      q: "أي عامل يجعل مقارنة موقعين «قطبيين» غير كافية بأرقام سنوية فقط؟",
      options: [
        "طول السنة القمرية",
        "توزيع فترات الظلام والاتصال ومدتها القصوى، لا المتوسط فقط",
        "درجة حرارة الشمس",
        "لون البازلت",
      ],
      a: 1,
      why: "المتوسط السنوي يخفي نافذة ظلام واحدة طويلة قد تقتل المهمة. يجب عرض التتابع الزمني وأطول انقطاع.",
    },
  ];

  function initQuiz() {
    const root = $("#lab-quiz");
    if (!root) return;
    const form = $("#quizForm");
    const result = $("#quizResult");
    const retry = $("#quizRetry");
    function render() {
      form.innerHTML = "";
      QUIZ.forEach((q, qi) => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.marginBottom = "10px";
        const h = document.createElement("h3");
        h.style.fontSize = "14px";
        h.textContent = (qi + 1) + ". " + q.q;
        card.appendChild(h);
        const opts = document.createElement("div");
        opts.style.cssText = "display:grid;gap:5px;margin-top:8px";
        q.options.forEach((o, oi) => {
          const lab = document.createElement("label");
          lab.style.cssText = "display:flex;gap:7px;align-items:flex-start;font-size:12px;color:var(--muted);cursor:pointer";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "q" + qi;
          radio.value = oi;
          radio.style.marginTop = "3px";
          const span = document.createElement("span");
          span.textContent = o;
          lab.append(radio, span);
          opts.appendChild(lab);
        });
        const fb = document.createElement("div");
        fb.className = "quiz-fb";
        fb.id = "qfb-" + qi;
        fb.style.cssText = "display:none;margin-top:7px;font-size:11px;color:var(--dim);line-height:1.6";
        card.append(opts, fb);
        form.appendChild(card);
      });
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "btn btn-primary";
      submit.textContent = "احسب النتيجة";
      form.appendChild(submit);
      if (retry) retry.hidden = true;
      result.innerHTML = "";
    }
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      let score = 0;
      QUIZ.forEach((q, qi) => {
        const chosen = form.querySelector('input[name="q' + qi + '"]:checked');
        const fb = $("#qfb-" + qi);
        if (fb) {
          fb.style.display = "block";
          if (chosen && +chosen.value === q.a) {
            score++;
            fb.innerHTML = '<span class="green">✓ صحيح.</span> ' + q.why;
          } else {
            const correct = q.options[q.a];
            fb.innerHTML = '<span class="red">✕ الإجابة الصحيحة: ' + correct + ".</span> " + q.why;
          }
        }
      });
      $$('input[type="radio"]', form).forEach((r) => (r.disabled = true));
      const sub = form.querySelector('button[type="submit"]');
      if (sub) sub.disabled = true;
      result.innerHTML =
        '<div class="callout ' +
        (score >= 7 ? "ok" : score >= 5 ? "warn" : "danger") +
        '"><span class="co-title">النتيجة</span><b style="font-size:22px;font-family:var(--font-mono)">' +
        score +
        " / " +
        QUIZ.length +
        "</b> — " +
        (score >= 7 ? "فهم قوي للأساسيات." : score >= 5 ? "أساس جيد؛ راجع الأفق والطاقة." : "ابدأ بمسار التعلّم ثم أعد المحاولة.") +
        "</div>";
      if (retry) retry.hidden = false;
      L.status($("#quizStatus"), "تم التصحيح · " + score + "/" + QUIZ.length);
    });
    if (retry)
      retry.addEventListener("click", () => {
        render();
        L.status($("#quizStatus"), "اختبار جديد");
      });
    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initDatasets();
    initGlossary();
    initStack();
    initRoadmap();
    initQuiz();
  });
})();
