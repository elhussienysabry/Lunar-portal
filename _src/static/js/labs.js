/* ==========================================================================
   Lunar Landing Site Navigator — core lab helpers + science labs
   Requires app.js (window.LLSN) loaded first.
   ========================================================================== */
(function () {
  "use strict";

  const U = window.LLSN || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const C = {
    cyan: "#5ad8e6",
    cyan2: "#25b4c7",
    blue: "#5c8dff",
    green: "#5ee0a0",
    amber: "#ffb454",
    red: "#ff7373",
    violet: "#b39dff",
    text: "#e8f2fb",
    muted: "#91a9c2",
    dim: "#647c93",
    grid: "rgba(90,216,230,.12)",
    panel: "#07111c",
    dark: "#05090f",
  };
  const R_MOON = 1737.4; // km
  const SUN_R = 0.266;
  const EARTH_R = 0.95;
  const MONTHS = ["نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر"];
  const MONTHS_SHORT = ["نوف", "ديس", "جان", "فيف", "مار", "أبر", "ماي", "جون", "جوي", "أوت", "سبت", "أكت"];
  const redraws = [];
  let resizeTimer = null;

  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    const n = Math.abs(v) >= 1000 && d === 0 ? Math.round(v) : v;
    return n.toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 1 : d, maximumFractionDigits: d === undefined ? 1 : d });
  }
  function signed(v, d) {
    if (!isFinite(v)) return "—";
    return (v >= 0 ? "+" : "−") + fmt(Math.abs(v), d === undefined ? 2 : d) + "°";
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function azNorm(a) {
    return ((a % 360) + 360) % 360;
  }
  function fit(canvas) {
    if (!canvas) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(220, Math.floor(canvas.clientWidth || canvas.parentElement.clientWidth || 640));
    const h = Math.max(140, Math.floor(canvas.clientHeight || (w * 0.42)));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function watch(canvas, draw) {
    redraws.push(draw);
    let ro;
    if ("ResizeObserver" in window && canvas && canvas.parentElement) {
      ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => draw(), 80);
      });
      ro.observe(canvas.parentElement);
    }
    return draw;
  }
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => redraws.forEach((d) => d()), 120);
  });

  function plotFrame(ctx, w, h, pad) {
    pad = pad || { l: 48, r: 14, t: 16, b: 30 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    return { ...pad, iw, ih, x: (f) => pad.l + f * iw, y: (f) => pad.t + (1 - f) * ih };
  }
  function gridY(ctx, f, ticks, fmtFn) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = C.dim;
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ticks.forEach((v) => {
      const y = f.y((v - ticks[0]) / (ticks[ticks.length - 1] - ticks[0]));
      ctx.beginPath();
      ctx.moveTo(f.l, y);
      ctx.lineTo(f.l + f.iw, y);
      ctx.stroke();
      ctx.fillText(fmtFn ? fmtFn(v) : String(v), f.l - 7, y);
    });
  }
  function axisLabel(ctx, txt, x, y, align, color) {
    ctx.fillStyle = color || C.dim;
    ctx.font = "10px IBM Plex Sans Arabic, sans-serif";
    ctx.textAlign = align || "center";
    ctx.textBaseline = "top";
    ctx.fillText(txt, x, y);
  }

  /* ---------- data loading ---------- */
  let sitesPromise = null;
  let sitesData = null;
  function loadSites() {
    if (sitesData) return Promise.resolve(sitesData);
    if (!sitesPromise) {
      sitesPromise = U.fetchJSON("assets/data/sites.json")
        .then((d) => {
          sitesData = d;
          return d;
        })
        .catch((e) => {
          sitesPromise = null;
          throw e;
        });
    }
    return sitesPromise;
  }
  const ephemCache = {};
  function loadEphem(id) {
    if (!ephemCache[id])
      ephemCache[id] = U.fetchJSON("assets/data/ephemeris_" + id + ".json").catch((e) => {
        delete ephemCache[id];
        throw e;
      });
    return ephemCache[id];
  }
  const dailyCache = {};
  function loadDaily(id) {
    if (!dailyCache[id])
      dailyCache[id] = U.fetchJSON("assets/data/daily_" + id + ".json").catch((e) => {
        delete dailyCache[id];
        throw e;
      });
    return dailyCache[id];
  }
  function siteById(sites, id) {
    return sites.sites.filter((s) => s.id === id)[0];
  }
  function horizonAt(site, az) {
    const h = site.horizonEl;
    const a = azNorm(az);
    const i = Math.floor(a);
    const j = (i + 1) % 360;
    const t = a - i;
    return h[i] * (1 - t) + h[j] * t;
  }
  function siteName(s) {
    return s.shortAr || s.nameAr;
  }
  function status(el, text, kind) {
    if (!el) return;
    el.className = "lab-status" + (kind ? " " + kind : "");
    el.innerHTML = '<span class="dot"></span>' + text;
  }
  function errorBox(el, msg) {
    if (!el) return;
    el.innerHTML = '<div class="error-box"><b>تعذّر تحميل البيانات.</b> ' + msg + "</div>";
  }
  function loadingBox(el, msg) {
    if (!el) return;
    el.innerHTML = '<div class="loading"><span class="spinner"></span> ' + (msg || "جارٍ تحميل البيانات…") + "</div>";
  }
  function siteOptions(select, sites, current) {
    if (!select) return;
    select.innerHTML = "";
    sites.sites.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.nameAr + " — " + s.nameEn;
      if (s.id === current) o.selected = true;
      select.appendChild(o);
    });
  }

  /* ---------- DEM sampling ---------- */
  const demCache = {};
  function loadDEM(sites, demId) {
    if (demCache[demId]) return Promise.resolve(demCache[demId]);
    const meta = sites.dem[demId];
    if (!meta) return Promise.reject(new Error("DEM metadata missing"));
    return fetch("assets/data/" + meta.file, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const view = new DataView(buf);
        const grid = {
          meta: meta,
          view: view,
          sample: function (x, y) {
            const c = (x - meta.x0) / meta.pixelM;
            const r = (meta.y0 - y) / meta.pixelM;
            if (c < 0 || r < 0 || c >= meta.width - 1 || r >= meta.height - 1) return NaN;
            const c0 = Math.floor(c);
            const r0 = Math.floor(r);
            const fc = c - c0;
            const fr = r - r0;
            function v(col, row) {
              const idx = (row * meta.width + col) * 2;
              const z = view.getInt16(idx, true);
              return z <= -32000 ? NaN : z;
            }
            const a = v(c0, r0), b = v(c0 + 1, r0), d = v(c0, r0 + 1), e = v(c0 + 1, r0 + 1);
            if (!isFinite(a) || !isFinite(b) || !isFinite(d) || !isFinite(e)) return NaN;
            return a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + d * (1 - fc) * fr + e * fc * fr;
          },
        };
        demCache[demId] = grid;
        return grid;
      });
  }
  function profileAlong(grid, x, y, z, azDeg, maxM, stepM) {
    const rows = [];
    const lam = (Math.atan2(x, y) * 180) / Math.PI; // site longitude approximation
    const e = Math.sin((azDeg * Math.PI) / 180);
    const n = Math.cos((azDeg * Math.PI) / 180);
    const lamR = (lam * Math.PI) / 180;
    const dx = e * Math.cos(lamR) - n * Math.sin(lamR);
    const dy = -e * Math.sin(lamR) - n * Math.cos(lamR);
    for (let d = stepM; d <= maxM; d += stepM) {
      const zz = grid.sample(x + d * dx, y + d * dy);
      if (!isFinite(zz)) {
        rows.push({ d: d, z: NaN, el: NaN });
        continue;
      }
      const drop = (d * d) / (2 * R_MOON * 1000);
      rows.push({ d: d, z: zz, el: (Math.atan2(zz - z - drop, d) * 180) / Math.PI });
    }
    return rows;
  }

  /* ---------- time helpers ---------- */
  function startMs(ephem) {
    return Date.parse(ephem.start);
  }
  function indexTime(ephem, i) {
    return new Date(startMs(ephem) + i * ephem.stepHours * 3600 * 1000);
  }
  function fmtTime(d) {
    return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
  }
  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }
  function indexFor(ephem, dateStr, hour) {
    const target = Date.parse(dateStr + "T00:00:00Z") + (hour || 0) * 3600 * 1000;
    return clamp(Math.round((target - startMs(ephem)) / (ephem.stepHours * 3600 * 1000)), 0, ephem.count - 1);
  }
  function dayIndexFor(ephem, dateStr, hour) {
    return indexFor(ephem, dateStr, hour || 0);
  }

  /* ==========================================================================
     LAB 1 — CLPS mission timeline
     ========================================================================== */
  const MISSIONS = [
    {
      id: "peregrine",
      date: "2024-01-08",
      dateLabel: "8 يناير 2024",
      title: "Peregrine Mission One — Astrobotic",
      status: "completed",
      agency: "Astrobotic",
      site: "مار سينوس (Mare Crisium) — لم يصل",
      text: "انطلق حاملًا حمولات ناسا التجارية، لكن تسرّب دافع حرماني من الهبوط. أعادت المركبة بيانات قبل أن تدخل الغلاف الجوي للأرض في 18 يناير 2024.",
      sources: "S38",
      outcome: "فشل الهبوط",
    },
    {
      id: "im1",
      date: "2024-02-22",
      dateLabel: "22 فبراير 2024",
      title: "IM-1 Odysseus — Intuitive Machines",
      status: "completed",
      agency: "Intuitive Machines",
      site: "Malapert A",
      text: "أول هبوط ناعم تجاري على القمر. استقرت المركبة مائلة على جانبها بعد الهبوط، لكنها أعادت بيانات علمية وهندسية قبل أن ينتهي عمر المهمة.",
      sources: "S38",
      outcome: "هبوط ناعم مع ميل",
    },
    {
      id: "bg1",
      date: "2025-03-02",
      dateLabel: "2 مارس 2025",
      title: "Blue Ghost Mission 1 — Firefly Aerospace",
      status: "completed",
      agency: "Firefly Aerospace",
      site: "مار سينوس (Mare Crisium)",
      text: "أول هبوط تجاري ناجح بالكامل ضمن CLPS. حملت 10 حمولات ناسا وأكملت عملياتها السطحية كما هو مخطّط قبل غروب الشمس.",
      sources: "S19,S38",
      outcome: "نجاح",
    },
    {
      id: "im2",
      date: "2025-03-06",
      dateLabel: "6 مارس 2025",
      title: "IM-2 Athena — Intuitive Machines",
      status: "completed",
      agency: "Intuitive Machines",
      site: "Mons Mouton",
      text: "هبطت قرب مونس موتون ثم مالت على جانبها. أنهت ناسا المهمة في 7 مارس 2025 بعد أقل من يوم من الهبوط، مع بعض البيانات المستلمة.",
      sources: "S20,S38",
      outcome: "هبوط مع ميل ثم إنهاء مبكر",
    },
    {
      id: "griffin1",
      date: "2026-10-01",
      dateLabel: "أواخر 2026 (مخطط)",
      title: "Griffin Mission One — Astrobotic",
      status: "planned",
      agency: "Astrobotic",
      site: "فوهة نوبيل (Nobile Crater)",
      text: "مهمة كبيرة إلى القطب الجنوبي تحمل مركبة Astrolab FLIP؛ تتجاوز كتلة الحمولة 1,100 رطل أمريكي وفق ناسا. الموعد النهائي عرضة للتغيير.",
      sources: "S23",
      outcome: "مخطط",
    },
    {
      id: "im3",
      date: "2027-01-15",
      dateLabel: "أوائل 2027",
      title: "IM-3 — Intuitive Machines",
      status: "planned",
      agency: "Intuitive Machines",
      site: "Reiner Gamma",
      text: "وجهة مختلفة تمامًا عن القطب الجنوبي: حقل مغناطيسي قمري غامض. جدول الإطلاق والمتطلبات قد يتغيران.",
      sources: "S21",
      outcome: "مخطط",
    },
    {
      id: "bg2",
      date: "2027-06-01",
      dateLabel: "2027",
      title: "Blue Ghost Mission 2 — Firefly Aerospace",
      status: "planned",
      agency: "Firefly Aerospace",
      site: "الجانب البعيد من القمر",
      text: "مهمة إلى الجانب البعيد، تشمل مركبة Elytra Dark المدارية وحمولة ESA Lunar Pathfinder. الاتصال المباشر بالأرض غير متاح هناك، لذا الاتصال عبر مركبة مدارية.",
      sources: "S22",
      outcome: "مخطط",
    },
    {
      id: "im4",
      date: "2027-09-01",
      dateLabel: "2027",
      title: "IM-4 — Intuitive Machines",
      status: "planned",
      agency: "Intuitive Machines",
      site: "Mons Mouton",
      text: "مهمة إضافية إلى منطقة مونس موتون ضمن محفظة CLPS. التفاصيل والموعد قابلان للتغيير.",
      sources: "S38",
      outcome: "مخطط",
    },
    {
      id: "bg3",
      date: "2028-06-01",
      dateLabel: "2028",
      title: "Blue Ghost Mission 3 — Firefly Aerospace",
      status: "planned",
      agency: "Firefly Aerospace",
      site: "Gruithuisen Domes",
      text: "وجهة بركانية غير قطبية. وجودها في القائمة يوضح أن CLPS ليست برنامجًا قطبيًا فقط.",
      sources: "S38",
      outcome: "مخطط",
    },
    {
      id: "mk1",
      date: "2027-12-01",
      dateLabel: "لم يُؤكد؛ تقديرات 2027",
      title: "Blue Moon Mark 1 — Blue Origin",
      status: "planned",
      agency: "Blue Origin",
      site: "Shackleton Connecting Ridge",
      text: "مركبة شحن غير مأهولة إلى حافة الاتصال قرب شاكليتون. جدول الإطلاق النهائي لم يُعلن بشكل قاطع؛ تستخدم الأداة تقديرات لا مواعيد رسمية.",
      sources: "S24,S25,S42",
      outcome: "مخطط",
    },
    {
      id: "draper",
      date: "2026-07-15",
      dateLabel: "يوليو 2026",
      title: "Draper CP-12 — ispace-U.S.",
      status: "cancelled",
      agency: "Draper / ispace-U.S.",
      site: "لم يُنفّذ",
      text: "أنهت ناسا وDraper المهمة بالاتفاق في يوليو 2026. لا ينبغي عرضها كمهمة قادمة. القرار يذكّر بأن جداول CLPS ليست ثابتة.",
      sources: "S31,S32",
      outcome: "ملغاة",
    },
  ];

  function initMissions() {
    const root = $("#lab-missions");
    if (!root) return;
    const timeline = $("#missionTimeline");
    const stats = $("#missionStats");
    const agency = $("#missionAgency");
    const statusEl = $("#missionStatus");
    let filter = "all";
    let agencyFilter = "all";

    if (agency) {
      const names = ["all"].concat(Array.from(new Set(MISSIONS.map((m) => m.agency))));
      agency.innerHTML = "";
      names.forEach((n) => {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n === "all" ? "كل المزوّدين" : n;
        agency.appendChild(o);
      });
      agency.addEventListener("change", () => {
        agencyFilter = agency.value;
        render();
      });
    }
    $$("[data-mfilter]", root).forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.mfilter;
        $$("[data-mfilter]", root).forEach((x) => x.classList.toggle("is-active", x === b));
        render();
      })
    );

    function render() {
      const items = MISSIONS.filter((m) => (filter === "all" || m.status === filter) && (agencyFilter === "all" || m.agency === agencyFilter));
      if (timeline) {
        timeline.innerHTML = "";
        items.forEach((m) => {
          const item = document.createElement("div");
          item.className = "tl-item";
          const date = document.createElement("span");
          date.className = "tl-date";
          date.textContent = m.dateLabel;
          const h = document.createElement("h3");
          h.textContent = m.title;
          const badges = document.createElement("div");
          badges.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 7px";
          const statusTag = document.createElement("span");
          const st = m.status === "completed" ? "tag tag-official" : m.status === "planned" ? "tag tag-data" : "tag tag-hypothetical";
          statusTag.className = st;
          statusTag.textContent = m.status === "completed" ? "منتهية" : m.status === "planned" ? "مخططة" : "ملغاة";
          const siteTag = document.createElement("span");
          siteTag.className = "tag tag-assumption";
          siteTag.textContent = m.site;
          badges.append(statusTag, siteTag);
          const p = document.createElement("p");
          p.textContent = m.text;
          const meta = document.createElement("p");
          meta.style.cssText = "margin-top:6px;color:var(--dim);font-size:10.5px";
          meta.textContent = "المزوّد: " + m.agency + " · النتيجة: " + m.outcome;
          const src = document.createElement("p");
          src.style.cssText = "margin-top:3px;font-size:10.5px";
          src.innerHTML =
            "المصادر: " +
            m.sources
              .split(",")
              .map((s) => '<a class="cite" href="sources.html#' + s.toLowerCase() + '">[' + s + "]</a>")
              .join(" ");
          item.append(date, h, badges, p, meta, src);
          timeline.appendChild(item);
        });
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "glossary-empty";
          empty.textContent = "لا مهام تطابق هذا التصفية.";
          timeline.appendChild(empty);
        }
      }
      if (stats) {
        const done = MISSIONS.filter((m) => m.status === "completed").length;
        const planned = MISSIONS.filter((m) => m.status === "planned").length;
        const cancelled = MISSIONS.filter((m) => m.status === "cancelled").length;
        stats.innerHTML =
          '<div class="stat"><b>' +
          done +
          '</b><span>منتهية (نجاح أو فشل)</span></div><div class="stat"><b>' +
          planned +
          '</b><span>مخططة</span></div><div class="stat"><b>' +
          cancelled +
          '</b><span>ملغاة</span></div><div class="stat"><b>' +
          MISSIONS.length +
          "</b><span>إجمالي السجل</span></div>";
      }
      status(statusEl, items.length + " مهمة معروضة · لقطة 2026-11-04");
    }
    render();
  }

  /* ==========================================================================
     LAB 2 — landing site explorer
     ========================================================================== */
  function initExplorer() {
    const root = $("#lab-explorer");
    if (!root) return;
    const tabs = $("#explorerTabs");
    const map = $("#explorerMap");
    const statusEl = $("#explorerStatus");
    const hover = $("#explorerHover");
    const canvas = $("#explorerMonthly");
    let sites = null;
    let current = null;

    loadingBox($("#explorerLoading"), "جارٍ تحميل مواقع LOLA…");
    loadSites()
      .then((data) => {
        sites = data;
        current = data.sites[0];
        buildTabs();
        buildMap();
        render();
        const lb = $("#explorerLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => {
        errorBox($("#explorerLoading"), "ملف sites.json غير متاح. " + e.message);
        status(statusEl, "خطأ في التحميل", "error");
      });

    function buildTabs() {
      tabs.innerHTML = "";
      sites.sites.forEach((s, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.site = s.id;
        b.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + s.color + ';margin-inline-end:6px"></span>' + siteName(s);
        if (i === 0) b.classList.add("is-active");
        b.addEventListener("click", () => {
          current = s;
          $$("button", tabs).forEach((x) => x.classList.toggle("is-active", x === b));
          render();
        });
        tabs.appendChild(b);
      });
    }
    function buildMap() {
      if (!map) return;
      $$(".map-marker, .map-label, .map-cross", map).forEach((e) => e.remove());
      const markers = sites.sites.concat([{ id: "shackleton", shortAr: "شاكليتون", mapXPct: 98.894, mapYPct: 38.194, color: C.cyan, isCrater: true }]);
      markers.forEach((s) => {
        const m = document.createElement("span");
        m.className = "map-marker" + (s.isCrater ? " crater" : "");
        if (!s.isCrater) m.style.background = s.color;
        m.style.left = s.mapXPct + "%";
        m.style.top = s.mapYPct + "%";
        m.dataset.site = s.id;
        m.title = s.shortAr;
        if (!s.isCrater) {
          m.style.cursor = "pointer";
          m.addEventListener("click", () => {
            const target = sites.sites.filter((x) => x.id === s.id)[0];
            if (target) {
              current = target;
              $$("button", tabs).forEach((x) => x.classList.toggle("is-active", x.dataset.site === target.id));
              render();
            }
          });
        }
        map.appendChild(m);
        const label = document.createElement("span");
        label.className = "map-label";
        label.dataset.site = s.id;
        label.style.left = s.mapXPct + "%";
        label.style.top = s.mapYPct + "%";
        label.textContent = s.shortAr;
        map.appendChild(label);
      });
      const cross = document.createElement("span");
      cross.className = "map-cross";
      cross.style.left = "71.429%";
      cross.style.top = "9.091%";
      cross.title = "القطب الجنوبي";
      map.appendChild(cross);
    }
    function setText(id, v) {
      const el = $("#" + id);
      if (el) el.textContent = v;
    }
    function render() {
      if (!current) return;
      $("#explorerName").textContent = current.nameAr;
      $("#explorerEn").textContent = current.nameEn;
      $("#explorerRole").textContent = current.role;
      $("#explorerNote").textContent = current.noteAr;
      setText("expLat", Math.abs(current.lat).toFixed(4) + "°S");
      setText("expLon", current.lon.toFixed(3) + "°E");
      setText("expAlt", fmt(current.altM, 1) + " m");
      setText("expSlope", fmt(current.slopeDeg, 2) + "°");
      setText("expSun", fmt(current.sunPct, 2) + "%");
      setText("expEarth", fmt(current.earthPct, 2) + "%");
      setText("expDark", fmt(current.longestDarkHours, 0) + " h");
      setText("expOutage", fmt(current.longestEarthOutageHours, 0) + " h");
      $$(".map-marker", map).forEach((m) => {
        m.style.outline = m.dataset.site === current.id ? "2px solid #fff" : "";
        m.style.outlineOffset = "3px";
      });
      drawMonthly();
      if (statusEl) status(statusEl, "بيانات حقيقية: LOLA 5 m + JPL Horizons · " + current.id);
    }
    function drawMonthly() {
      if (!canvas || !current) return;
      const f = fit(canvas);
      if (!f) return;
      const { ctx, w, h } = f;
      const pad = { l: 8, r: 8, t: 14, b: 30 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const months = Object.keys(current.monthly);
      const bw = iw / months.length;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      [0, 25, 50, 75, 100].forEach((v) => {
        const y = pad.t + ih * (1 - v / 100);
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        if (v % 25 === 0) {
          ctx.fillStyle = C.dim;
          ctx.textAlign = "right";
          ctx.fillText(String(v), pad.l - 2, y - 8);
        }
      });
      months.forEach((m, i) => {
        const x = pad.l + i * bw;
        const s = current.monthly[m];
        const sh = ih * (s.sunPct / 100);
        const eh = ih * (s.earthPct / 100);
        ctx.fillStyle = "rgba(94,224,160,.65)";
        ctx.fillRect(x + bw * 0.18, pad.t + ih - sh, bw * 0.26, sh);
        ctx.fillStyle = "rgba(92,141,255,.7)";
        ctx.fillRect(x + bw * 0.48, pad.t + ih - eh, bw * 0.26, eh);
        if (i % 2 === 0) {
          ctx.fillStyle = C.muted;
          ctx.textAlign = "center";
          ctx.fillText(MONTHS_SHORT[i], x + bw / 2, h - 20);
        }
        ctx.fillStyle = C.dim;
        ctx.font = "9px IBM Plex Mono, monospace";
        if (s.days && m.slice(5, 7) === "01") {
          ctx.textAlign = "left";
          ctx.fillText(m.slice(0, 4), x, h - 9);
        }
        ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      });
      ctx.textAlign = "left";
      ctx.fillStyle = C.green;
      ctx.fillText("شمس", pad.l, 2);
      ctx.fillStyle = C.blue;
      ctx.fillText("أرض", pad.l + 34, 2);
    }
    if (canvas) {
      canvas.addEventListener("pointermove", (ev) => {
        if (!current) return;
        const r = canvas.getBoundingClientRect();
        const months = Object.keys(current.monthly);
        const i = clamp(Math.floor(((ev.clientX - r.left) / r.width) * 12), 0, 11);
        const m = months[i];
        const s = current.monthly[m];
        if (hover) hover.textContent = m + ": شمس " + fmt(s.sunPct, 1) + "% · أرض " + fmt(s.earthPct, 1) + "%";
      });
      canvas.addEventListener("pointerleave", () => {
        if (hover) hover.textContent = "مرّر فوق الرسم لعرض القيم الشهرية.";
      });
      watch(canvas, drawMonthly);
    }
  }

  /* ==========================================================================
     LAB 3 — horizon panorama with Sun & Earth
     ========================================================================== */
  function initHorizon() {
    const root = $("#lab-horizon");
    if (!root) return;
    const sel = $("#hzSite");
    const range = $("#hzTime");
    const out = $("#hzTimeOut");
    const playBtn = $("#hzPlay");
    const canvas = $("#hzCanvas");
    const hover = $("#hzHover");
    let sites, ephem, site, idx = 0, timer = null;
    loadingBox($("#hzLoading"), "جارٍ تحميل الأفق واليفيميريس…");
    loadSites()
      .then((data) => {
        sites = data;
        sel.value = "site01";
        siteOptions(sel, sites, "site01");
        return loadEphem("site01");
      })
      .then((e) => {
        ephem = e;
        site = siteById(sites, "site01");
        idx = indexFor(ephem, "2026-11-04", 12);
        range.max = ephem.count - 1;
        range.value = idx;
        bind();
        draw();
        const lb = $("#hzLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => {
        errorBox($("#hzLoading"), "تعذّر تحميل بيانات الأفق. " + e.message);
        status($("#hzStatus"), "خطأ", "error");
      });

    function bind() {
      sel.addEventListener("change", () => {
        site = siteById(sites, sel.value);
        loadEphem(site.id).then((e) => {
          ephem = e;
          idx = clamp(idx, 0, ephem.count - 1);
          range.max = ephem.count - 1;
          range.value = idx;
          draw();
        });
      });
      range.addEventListener("input", () => {
        idx = +range.value;
        draw();
      });
      playBtn.addEventListener("click", togglePlay);
      canvas.addEventListener("pointermove", onHover);
      canvas.addEventListener("pointerleave", () => {
        hover.textContent = "مرّر فوق البانوراما لقراءة الأفق عند أي سمت.";
      });
    }
    function togglePlay() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        playBtn.textContent = "▶ تشغيل";
        playBtn.classList.remove("is-active");
        status($("#hzStatus"), "متوقف عند " + fmtTime(indexTime(ephem, idx)));
        return;
      }
      playBtn.textContent = "⏸ إيقاف";
      playBtn.classList.add("is-active");
      timer = setInterval(() => {
        idx = (idx + 6) % ephem.count;
        range.value = idx;
        draw();
      }, 450);
      status($("#hzStatus"), "تشغيل تلقائي · 6 ساعات/إطار");
    }
    function stateFor(objectEl, visible) {
      if (!objectEl) return;
      objectEl.innerHTML = visible ? '<span class="green">ظاهر فوق الأفق</span>' : '<span class="red">محجوب بالتضاريس</span>';
    }
    function draw() {
      if (!ephem || !site) return;
      const time = indexTime(ephem, idx);
      if (out) out.textContent = fmtTime(time);
      const sunEl = ephem.sunEl[idx], sunAz = ephem.sunAz[idx];
      const earthEl = ephem.earthEl[idx], earthAz = ephem.earthAz[idx];
      const hSun = horizonAt(site, sunAz), hEarth = horizonAt(site, earthAz);
      $("#hzSunEl").textContent = signed(sunEl);
      $("#hzSunAz").textContent = fmt(sunAz, 1) + "°";
      $("#hzEarthEl").textContent = signed(earthEl);
      $("#hzEarthAz").textContent = fmt(earthAz, 1) + "°";
      stateFor($("#hzSunState"), sunEl + SUN_R > hSun);
      stateFor($("#hzEarthState"), earthEl + EARTH_R > hEarth);

      const f = fit(canvas);
      if (!f) return;
      const { ctx, w, h } = f;
      const pad = { l: 36, r: 12, t: 18, b: 26 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const yMin = -12, yMax = 12;
      const xOf = (az) => pad.l + (azNorm(az) / 360) * iw;
      const yOf = (el) => pad.t + ((yMax - clamp(el, yMin, yMax)) / (yMax - yMin)) * ih;

      // sky
      const sky = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      sky.addColorStop(0, "#07131f");
      sky.addColorStop(0.55, "#0a1c2c");
      sky.addColorStop(1, "#0b2233");
      ctx.fillStyle = sky;
      ctx.fillRect(pad.l, pad.t, iw, ih);

      // grid
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      for (let el = -10; el <= 10; el += 5) {
        const y = yOf(el);
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
      }
      [0, 90, 180, 270, 360].forEach((az) => {
        const x = xOf(az);
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + ih);
        ctx.stroke();
        ctx.fillStyle = C.muted;
        ctx.font = "10px IBM Plex Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(["N", "E", "S", "W", "N"][az / 90], x, pad.t + ih + 7);
      });
      ctx.fillStyle = C.dim;
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.textAlign = "right";
      for (let el = -10; el <= 10; el += 5) {
        ctx.fillText((el > 0 ? "+" : "") + el + "°", pad.l - 5, yOf(el));
      }

      // terrain horizon fill
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ih);
      for (let az = 0; az <= 360; az += 1) {
        ctx.lineTo(xOf(az), yOf(site.horizonEl[az % 360]));
      }
      ctx.lineTo(w - pad.r, pad.t + ih);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      fill.addColorStop(0, "rgba(58,110,128,.55)");
      fill.addColorStop(1, "rgba(13,32,46,.92)");
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(120,220,235,.55)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let az = 0; az <= 360; az += 1) {
        const x = xOf(az), y = yOf(site.horizonEl[az % 360]);
        if (az === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Sun path for current UTC day
      const dayStart = Math.floor(idx / 24) * 24;
      ctx.strokeStyle = "rgba(255,180,84,.38)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const k = Math.min(dayStart + i, ephem.count - 1);
        const x = xOf(ephem.sunAz[k]), y = yOf(ephem.sunEl[k]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Earth path for current UTC day
      ctx.strokeStyle = "rgba(92,141,255,.38)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const k = Math.min(dayStart + i, ephem.count - 1);
        const x = xOf(ephem.earthAz[k]), y = yOf(ephem.earthEl[k]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // current markers
      drawObject(ctx, xOf(earthAz), yOf(earthEl), 5, C.blue, "الأرض");
      drawObject(ctx, xOf(sunAz), yOf(sunEl), 7, C.amber, "الشمس");

      // legend
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = C.amber;
      ctx.fillText("الشمس", pad.l + 4, pad.t + 5);
      ctx.fillStyle = C.blue;
      ctx.fillText("الأرض", pad.l + 48, pad.t + 5);
      const hovered = hover && hover.dataset.az ? +hover.dataset.az : null;
      if (hovered !== null && isFinite(hovered)) {
        const hx = xOf(hovered), hy = yOf(horizonAt(site, hovered));
        ctx.strokeStyle = C.cyan;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (statusEl()) status($("#hzStatus"), "أفق من LOLA 5 m · الشمس/الأرض من JPL Horizons · " + site.id);
    }
    function drawObject(ctx, x, y, r, color, label) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = color;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = x > 100 ? "right" : "left";
      ctx.fillText(label, x + (x > 100 ? -9 : 9), y - 9);
    }
    function statusEl() {
      return $("#hzStatus");
    }
    function onHover(ev) {
      if (!site) return;
      const r = canvas.getBoundingClientRect();
      const az = clamp(((ev.clientX - r.left) / r.width) * 360, 0, 359.9);
      hover.dataset.az = az;
      hover.textContent = "سمت " + fmt(az, 0) + "° · أفق " + signed(horizonAt(site, az), 1);
      draw();
    }
    if (canvas) watch(canvas, draw);
  }

  /* ==========================================================================
     LAB 4 — solar elevation cross-section
     ========================================================================== */
  function initSun() {
    const root = $("#lab-sun");
    if (!root) return;
    const sel = $("#sunSite");
    const dateIn = $("#sunDate");
    const hourIn = $("#sunHour");
    const hourOut = $("#sunHourOut");
    const canvas = $("#sunCanvas");
    const hover = $("#sunHover");
    let sites, ephem, site, demGrid, idx = 0;
    loadingBox($("#sunLoading"), "جارٍ تحميل تضاريس الموقع…");
    loadSites()
      .then((data) => {
        sites = data;
        siteOptions(sel, sites, "site01");
        site = siteById(sites, "site01");
        dateIn.min = "2026-11-01";
        dateIn.max = "2027-10-31";
        dateIn.value = "2026-12-01";
        return Promise.all([loadEphem("site01"), loadDEM(sites, site.dem)]);
      })
      .then(([e, grid]) => {
        ephem = e;
        demGrid = grid;
        demo();
        bind();
        draw();
        const lb = $("#sunLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => {
        errorBox($("#sunLoading"), "تعذّر تحميل نموذج التضاريس. " + e.message);
        status($("#sunStatus"), "خطأ", "error");
      });

    function demo() {
      const ephemCopy = ephem;
      idx = indexFor(ephemCopy, dateIn.value, +hourIn.value);
      hourOut.textContent = String(+hourIn.value).padStart(2, "0") + ":00Z";
    }
    function bind() {
      sel.addEventListener("change", () => {
        site = siteById(sites, sel.value);
        status($("#sunStatus"), "جارٍ تحميل تضاريس " + siteName(site) + "…", "loading");
        loadDEM(sites, site.dem)
          .then((g) => {
            demGrid = g;
            draw();
          })
          .catch((e) => errorBox($("#sunLoading"), e.message));
      });
      dateIn.addEventListener("change", () => {
        idx = indexFor(ephem, dateIn.value, +hourIn.value);
        draw();
      });
      hourIn.addEventListener("input", () => {
        hourOut.textContent = String(+hourIn.value).padStart(2, "0") + ":00Z";
        idx = indexFor(ephem, dateIn.value, +hourIn.value);
        draw();
      });
      canvas.addEventListener("pointermove", onHover);
      canvas.addEventListener("pointerleave", () => {
        hover.textContent = "مرّر فوق المقطع لقراءة المسافة وزاوية الارتفاع.";
      });
    }
    function onHover(ev) {
      if (!lastProfile) return;
      const r = canvas.getBoundingClientRect();
      const f = lastFrame;
      const x = ev.clientX - r.left;
      const dist = clamp(((x - f.l) / f.iw) * 9, 0, 9);
      const row = lastProfile[Math.min(lastProfile.length - 1, Math.max(0, Math.round((dist - 0.02) / 0.02)))];
      if (row) hover.textContent = "مسافة " + fmt(row.d / 1000, 1) + " km · زاوية " + signed(row.el, 2);
    }
    let lastProfile = null, lastFrame = null;
    function draw() {
      if (!ephem || !site || !demGrid) return;
      const sunEl = ephem.sunEl[idx], sunAz = ephem.sunAz[idx];
      const hz = horizonAt(site, sunAz);
      const vis = sunEl + SUN_R > hz;
      if ($("#sunEl")) $("#sunEl").textContent = signed(sunEl);
      if ($("#sunAz")) $("#sunAz").textContent = fmt(sunAz, 1) + "°";
      if ($("#sunHorizon")) $("#sunHorizon").textContent = signed(hz);
      if ($("#sunMargin")) $("#sunMargin").textContent = signed(sunEl + SUN_R - hz);
      if ($("#sunRadius")) $("#sunRadius").textContent = fmt(SUN_R, 3) + "°";
      if ($("#sunState")) $("#sunState").innerHTML = vis ? '<span class="green">ظاهرة</span>' : '<span class="red">محجوبة</span>';
      const t = indexTime(ephem, idx);
      const coord = Math.abs(site.lat).toFixed(3) + "°S, " + site.lon.toFixed(2) + "°E";
      $("#sunTime").textContent = fmtTime(t) + " · " + coord;

      const cycle = ((Math.floor(idx / 24) + 182) % 365) + 1;
      const solarDay = (((idx % 24) + 12) % 24) / 24;
      const f = fit(canvas);
      if (!f) return;
      const { ctx, w, h } = f;
      const pad = { l: 46, r: 18, t: 16, b: 28 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const profile = profileAlong(demGrid, site.x, site.y, site.altM, sunAz, 9000, 20);
      lastProfile = profile;
      const valid = profile.filter((r) => isFinite(r.el));
      let yMin = Math.min(-5, Math.floor(Math.min.apply(null, valid.map((r) => r.el)) / 2) * 2);
      let yMax = Math.max(5, Math.ceil(Math.max.apply(null, valid.map((r) => r.el)) / 2) * 2);
      yMin = clamp(yMin, -20, 0);
      yMax = clamp(yMax, 1, 20);
      lastFrame = { l: pad.l, iw: iw };
      const yOf = (el) => pad.t + ((yMax - el) / (yMax - yMin)) * ih;
      const xOf = (d) => pad.l + (d / 9000) * iw;

      // sky
      const sky = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      sky.addColorStop(0, "#081522");
      sky.addColorStop(1, "#0d2233");
      ctx.fillStyle = sky;
      ctx.fillRect(pad.l, pad.t, iw, ih);

      // grid
      ctx.strokeStyle = C.grid;
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.fillStyle = C.dim;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let el = Math.ceil(yMin / 2) * 2; el <= yMax; el += 2) {
        const y = yOf(el);
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        ctx.fillText((el > 0 ? "+" : "") + el + "°", pad.l - 5, y);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let d = 0; d <= 9; d += 3) {
        const x = xOf(d * 1000);
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + ih);
        ctx.stroke();
        ctx.fillStyle = C.muted;
        ctx.fillText(d === 0 ? "الموقع" : d + " km", x, pad.t + ih + 7);
      }

      // terrain silhouette
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ih);
      profile.forEach((r) => {
        if (isFinite(r.el)) ctx.lineTo(xOf(r.d), yOf(r.el));
      });
      ctx.lineTo(w - pad.r, pad.t + ih);
      ctx.closePath();
      const terr = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      terr.addColorStop(0, "rgba(52,93,106,.65)");
      terr.addColorStop(1, "rgba(8,20,30,.95)");
      ctx.fillStyle = terr;
      ctx.fill();
      ctx.strokeStyle = "rgba(140,210,222,.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      profile.forEach((r) => {
        if (!isFinite(r.el)) return;
        const x = xOf(r.d), y = yOf(r.el);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // sun ray
      const ySun = yOf(sunEl);
      ctx.strokeStyle = vis ? "rgba(255,180,84,.72)" : "rgba(255,115,115,.55)";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, ySun);
      ctx.lineTo(w - pad.r, ySun);
      ctx.stroke();
      ctx.setLineDash([]);
      // sun disk
      ctx.save();
      ctx.shadowColor = C.amber;
      ctx.shadowBlur = 14;
      ctx.fillStyle = vis ? C.amber : "rgba(255,180,84,.4)";
      ctx.beginPath();
      ctx.arc(w - pad.r - 4, ySun, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // blocking intersection label
      if (!vis) {
        ctx.fillStyle = C.red;
        ctx.font = "10px IBM Plex Sans Arabic, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("الخط المرئي للشمس يمر تحت التضاريس", w - pad.r, pad.t + 5);
      }
      // solar-day arc marker (schematic)
      ctx.fillStyle = "rgba(255,180,84,.28)";
      ctx.beginPath();
      ctx.arc(pad.l + 18, pad.t + ih - 12, 7, 0, Math.PI * ((solarDay + 0.25) % 1) * 2);
      ctx.fillStyle = C.dim;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("دورة الشمس اليومية (مخطّط)", pad.l + 28, pad.t + ih - 16);
      status($("#sunStatus"), "مقطع 20 m/px · الحالة من أفق 5 m · " + site.id);
    }
    if (canvas) watch(canvas, draw);
  }

  /* ==========================================================================
     LAB 5 — Earth visibility over a year
     ========================================================================== */
  function initEarth() {
    const root = $("#lab-earth");
    if (!root) return;
    const sel = $("#earthSite");
    const range = $("#earthDay");
    const out = $("#earthDayOut");
    const canvas = $("#earthCanvas");
    const hover = $("#earthHover");
    let sites, ephem, daily, site, day = 0, values = [];
    loadingBox($("#earthLoading"), "جارٍ تحميل رؤية الأرض…");
    loadSites()
      .then((data) => {
        sites = data;
        siteOptions(sel, sites, "site01");
        site = siteById(sites, "site01");
        return Promise.all([loadEphem("site01"), loadDaily("site01")]);
      })
      .then(([e, d]) => {
        ephem = e;
        daily = d;
        day = 3; // 2026-11-04
        range.max = 364;
        range.value = day;
        computeSeries();
        bind();
        render();
        const lb = $("#earthLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => {
        errorBox($("#earthLoading"), "تعذّر تحميل بيانات رؤية الأرض. " + e.message);
        status($("#earthStatus"), "خطأ", "error");
      });

    function computeSeries() {
      values = [];
      for (let d = 0; d < 365; d++) {
        const i = Math.min(ephem.count - 1, dayIndexFor(ephem, daily.days[d].d, 12));
        const el = ephem.earthEl[i], az = ephem.earthAz[i];
        values.push({ d: d, el: el, az: az, h: horizonAt(site, az), margin: el + EARTH_R - horizonAt(site, az), date: daily.days[d].d });
      }
      if (!values.length) return;
      let best = 0;
      for (let d = 0; d < 365; d++) if (values[d].margin > 0) best++;
      $("#earthPct").textContent = fmt(site.earthPct, 1) + "%";
      $("#earthOutage").textContent = fmt(site.longestEarthOutageHours / 24, 1) + " يوم";
      $("#earthWindow").textContent = fmt(site.longestEarthHours / 24, 1) + " يوم";
      $("#earthBest").textContent = fmt((100 * best) / 365, 1) + "%";
    }
    function bind() {
      sel.addEventListener("change", () => {
        site = siteById(sites, sel.value);
        status($("#earthStatus"), "جارٍ تحميل…", "loading");
        Promise.all([loadEphem(site.id), loadDaily(site.id)])
          .then(([e, d]) => {
            ephem = e;
            daily = d;
            day = clamp(day, 0, 364);
            range.value = day;
            computeSeries();
            render();
          })
          .catch((e) => errorBox($("#earthLoading"), e.message));
      });
      range.addEventListener("input", () => {
        day = +range.value;
        render();
      });
      canvas.addEventListener("pointermove", onHover);
      canvas.addEventListener("pointerleave", () => {
        hover.textContent = "مرّر فوق الرسم لقراءة هامش الأرض في أي يوم.";
      });
    }
    function onHover(ev) {
      if (!values.length) return;
      const r = canvas.getBoundingClientRect();
      const i = clamp(Math.floor(((ev.clientX - r.left - 46) / (r.width - 60)) * 365), 0, 364);
      const v = values[i];
      if (v)
        hover.textContent =
          v.date + " · ارتفاع الأرض " + signed(v.el) + " · أفق " + signed(v.h) + " · هامش " + signed(v.margin);
    }
    function render() {
      if (!values.length) return;
      const current = values[day];
      out.textContent = current.date;
      const iNoon = dayIndexFor(ephem, current.date, 12);
      const el = ephem.earthEl[iNoon], az = ephem.earthAz[iNoon];
      const hz = horizonAt(site, az);
      const vis = el + EARTH_R > hz;
      $("#earthEl").textContent = signed(el);
      $("#earthAz").textContent = fmt(az, 1) + "°";
      $("#earthHorizon").textContent = signed(hz);
      $("#earthMargin").textContent = signed(el + EARTH_R - hz);
      $("#earthState").innerHTML = vis ? '<span class="green">ظاهرة</span>' : '<span class="red">محجوبة</span>';

      // remaining time until state change
      let remain = 0;
      let k = iNoon;
      while (k < ephem.count - 1 && remain < 24 * 30) {
        const e2 = ephem.earthEl[k], a2 = ephem.earthAz[k];
        if (e2 + EARTH_R > horizonAt(site, a2) !== vis) break;
        remain++;
        k++;
      }
      $("#earthRemain").textContent = remain >= 24 * 30 ? "> 30 يوم" : fmt(remain, 0) + " ساعة";
      $("#earthRemainLabel").textContent = vis ? "حتى حجب الأرض" : "حتى ظهور الأرض";

      const f = fit(canvas);
      if (!f) return;
      const { ctx, w, h } = f;
      const pad = { l: 46, r: 16, t: 16, b: 28 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const vals = values.map((v) => v.margin);
      const yMin = Math.min(-8, Math.floor(Math.min.apply(null, vals)));
      const yMax = Math.max(6, Math.ceil(Math.max.apply(null, vals)));
      const xOf = (d) => pad.l + (d / 364) * iw;
      const yOf = (v) => pad.t + ((yMax - v) / (yMax - yMin)) * ih;

      ctx.fillStyle = "#07111c";
      ctx.fillRect(pad.l, pad.t, iw, ih);
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.dim;
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let v = Math.ceil(yMin / 2) * 2; v <= yMax; v += 2) {
        const y = yOf(v);
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        if (v % 2 === 0) ctx.fillText((v > 0 ? "+" : "") + v, pad.l - 5, y);
      }
      // zero line
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.beginPath();
      ctx.moveTo(pad.l, yOf(0));
      ctx.lineTo(w - pad.r, yOf(0));
      ctx.stroke();

      // visible shading at top
      for (let d = 0; d < 364; d++) {
        if (values[d].margin > 0) {
          ctx.fillStyle = "rgba(94,224,160,.14)";
          ctx.fillRect(xOf(d), pad.t, Math.max(1, xOf(d + 1) - xOf(d)), 4);
        }
      }
      // line
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      values.forEach((v, d) => {
        if (d === 0) ctx.moveTo(xOf(d), yOf(v.margin));
        else ctx.lineTo(xOf(d), yOf(v.margin));
      });
      ctx.stroke();
      // fill
      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(0));
      values.forEach((v, d) => ctx.lineTo(xOf(d), yOf(v.margin)));
      ctx.lineTo(xOf(364), yOf(0));
      ctx.closePath();
      ctx.fillStyle = "rgba(92,141,255,.12)";
      ctx.fill();
      // current day
      const cx = xOf(day);
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, pad.t);
      ctx.lineTo(cx, pad.t + ih);
      ctx.stroke();
      ctx.fillStyle = C.cyan;
      ctx.beginPath();
      ctx.arc(cx, yOf(current.margin), 4, 0, Math.PI * 2);
      ctx.fill();

      // month labels
      const labels = [];
      let lastMonth = daily.days[0].d.slice(0, 7);
      daily.days.forEach((d2, di) => {
        const m = d2.d.slice(0, 7);
        if (m !== lastMonth) {
          labels.push({ d: di, label: MONTHS_SHORT[(m.slice(5) === "11" ? 0 : m.slice(5) === "12" ? 1 : +m.slice(5) - 1)] });
          lastMonth = m;
        }
      });
      ctx.fillStyle = C.muted;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      labels.forEach((l, i) => {
        if (i % 2 === 0) ctx.fillText(l.label, xOf(l.d), pad.t + ih + 7);
      });
      ctx.textAlign = "left";
      ctx.fillStyle = C.blue;
      ctx.fillText("هامش ارتفاع الأرض فوق الأفق التضاريسي (°)", pad.l, 2);
      status($("#earthStatus"), "JPL Horizons + LOLA 5 m · " + site.id);
    }
    if (canvas) watch(canvas, render);
  }

  /* ---------- missions binding after DOM ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    initMissions();
    initExplorer();
    initHorizon();
    initSun();
    initEarth();
  });

  /* expose */
  window.LAB = {
    C: C,
    $: $,
    $$: $$,
    fmt: fmt,
    signed: signed,
    clamp: clamp,
    azNorm: azNorm,
    fit: fit,
    watch: watch,
    plotFrame: plotFrame,
    gridY: gridY,
    axisLabel: axisLabel,
    loadSites: loadSites,
    loadEphem: loadEphem,
    loadDaily: loadDaily,
    loadDEM: loadDEM,
    siteById: siteById,
    horizonAt: horizonAt,
    siteName: siteName,
    siteOptions: siteOptions,
    status: status,
    errorBox: errorBox,
    loadingBox: loadingBox,
    indexFor: indexFor,
    indexTime: indexTime,
    fmtTime: fmtTime,
    fmtDate: fmtDate,
    startMs: startMs,
    MONTHS: MONTHS,
    MONTHS_SHORT: MONTHS_SHORT,
    SUN_R: SUN_R,
    EARTH_R: EARTH_R,
    R_MOON: R_MOON,
    profileAlong: profileAlong,
    redraws: redraws,
    C2: C,
  };
})();
