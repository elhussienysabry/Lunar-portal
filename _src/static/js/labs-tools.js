/* ==========================================================================
   Lunar Landing Site Navigator — tools labs
   Coordinates, lighting calendar, scenario comparison, power, link budget.
   Requires labs.js + app.js.
   ========================================================================== */
(function () {
  "use strict";
  const L = window.LAB;
  if (!L) return;
  const { $, $$, fmt, signed, clamp, azNorm, fit, watch, loadSites, loadDaily, siteById, siteOptions, status, errorBox, loadingBox, MONTHS, MONTHS_SHORT, R_MOON } = L;
  const C = L.C;
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  /* ---------- projection helpers ---------- */
  function latlonToXY(lat, lon) {
    const rho = 2 * R_MOON * Math.tan(((90 + lat) * RAD) / 2);
    const a = lon * RAD;
    return { x: rho * Math.sin(a), y: rho * Math.cos(a), rho: rho };
  }
  function xyToLatLon(x, y) {
    const rho = Math.hypot(x, y);
    const lat = 90 - 2 * Math.atan(rho / (2 * R_MOON)) * DEG;
    const lon = (Math.atan2(x, y) * DEG + 360) % 360;
    return { lat: lat, lon: lon, rho: rho };
  }

  /* ==========================================================================
     LAB 6 — coordinate transformation
     ========================================================================== */
  function initCoords() {
    const root = $("#lab-coords");
    if (!root) return;
    const canvas = $("#coordCanvas");
    const latIn = $("#coordLat"), lonIn = $("#coordLon"), xIn = $("#coordX"), yIn = $("#coordY");
    const err = $("#coordError");
    const outLat = $("#coordOutLat"), outLon = $("#coordOutLon"), outX = $("#coordOutX"), outY = $("#coordOutY");
    const outDist = $("#coordDist"), outAz = $("#coordAz"), outCover = $("#coordCover");
    let sites = null, current = { x: -11.575, y: -12.47 }, maxR = 60, syncing = false;

    loadSites()
      .then((d) => {
        sites = d;
        current = { x: d.sites[0].x / 1000, y: d.sites[0].y / 1000 };
        syncFromXY();
        draw();
      })
      .catch((e) => errorBox($("#coordLoading"), e.message));

    [latIn, lonIn].forEach((el) =>
      el.addEventListener("input", () => {
        if (syncing) return;
        const lat = parseFloat(latIn.value), lon = parseFloat(lonIn.value);
        if (!isFinite(lat) || !isFinite(lon)) return;
        hideError();
        if (lat < -90 || lat > 90) return showError("خط العرض يجب أن يكون بين −90° و+90°.");
        const p = latlonToXY(clamp(lat, -90, 90), ((lon % 360) + 360) % 360);
        current = { x: p.x, y: p.y };
        syncing = true;
        xIn.value = p.x.toFixed(2);
        yIn.value = p.y.toFixed(2);
        syncing = false;
        updateOut();
        draw();
      })
    );
    [xIn, yIn].forEach((el) =>
      el.addEventListener("input", () => {
        if (syncing) return;
        const x = parseFloat(xIn.value), y = parseFloat(yIn.value);
        if (!isFinite(x) || !isFinite(y)) return;
        hideError();
        if (Math.hypot(x, y) > 2 * R_MOON * 0.999) return showError("النقطة خارج نصف الكرة الجنوبي في هذا الإسقاط.");
        current = { x: x, y: y };
        syncing = true;
        const p = xyToLatLon(x, y);
        latIn.value = clamp(p.lat, -90, 90).toFixed(5);
        lonIn.value = p.lon.toFixed(4);
        syncing = false;
        updateOut();
        draw();
      })
    );
    if (canvas) {
      canvas.style.cursor = "crosshair";
      canvas.addEventListener("click", (ev) => {
        const r = canvas.getBoundingClientRect();
        const cx = r.width / 2, cy = r.height / 2;
        const scale = Math.min(r.width, r.height) / 2 - 18;
        const x = ((ev.clientX - r.left - cx) / scale) * maxR;
        const y = -((ev.clientY - r.top - cy) / scale) * maxR;
        current = { x: x, y: y };
        syncing = true;
        xIn.value = x.toFixed(2);
        yIn.value = y.toFixed(2);
        const p = xyToLatLon(x, y);
        latIn.value = clamp(p.lat, -90, 90).toFixed(5);
        lonIn.value = p.lon.toFixed(4);
        syncing = false;
        hideError();
        updateOut();
        draw();
      });
      watch(canvas, draw);
    }
    $$("[data-coord-preset]", root).forEach((b) =>
      b.addEventListener("click", () => {
        if (!sites) return;
        const id = b.dataset.coordPreset;
        const s = id === "pole" ? { x: 0, y: 0 } : sites.sites.filter((z) => z.id === id)[0];
        if (s) {
          const xKm = s.x / 1000, yKm = s.y / 1000;
          current = { x: xKm, y: yKm };
          syncing = true;
          xIn.value = xKm.toFixed(2);
          yIn.value = yKm.toFixed(2);
          const p = xyToLatLon(xKm, yKm);
          latIn.value = p.lat.toFixed(5);
          lonIn.value = p.lon.toFixed(4);
          syncing = false;
          updateOut();
          draw();
        }
      })
    );

    function showError(msg) {
      if (!err) return;
      err.hidden = false;
      err.className = "error-box";
      err.textContent = msg;
    }
    function hideError() {
      if (err) err.hidden = true;
    }
    function updateOut() {
      const p = xyToLatLon(current.x, current.y);
      outLat.textContent = Math.abs(p.lat).toFixed(4) + "°S";
      outLon.textContent = p.lon.toFixed(3) + "°E";
      outX.textContent = fmt(current.x, 2) + " km";
      outY.textContent = fmt(current.y, 2) + " km";
      outDist.textContent = fmt(p.rho, 1) + " km";
      outAz.textContent = fmt(p.lon, 1) + "°";
      let inside = [];
      if (sites) {
        const xm = current.x * 1000, ym = current.y * 1000;
        sites.sites.forEach((s) => {
          const m = sites.dem[s.dem];
          if (!m) return;
          const xmax = m.x0 + m.width * m.pixelM, ymin = m.y0 - m.height * m.pixelM;
          if (xm >= m.x0 && xm <= xmax && ym >= ymin && ym <= m.y0)
            inside.push(s.shortAr || s.id);
        });
      }
      outCover.textContent = inside.length ? "داخل تغطية: " + inside.join(" / ") : "خارج نماذج DEM الثلاثة";
      outCover.className = inside.length ? "green" : "amber";
    }
    function syncFromXY() {
      syncing = true;
      xIn.value = current.x.toFixed(2);
      yIn.value = current.y.toFixed(2);
      const p = xyToLatLon(current.x, current.y);
      latIn.value = p.lat.toFixed(5);
      lonIn.value = p.lon.toFixed(4);
      syncing = false;
      updateOut();
    }
    function draw() {
      if (!canvas) return;
      const p = xyToLatLon(current.x, current.y);
      maxR = Math.max(60, p.rho * 1.25, 30);
      if (sites) sites.sites.forEach((s) => (maxR = Math.max(maxR, (Math.hypot(s.x, s.y) / 1000) * 1.25)));
      maxR = Math.min(460, maxR);
      const f = fit(canvas);
      if (!f) return;
      const { ctx, w, h } = f;
      const cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) / 2 - 18;
      ctx.fillStyle = "#050b13";
      ctx.fillRect(0, 0, w, h);
      // rings
      const steps = [10, 20, 30, 50, 75, 100, 150, 200, 300, 400];
      const ringVals = steps.filter((v) => v <= maxR);
      ctx.strokeStyle = "rgba(90,216,230,.16)";
      ctx.fillStyle = C.dim;
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ringVals.forEach((r) => {
        const rr = (r / maxR) * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
        if (r % (ringVals.length > 4 ? 50 : 20) === 0) {
          ctx.fillText(r + " km", cx, cy - rr + 8);
        }
      });
      // meridians
      for (let lon = 0; lon < 360; lon += 45) {
        const a = lon * RAD;
        const x = cx + Math.sin(a) * scale, y = cy - Math.cos(a) * scale;
        ctx.strokeStyle = "rgba(90,216,230,.10)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
        if (lon % 90 === 0) {
          ctx.fillStyle = C.dim;
          ctx.textAlign = "center";
          ctx.fillText(lon + "°", cx + Math.sin(a) * (scale + 11), cy - Math.cos(a) * (scale + 10));
        }
      }
      // pole
      ctx.fillStyle = C.cyan;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.dim;
      ctx.textAlign = "left";
      ctx.fillText("القطب", cx + 6, cy + 9);

      // known sites
      if (sites) {
        sites.sites.forEach((s) => {
          const rr = ((Math.hypot(s.x, s.y) / 1000) / maxR) * scale;
          const a = Math.atan2(s.x, s.y);
          const x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
          ctx.fillStyle = s.color;
          ctx.strokeStyle = "rgba(5,11,19,.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fill();
        });
      }
      // selected point
      const rr = (Math.hypot(current.x, current.y) / maxR) * scale;
      const a = Math.atan2(current.x, current.y);
      const px = cx + Math.sin(a) * rr, py = cy - Math.cos(a) * rr;
      ctx.save();
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 13, py);
      ctx.lineTo(px + 13, py);
      ctx.moveTo(px, py - 13);
      ctx.lineTo(px, py + 13);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = C.amber;
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.textAlign = px > cx ? "right" : "left";
      ctx.fillText(Math.abs(p.lat).toFixed(3) + "°S", px + (px > cx ? -12 : 12), py - 10);
      ctx.fillStyle = C.dim;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("إسقاط قطبي جنوبي · x شرق، y نحو خط الطول 0°", 8, h - 8);
      status($("#coordStatus"), "نصف قطر مرجعي " + fmt(R_MOON, 1) + " km · مقياس " + fmt(maxR, 0) + " km");
    }
  }

  /* ==========================================================================
     LAB 7 — 365-day lighting calendar
     ========================================================================== */
  function initCalendar() {
    const root = $("#lab-calendar");
    if (!root) return;
    const sel = $("#calSite");
    const canvas = $("#calCanvas");
    const hover = $("#calHover");
    const dayBox = $("#calDay");
    const bestBox = $("#calBest");
    let sites, daily, site, selected = 3, best = { start: 0, end: 13 };
    loadingBox($("#calLoading"), "جارٍ تحميل تقويم الإضاءة…");
    loadSites()
      .then((d) => {
        sites = d;
        siteOptions(sel, sites, "site01");
        site = siteById(sites, "site01");
        return loadDaily("site01");
      })
      .then((d) => {
        daily = d;
        computeBest();
        bind();
        renderDay(selected);
        draw();
        const lb = $("#calLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => {
        errorBox($("#calLoading"), e.message);
        status($("#calStatus"), "خطأ", "error");
      });

    function computeBest() {
      let bestScore = -1;
      for (let s = 0; s <= 365 - 14; s++) {
        let sum = 0;
        for (let i = s; i < s + 14; i++) sum += daily.days[i].sunH / 24 + daily.days[i].earthH / 24;
        const score = sum / (14 * 2);
        if (score > bestScore) {
          bestScore = score;
          best = { start: s, end: s + 13 };
        }
      }
      if (bestBox && daily)
        bestBox.textContent =
          daily.days[best.start].d + " → " + daily.days[best.end].d + " · متوسط التوافر (شمس + أرض) " + fmt(bestScore * 100, 1) + "%";
    }
    function bind() {
      sel.addEventListener("change", () => {
        site = siteById(sites, sel.value);
        status($("#calStatus"), "جارٍ تحميل…", "loading");
        loadDaily(site.id)
          .then((d) => {
            daily = d;
            computeBest();
            renderDay(selected);
            draw();
          })
          .catch((e) => errorBox($("#calLoading"), e.message));
      });
      canvas.addEventListener("pointermove", (ev) => {
        if (!daily) return;
        const r = canvas.getBoundingClientRect();
        const i = clamp(Math.floor(((ev.clientX - r.left - 54) / (r.width - 70)) * 365), 0, 364);
        const d = daily.days[i];
        hover.textContent = d.d + " · شمس " + fmt(d.sunH, 1) + " h · أرض " + fmt(d.earthH, 1) + " h";
      });
      canvas.addEventListener("click", (ev) => {
        if (!daily) return;
        const r = canvas.getBoundingClientRect();
        selected = clamp(Math.floor(((ev.clientX - r.left - 54) / (r.width - 70)) * 365), 0, 364);
        renderDay(selected);
        draw();
      });
      canvas.addEventListener("pointerleave", () => {
        hover.textContent = "اختر يومًا لعرض تفاصيله. النافذة الذهبية = أفضل 14 يومًا (تقييم تعليمي).";
      });
      watch(canvas, draw);
    }
    function renderDay(i) {
      if (!daily) return;
      const d = daily.days[i];
      dayBox.innerHTML =
        "<b>" + d.d + "</b> · شمس <b>" + fmt(d.sunH, 1) + " h</b> · أرض <b>" + fmt(d.earthH, 1) +
        " h</b> · ارتفاع الشمس " + signed(d.sunElMin, 2) + " إلى " + signed(d.sunElMax, 2) +
        " · ارتفاع الأرض " + signed(d.earthElMin, 2) + " إلى " + signed(d.earthElMax, 2);
    }
    function colorFor(v, hue) {
      const t = clamp(v, 0, 1);
      if (hue === "green") return "rgba(94,224,160," + (0.08 + t * 0.8) + ")";
      return "rgba(92,141,255," + (0.08 + t * 0.8) + ")";
    }
    function draw() {
      if (!daily) return;
      const f = fit(canvas);
      if (!f) return;
      const { ctx, w, h } = f;
      const pad = { l: 54, r: 16, t: 22, b: 26 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const cw = iw / 365;
      const rh = ih / 2;
      ctx.fillStyle = "#050b13";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.textBaseline = "middle";
      // rows
      ctx.fillStyle = C.muted;
      ctx.textAlign = "right";
      ctx.font = "10px IBM Plex Sans Arabic, sans-serif";
      ctx.fillText("شمس", pad.l - 7, pad.t + rh / 2);
      ctx.fillText("أرض", pad.l - 7, pad.t + rh * 1.5);
      for (let d = 0; d < 365; d++) {
        const x = pad.l + d * cw;
        const day = daily.days[d];
        ctx.fillStyle = colorFor(day.sunH / 24, "green");
        ctx.fillRect(x, pad.t, Math.max(1, cw + 0.3), rh - 2);
        ctx.fillStyle = colorFor(day.earthH / 24, "blue");
        ctx.fillRect(x, pad.t + rh, Math.max(1, cw + 0.3), rh - 2);
      }
      // best window outline
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(pad.l + best.start * cw, pad.t - 3, (best.end - best.start + 1) * cw, ih + 3);
      ctx.setLineDash([]);
      // selected day
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(pad.l + selected * cw, pad.t - 2, Math.max(2, cw), ih + 2);
      // month labels
      let lastMonth = daily.days[0].d.slice(0, 7);
      ctx.fillStyle = C.muted;
      ctx.textAlign = "center";
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      daily.days.forEach((d, i) => {
        const m = d.d.slice(0, 7);
        if (m !== lastMonth) {
          lastMonth = m;
          if (i % 2 === 0) ctx.fillText(MONTHS_SHORT[(+m.slice(5) === 11 ? 0 : +m.slice(5) === 12 ? 1 : +m.slice(5) - 1)], pad.l + i * cw, 10);
        }
      });
      ctx.fillStyle = C.dim;
      ctx.textAlign = "left";
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.fillText("شدة اللون = ساعات الظهور/24 ساعة", 8, h - 8);
      status($("#calStatus"), "JPL Horizons + LOLA 5 m · " + site.id);
    }
  }

  /* ==========================================================================
     LAB 8 — scenario comparison
     ========================================================================== */
  function initCompare() {
    const root = $("#lab-compare");
    if (!root) return;
    const bars = $("#cmpBars");
    const table = $("#cmpTable");
    const statusEl = $("#cmpStatus");
    let sites = null;
    const inputs = {
      sun: $("#cmpSun"),
      earth: $("#cmpEarth"),
      slope: $("#cmpSlope"),
      dark: $("#cmpDark"),
      minSun: $("#cmpMinSun"),
      minEarth: $("#cmpMinEarth"),
      maxSlope: $("#cmpMaxSlope"),
    };
    loadingBox($("#cmpLoading"), "جارٍ تحميل مواقع المقارنة…");
    loadSites()
      .then((d) => {
        sites = d;
        Object.keys(inputs).forEach((k) => {
          if (inputs[k]) inputs[k].addEventListener("input", render);
        });
        render();
        const lb = $("#cmpLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => {
        errorBox($("#cmpLoading"), e.message);
        status(statusEl, "خطأ", "error");
      });

    function weights() {
      const w = {
        sun: +(inputs.sun ? inputs.sun.value : 4),
        earth: +(inputs.earth ? inputs.earth.value : 4),
        slope: +(inputs.slope ? inputs.slope.value : 2),
        dark: +(inputs.dark ? inputs.dark.value : 3),
      };
      const sum = w.sun + w.earth + w.slope + w.dark;
      return { w: w, sum: sum };
    }
    function render() {
      if (!sites) return;
      Object.keys(inputs).forEach((k) => {
        const out = $("#" + k + "Val");
        if (out && inputs[k]) out.textContent = inputs[k].value;
      });
      const { w, sum } = weights();
      const minSun = inputs.minSun ? +inputs.minSun.value : 0;
      const minEarth = inputs.minEarth ? +inputs.minEarth.value : 0;
      const maxSlope = inputs.maxSlope ? +inputs.maxSlope.value : 99;
      const rows = sites.sites.map((s) => {
        const sun = s.sunPct / 100;
        const earth = s.earthPct / 100;
        const slope = 1 / (1 + s.slopeDeg / 3);
        const dark = 1 - Math.min(1, s.longestDarkHours / 800);
        const score = sum > 0 ? (w.sun * sun + w.earth * earth + w.slope * slope + w.dark * dark) / sum : 0;
        const pass = s.sunPct >= minSun && s.earthPct >= minEarth && s.slopeDeg <= maxSlope;
        return { site: s, sun: sun, earth: earth, slope: slope, dark: dark, score: score, pass: pass };
      });
      rows.sort((a, b) => b.score - a.score);
      bars.innerHTML = "";
      rows.forEach((r, i) => {
        const row = document.createElement("div");
        row.className = "cbar";
        const label = document.createElement("span");
        label.textContent = (i + 1) + ". " + L.siteName(r.site);
        label.style.color = r.site.color;
        const track = document.createElement("div");
        track.className = "track";
        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.width = Math.round(r.score * 100) + "%";
        fill.style.background = "linear-gradient(90deg," + r.site.color + "," + r.site.color + ")";
        fill.style.opacity = ".8";
        track.appendChild(fill);
        const val = document.createElement("b");
        val.textContent = Math.round(r.score * 100);
        row.append(label, track, val);
        bars.appendChild(row);
      });
      if (table) {
        const trs = rows
          .map(
            (r, i) =>
              "<tr><td>" +
              (i + 1) +
              "</td><td><span style='color:" +
              r.site.color +
              "'>" +
              L.siteName(r.site) +
              "</span></td><td class='mono'>" +
              fmt(r.site.sunPct, 1) +
              "%</td><td class='mono'>" +
              fmt(r.site.earthPct, 1) +
              "%</td><td class='mono'>" +
              fmt(r.site.slopeDeg, 2) +
              "°</td><td class='mono'>" +
              fmt(r.site.longestDarkHours, 0) +
              " h</td><td class='" +
              (r.pass ? "ok" : "no") +
              "'>" +
              (r.pass ? "مطابق" : "غير مطابق") +
              "</td></tr>"
          )
          .join("");
        table.innerHTML =
          "<div class='table-wrap'><table class='data-table'><thead><tr><th>#</th><th>الموقع</th><th>شمس %</th><th>أرض %</th><th>ميل</th><th>أطول ظلام</th><th>القيود</th></tr></thead><tbody>" +
          trs +
          "</tbody></table></div>";
      }
      const qualified = rows.filter((r) => r.pass).length;
      if (statusEl)
        status(
          statusEl,
          sum === 0
            ? "كل الأوزان صفر — ارفع وزنًا واحدًا على الأقل."
            : qualified + " من " + rows.length + " مواقع تحقق القيود المحددة · ترتيب تعليمي وليس توصية رسمية"
        );
    }
  }

  /* ==========================================================================
     LAB 9 — solar power budget
     ========================================================================== */
  function initPower() {
    const root = $("#lab-power");
    if (!root) return;
    const sel = $("#pwSite");
    let sites, site;
    const f = {
      area: $("#pwArea"),
      eff: $("#pwEff"),
      packing: $("#pwPacking"),
      incidence: $("#pwIncidence"),
      load: $("#pwLoad"),
      battery: $("#pwBattery"),
      loss: $("#pwLoss"),
    };
    loadingBox($("#pwLoading"), "جارٍ تحميل بيانات الموقع…");
    loadSites()
      .then((d) => {
        sites = d;
        siteOptions(sel, sites, "site01");
        site = siteById(sites, "site01");
        syncSite();
        Object.keys(f).forEach((k) => f[k] && f[k].addEventListener("input", update));
        if (f.incidence) f.incidence.addEventListener("change", update);
        update();
        const lb = $("#pwLoading"); if (lb) lb.innerHTML = "";
      })
      .catch((e) => errorBox($("#pwLoading"), e.message));

    function syncSite() {
      if (!site) return;
      $("#pwSunPct").textContent = fmt(site.sunPct, 2) + "%";
      $("#pwDarkH").textContent = fmt(site.longestDarkHours, 0) + " h";
      $("#pwSiteOut").textContent = site.nameAr;
      if (sel.value !== site.id) sel.value = site.id;
    }
    function update() {
      if (!site) return;
      const area = Math.max(0.1, +(f.area.value || 0));
      const eff = clamp(+(f.eff.value || 0) / 100, 0, 1);
      const packing = clamp(+(f.packing.value || 0) / 100, 0, 1);
      const inc = +(f.incidence.value || 1);
      const load = Math.max(0, +(f.load.value || 0));
      const battery = Math.max(0, +(f.battery.value || 0));
      const loss = clamp(+(f.loss.value || 0) / 100, 0, 0.95);
      const sunFrac = site.sunPct / 100;
      const darkH = site.longestDarkHours;
      const gen = 1361.6 * area * packing * eff * inc * (1 - loss);
      const energySolar = gen * sunFrac * 24; // Wh/day average
      const energyLoad = load * 24;
      const needBattery = (load * darkH) / 1000;
      const margin = energySolar - energyLoad;
      $("#pwGen").textContent = fmt(gen, 0) + " W";
      $("#pwEnergy").textContent = fmt(energySolar / 1000, 2) + " kWh/day";
      $("#pwLoadE").textContent = fmt(energyLoad / 1000, 2) + " kWh/day";
      $("#pwMargin").textContent = (margin >= 0 ? "+" : "−") + fmt(Math.abs(margin) / 1000, 2) + " kWh/day";
      $("#pwNeed").textContent = fmt(needBattery, 2) + " kWh";
      $("#pwBatteryOut").textContent = fmt(battery, 2) + " kWh";
      const okEnergy = margin > 0;
      const okBattery = battery >= needBattery;
      const verdict = !okEnergy
        ? "عجز في متوسط الطاقة اليومي"
        : !okBattery
        ? "الطاقة كافية، لكن البطارية أصغر من حاجة أطول ظلام"
        : "متوازن وفق هذه الافتراضات";
      $("#pwVerdict").textContent = verdict;
      $("#pwVerdict").className = !okEnergy ? "red" : !okBattery ? "amber" : "green";
      const barGen = $("#pwGenBar"), barUse = $("#pwUseBar");
      const max = Math.max(energySolar / 1000, energyLoad / 1000, 0.1);
      if (barGen) barGen.style.width = Math.round((energySolar / 1000 / max) * 100) + "%";
      if (barUse) barUse.style.width = Math.round((energyLoad / 1000 / max) * 100) + "%";
      $("#pwGenBarLabel").textContent = fmt(energySolar / 1000, 2) + " kWh";
      $("#pwUseBarLabel").textContent = fmt(energyLoad / 1000, 2) + " kWh";
      status($("#pwStatus"), "افتراضات هندسية معلنة — ليست تصميمًا طيرانًا · " + site.id);
    }
    if (sel)
      sel.addEventListener("change", () => {
        site = siteById(sites, sel.value);
        syncSite();
        update();
      });
  }

  /* ==========================================================================
     LAB 10 — one-way link budget
     ========================================================================== */
  function initLink() {
    const root = $("#lab-link");
    if (!root) return;
    const band = $("#lkBand");
    const fields = ["lkPower", "lkGtx", "lkGrx", "lkDist", "lkRate", "lkTemp", "lkLoss", "lkEb"].map((id) => $("#" + id));
    function update() {
      const freq = +(band.value || 8.4) * 1e9;
      const powerW = Math.max(0.001, +($("#lkPower").value || 0));
      const gtx = +($("#lkGtx").value || 0);
      const grx = +($("#lkGrx").value || 0);
      const distKm = Math.max(1, +($("#lkDist").value || 0));
      const rateKbps = Math.max(0.001, +($("#lkRate").value || 0));
      const tempK = Math.max(1, +($("#lkTemp").value || 0));
      const lossDb = +($("#lkLoss").value || 0);
      const reqEb = +($("#lkEb").value || 0);
      const d = distKm * 1000;
      const lam = 299792458 / freq;
      const fspl = 20 * Math.log10((4 * Math.PI * d) / lam);
      const eirp = 10 * Math.log10(powerW * 1000) + gtx;
      const prx = eirp - fspl + grx - lossDb;
      const rateBps = rateKbps * 1000;
      const bw = rateBps * 1.25;
      const k = 1.380649e-23;
      const noiseW = k * tempK * bw;
      const noiseDbm = 10 * Math.log10(noiseW * 1000);
      const ebn0 = prx - noiseDbm + 10 * Math.log10(bw / rateBps);
      const margin = ebn0 - reqEb;
      const lt = d / 299792458;
      $("#lkFspl").textContent = fmt(fspl, 1) + " dB";
      $("#lkEirp").textContent = fmt(eirp, 1) + " dBm";
      $("#lkPrx").textContent = fmt(prx, 1) + " dBm";
      $("#lkNoise").textContent = fmt(noiseDbm, 1) + " dBm";
      $("#lkEbn0").textContent = fmt(ebn0, 1) + " dB";
      $("#lkMargin").textContent = (margin >= 0 ? "+" : "−") + fmt(Math.abs(margin), 1) + " dB";
      $("#lkMargin").className = margin >= 0 ? "green" : "red";
      $("#lkLt").textContent = "أحادي الاتجاه " + fmt(lt, 2) + " s · ذهاب وعودة " + fmt(2 * lt, 2) + " s";
      $("#lkVerdict").textContent = margin >= 0 ? "هامش موجب وفق هذه الافتراضات" : "هامش سالب: الوصلة لا تحقق Eb/N0 المطلوب";
      $("#lkVerdict").className = margin >= 0 ? "green" : "red";
      // Eb/N0 = Prx - N0 - 10log10(R), where N0 = kT (dBm/Hz).
      const n0Dbm = 10 * Math.log10(k * tempK * 1000);
      const maxBps = Math.pow(10, (prx - n0Dbm - reqEb) / 10);
      $("#lkMax").textContent = maxBps > 1e3 ? fmt(maxBps / 1000, 1) + " kb/s (تقريبي)" : "أقل من 1 kb/s";
      $("#lkFreq").textContent = fmt(freq / 1e9, 2) + " GHz";
      status($("#lkStatus"), "حساب أحادي الاتجاه · غلاف جوي قمري مهمَل (لا يوجد) · " + fmt(distKm, 0) + " km");
    }
    if (band) {
      band.addEventListener("change", () => {
        const f = +band.value;
        $("#lkGtx").value = f >= 30 ? 42 : f >= 8 ? 35 : 26;
        $("#lkGrx").value = f >= 30 ? 46 : f >= 8 ? 40 : 30;
        update();
      });
      fields.forEach((el) => el && el.addEventListener("input", update));
      update();
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initCoords();
    initCalendar();
    initCompare();
    initPower();
    initLink();
  });
})();
