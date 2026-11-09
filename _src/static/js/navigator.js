/* ==========================================================================
   Lunar Mission Navigator — workspace controller
   --------------------------------------------------------------------------
   Binds the integrated navigator UI to the dependency-free scientific engine
   in navigator-engine.js. It uses only local JSON, binary DEM tiles, and
   canvas rendering. No external requests, no analytics, no invented data.
   ========================================================================== */
(function () {
  "use strict";

  var E = window.LMN;
  if (!E) {
    var fail = document.getElementById("scenarioStatus");
    if (fail) {
      fail.className = "lab-status error";
      fail.textContent = "تعذّر تحميل محرك الحساب.";
    }
    return;
  }

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var $id = function (id) { return document.getElementById(id); };

  var C = {
    cyan: "#5ad8e6", cyan2: "#25b4c7", blue: "#5c8dff", green: "#5ee0a0",
    amber: "#ffb454", red: "#ff7373", violet: "#b39dff", text: "#e8f2fb",
    muted: "#91a9c2", dim: "#647c93", grid: "rgba(90,216,230,.12)",
    panel: "#07111c", dark: "#05090f", sun: "#ffcf6b", earth: "#5ad8e6",
    horizon: "#7fc7d9", overlap: "#b39dff", power: "#5ee0a0",
  };
  var CARDINALS = ["شمال", "شمال-شرق", "شرق", "جنوب-شرق", "جنوب", "جنوب-غرب", "غرب", "شمال-غرب"];
  var TABS = ["overview", "simulator", "horizon", "timeline", "delay", "compare", "engineering", "method"];

  var state = {
    sitesDoc: null,
    sites: [],
    byId: {},
    ephem: {},
    daily: {},
    site: null,
    customSite: null,
    customHorizon: null,
    sim: null,
    provider: null,
    referenceId: null,
    startMs: E.DATA_START_MS,
    durationH: 168,
    stepMinutes: 30,
    selectedMs: E.DATA_START_MS,
    tzOffset: 0,
    tab: "overview",
    powerSim: null,
    powerParams: null,
    delay: null,
    compare: null,
    link: null,
    demPromises: {},
    demGrids: {},
    horizonCache: {},
    running: false,
    playing: false,
    playTimer: null,
    timelineZoom: 1,
    timelineCenter: 0.5,
    timelineLayout: null,
    timelineHover: null,
    miniHover: null,
    resizeTimer: null,
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function setText(id, value) {
    var node = $id(id);
    if (node) node.textContent = value == null ? "—" : String(value);
  }

  function setHTML(id, value) {
    var node = $id(id);
    if (node) node.innerHTML = value == null ? "" : value;
  }

  function setClass(id, cls) {
    var node = $id(id);
    if (node) node.className = cls || "";
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function azNorm(a) { return ((a % 360) + 360) % 360; }

  function fmt(v, digits) {
    if (v == null || !isFinite(v)) return "—";
    return Number(v).toFixed(digits == null ? 1 : digits);
  }

  // Wrap a primarily numeric/Latin string in a Unicode LTR isolate so that
  // mixed-direction labels such as "168.0 h" or "-75.1 pp" keep their
  // intended order inside the Arabic RTL interface.
  function ltrValue(s) { return "\u2066" + s + "\u2069"; }

  function numUnit(v, unit, digits, tight) {
    if (v == null || !isFinite(v)) return "—";
    return ltrValue(fmt(v, digits) + (unit ? (tight ? "" : " ") + unit : ""));
  }

  function signedUnit(v, unit, digits, tight) {
    if (v == null || !isFinite(v)) return "—";
    return ltrValue(signed(v, digits) + (unit ? (tight ? "" : " ") + unit : ""));
  }

  function fmtPct(v, digits) {
    if (v == null || !isFinite(v)) return "—";
    return ltrValue(fmt(v, digits == null ? 1 : digits) + "%");
  }

  function fmtH(v, digits) {
    if (v == null || !isFinite(v)) return "—";
    return ltrValue(fmt(v, digits == null ? 1 : digits) + " h");
  }

  function fmtDeg(v) {
    if (v == null || !isFinite(v)) return "—";
    return ltrValue(fmt(v, 2) + "°");
  }

  function fmtDistance(km) {
    if (km == null || !isFinite(km)) return "—";
    if (km < 1e6) return ltrValue(fmt(km, 0) + " km");
    return ltrValue(fmt(km / E.AU_KM, 3) + " AU");
  }

  function signed(v, digits) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + fmt(v, digits == null ? 1 : digits);
  }

  function cardinal(az) {
    var idx = Math.round(azNorm(az) / 45) % 8;
    return CARDINALS[idx];
  }

  function stateLabel(s) {
    if (s === "visible") return "مرئي";
    if (s === "obstructed") return "محجوب";
    if (s === "below") return "تحت الأفق";
    if (s === "geometric") return "هندسي";
    return "غير متاح";
  }

  function stateClass(s) {
    if (s === "visible") return "ok";
    if (s === "obstructed") return "warn";
    if (s === "below") return "no";
    if (s === "geometric") return "cyan";
    return "";
  }

  function clockISO(ms) {
    return new Date(ms).toISOString().slice(11, 16);
  }

  function dateISO(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function tzText() {
    var off = state.tzOffset;
    if (!off) return "UTC";
    var sign = off >= 0 ? "+" : "−";
    var a = Math.abs(off);
    return "UTC" + sign + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
  }

  function axisTime(ms, spanMs, compact) {
    var d = new Date(ms + state.tzOffset * 60000);
    var iso = d.toISOString();
    if (spanMs != null && spanMs <= 3 * 86400000) return iso.slice(11, 16);
    if (compact) return iso.slice(5, 10);
    return iso.slice(5, 10) + " " + iso.slice(11, 16);
  }

  function selectedLabel(ms) {
    return ltrValue(E.timeLabel(ms, state.tzOffset, true));
  }

  function timeHTML(label) {
    var parts = String(label).split(" · ");
    if (parts.length < 2) return esc(label);
    return '<span class="nav-nowrap">' + esc(parts[0]) + '</span> <span class="nav-nowrap">· ' +
      esc(parts.slice(1).join(" · ")) + "</span>";
  }

  function siteLabel(site) {
    return site.shortAr || site.nameAr || site.id;
  }

  function fillReadouts(containerId, items) {
    var box = $id(containerId);
    if (!box) return;
    box.innerHTML = items.map(function (x) {
      return '<div class="readout"><small>' + esc(x.label) + '</small><b class="' + (x.cls || "") + '">' + x.value + "</b></div>";
    }).join("");
  }

  function fillRows(tbodyId, rows) {
    var body = $id(tbodyId);
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="nav-empty">لا توجد بيانات لعرضها.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      return "<tr>" + r.map(function (cell) { return "<td>" + cell + "</td>"; }).join("") + "</tr>";
    }).join("");
  }

  function setScenarioStatus(kind, html) {
    var node = $id("scenarioStatus");
    if (!node) return;
    node.className = "lab-status" + (kind === "error" ? " error" : kind === "loading" ? " loading" : "");
    node.innerHTML = '<span class="dot"></span>' + html;
  }

  function clearError() {
    var box = $id("navError");
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function showError(message) {
    setScenarioStatus("error", "تعذّر تشغيل السيناريو");
    var box = $id("navError");
    if (!box) {
      box = document.createElement("div");
      box.id = "navError";
      box.className = "error-box";
      box.style.margin = "8px 0";
      var anchor = $id("dataStatus");
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    box.textContent = message;
  }

  function fetchJson(url) {
    if (window.LLSN && window.LLSN.fetchJSON) return window.LLSN.fetchJSON(url, { timeout: 20000 });
    return fetch(url, { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " — " + url);
      return r.json();
    });
  }

  function fetchBuffer(url) {
    return fetch(url, { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " — " + url);
      return r.arrayBuffer();
    });
  }

  function tick() {
    return new Promise(function (resolve) { setTimeout(resolve, 20); });
  }

  /* ------------------------------------------------------------------ */
  /* Data loading                                                        */
  /* ------------------------------------------------------------------ */

  function loadData() {
    setScenarioStatus("loading", "جارٍ تحميل بيانات المواقع والفلك…");
    fetchJson("assets/data/sites.json")
      .then(function (doc) {
        var errors = E.validateSitesDocument(doc);
        if (errors.length) throw new Error("sites.json: " + errors.join("; "));
        state.sitesDoc = doc;
        state.sites = doc.sites;
        state.byId = {};
        doc.sites.forEach(function (s) { state.byId[s.id] = s; });
        populateSiteControls();
        return Promise.all(doc.sites.map(function (site) {
          return Promise.all([
            fetchJson("assets/data/ephemeris_" + site.id + ".json"),
            fetchJson("assets/data/daily_" + site.id + ".json"),
          ]).then(function (pair) {
            var e = pair[0], d = pair[1];
            var errs = E.validateEphemeris(e).concat(E.validateDaily(d));
            if (errs.length) throw new Error(site.id + ": " + errs.join("; "));
            state.ephem[site.id] = e;
            state.daily[site.id] = d;
          });
        }));
      })
      .then(function () {
        setText("dataStatus", "");
        setHTML("dataStatus",
          '<span class="tag tag-data">REAL · JPL Horizons</span>' +
          '<span class="tag tag-data">REAL · LOLA</span>' +
          '<span class="meta-chip">3 نقاط · 8,760 ساعة لكل نقطة</span>' +
          '<span class="meta-chip">UTC داخليًا</span>'
        );
        state.site = state.byId.site01 || state.sites[0];
        state.startMs = E.DATA_START_MS + 19 * 86400000; // 2026-11-20
        state.durationH = 168;
        state.stepMinutes = 30;
        state.selectedMs = state.startMs;
        setInputsFromState();
        renderMethodValidation();
        return runScenario({ initial: true });
      })
      .catch(function (err) {
        showError("تعذّر تحميل بيانات المُوجِّه: " + err.message);
        setHTML("dataStatus", '<span class="tag tag-assumption">DATA ERROR</span>');
      });
  }

  function populateSiteControls() {
    var select = $id("siteSelect");
    if (select) {
      select.innerHTML = state.sites.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.shortAr || s.nameAr) + " — " + esc(s.nameEn || "") + "</option>";
      }).join("") + '<option value="custom">إحداثيات مخصصة…</option>';
      select.value = (state.site && state.site.id) || "site01";
    }
    var delay = $id("delaySiteB");
    if (delay) {
      delay.innerHTML = state.sites.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.shortAr || s.nameAr) + "</option>";
      }).join("");
      delay.value = state.site ? state.site.id : "site01";
    }
    var checks = $id("compareSites");
    if (checks) {
      checks.innerHTML = state.sites.map(function (s) {
        return '<label><input type="checkbox" value="' + esc(s.id) + '" checked> ' + esc(s.shortAr || s.nameAr) + "</label>";
      }).join("");
    }
  }

  function setInputsFromState() {
    var date = $id("startDate");
    var time = $id("startTime");
    var dur = $id("durationHours");
    var step = $id("stepMinutes");
    var tz = $id("tzOffset");
    if (date) date.value = dateISO(state.startMs);
    if (time) time.value = clockISO(state.startMs);
    if (dur) dur.value = String(state.durationH);
    if (step) step.value = String(state.stepMinutes);
    if (tz) tz.value = String(state.tzOffset);
  }

  /* ------------------------------------------------------------------ */
  /* Custom terrain and geometry                                         */
  /* ------------------------------------------------------------------ */

  function angularDistance(a, b) {
    var d = Math.PI / 180;
    var la1 = a.lat * d, la2 = b.lat * d;
    var dlon = (b.lon - a.lon) * d;
    var c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dlon);
    return Math.acos(clamp(c, -1, 1)) * 180 / Math.PI;
  }

  function nearestSite(site) {
    var best = null, bestD = Infinity;
    state.sites.forEach(function (s) {
      var dist = angularDistance(site, s);
      if (dist < bestD) { bestD = dist; best = s; }
    });
    return best || state.sites[0];
  }

  function demForPoint(x, y) {
    var dem = state.sitesDoc && state.sitesDoc.dem ? state.sitesDoc.dem : {};
    for (var key in dem) {
      if (Object.prototype.hasOwnProperty.call(dem, key) && E.demContains(dem[key], x, y)) return dem[key];
    }
    return null;
  }

  function loadDem(meta) {
    if (state.demGrids[meta.id]) return Promise.resolve(state.demGrids[meta.id]);
    if (state.demPromises[meta.id]) return state.demPromises[meta.id];
    var promise = fetchBuffer("assets/data/" + meta.file).then(function (buffer) {
      var expected = meta.width * meta.height * 2;
      if (buffer.byteLength !== expected) {
        throw new Error("DEM " + meta.id + " has " + buffer.byteLength + " bytes, expected " + expected);
      }
      var view = new DataView(buffer);
      var grid = {
        meta: meta,
        sample: function (x, y) {
          var col = (x - meta.x0) / meta.pixelM;
          var row = (meta.y0 - y) / meta.pixelM;
          if (col < 0 || row < 0 || col >= meta.width - 1 || row >= meta.height - 1) return NaN;
          var c0 = Math.floor(col);
          var r0 = Math.floor(row);
          var fc = col - c0;
          var fr = row - r0;
          function value(cc, rr) {
            var idx = (rr * meta.width + cc) * 2;
            var z = view.getInt16(idx, true);
            return z <= -32000 ? NaN : z;
          }
          var a = value(c0, r0), b = value(c0 + 1, r0), c = value(c0, r0 + 1), d = value(c0 + 1, r0 + 1);
          if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return NaN;
          return a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + c * (1 - fc) * fr + d * fc * fr;
        },
      };
      state.demGrids[meta.id] = grid;
      return grid;
    });
    state.demPromises[meta.id] = promise;
    return promise;
  }

  function customHorizonFor(site) {
    var key = site.lat.toFixed(4) + "|" + site.lon.toFixed(4);
    if (state.horizonCache[key]) return Promise.resolve(state.horizonCache[key]);
    var xy = E.latLonToXY(site.lat, site.lon);
    var meta = demForPoint(xy.x, xy.y);
    if (!meta) {
      var none = {
        available: false,
        reason: "outside-dem",
        message: "الموقع خارج نافذتي DEM المشحونتين؛ نتائج التضاريس غير متاحة ولا تُقدَّر.",
        partial: false,
      };
      state.horizonCache[key] = none;
      return Promise.resolve(none);
    }
    return loadDem(meta).then(function (grid) {
      var z = grid.sample(xy.x, xy.y);
      if (!isFinite(z)) {
        var missing = {
          available: false,
          reason: "nodata",
          message: "نافذة DEM تغطي الإحداثيات، لكن قيمة الارتفاع عند النقطة مفقودة.",
          partial: false,
          demId: meta.id,
        };
        state.horizonCache[key] = missing;
        return missing;
      }
      var horizon = E.computeTerrainHorizon({
        sample: grid.sample,
        x: xy.x,
        y: xy.y,
        z: z,
        lon: site.lon,
        azimuthSamples: 360,
        maxDistanceM: 9000,
        stepM: 10,
      });
      horizon.available = true;
      horizon.source = "DEM " + meta.id + " — 20 m/px raster, browser-computed";
      horizon.resolutionM = 20;
      horizon.demId = meta.id;
      horizon.observerZ = z;
      state.horizonCache[key] = horizon;
      return horizon;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scenario input and execution                                        */
  /* ------------------------------------------------------------------ */

  function readScenarioInputs() {
    var date = $id("startDate") ? $id("startDate").value : "";
    var time = $id("startTime") ? $id("startTime").value : "00:00";
    var startMs = E.parseUtc(date + "T" + (time || "00:00") + "Z");
    if (!isFinite(startMs)) return { error: "تاريخ أو وقت البداية غير صالح. استخدم توقيت UTC." };

    var duration = Number($id("durationHours") ? $id("durationHours").value : 168);
    var step = Number($id("stepMinutes") ? $id("stepMinutes").value : 30);
    var tz = Number($id("tzOffset") ? $id("tzOffset").value : 0);
    if (!isFinite(duration) || duration <= 0 || duration > 8760) {
      return { error: "المدة يجب أن تكون بين 1 و8760 ساعة." };
    }
    if (!isFinite(step) || step <= 0) return { error: "الفاصل الزمني غير صالح." };

    var selected = $id("siteSelect") ? $id("siteSelect").value : "site01";
    var site = null;
    var custom = selected === "custom";
    if (custom) {
      var name = ($id("customName") ? $id("customName").value : "").trim() || "موقع مخصص";
      var lat = Number($id("customLat") ? $id("customLat").value : NaN);
      var lon = Number($id("customLon") ? $id("customLon").value : NaN);
      if (!isFinite(lat) || !isFinite(lon)) return { error: "أدخل خط عرض وخط طول رقميين للموقع المخصص." };
      if (lat < -90 || lat > -60) return { error: "هذه النسخة تدعم الإحداثيات المخصصة بين −90° و−60° فقط." };
      if (lon < 0 || lon > 360) return { error: "خط الطول الشرقي يجب أن يكون بين 0° و360°." };
      site = {
        id: "custom",
        nameAr: name,
        nameEn: "Custom selenographic coordinates",
        shortAr: name,
        role: "إحداثيات مخصصة",
        lat: lat,
        lon: lon,
        altM: null,
        slopeDeg: null,
        color: C.amber,
        custom: true,
      };
      state.customSite = site;
    } else {
      site = state.byId[selected] || state.sites[0];
    }

    var scenario = {
      site: site,
      startMs: startMs,
      durationHours: duration,
      stepMinutes: step,
    };
    var errors = E.validateScenario(scenario);
    if (errors.length) {
      return {
        error: "النافذة المطلوبة خارج نطاق البيانات المتاح 2026-11-01 → 2027-11-01 UTC. " +
          "ابدأ داخل النطاق واجعل النهاية قبل 2027-11-01T00:00Z.",
      };
    }
    return {
      site: site,
      custom: custom,
      startMs: startMs,
      durationHours: duration,
      stepMinutes: step,
      tzOffset: isFinite(tz) ? tz : 0,
    };
  }

  function geometryFor(site) {
    if (!site.custom) {
      return {
        provider: E.createGeometryProvider({
          site: site,
          ephem: state.ephem[site.id],
          daily: state.daily[site.id],
        }),
        referenceId: site.id,
      };
    }
    var ref = nearestSite(site);
    return {
      provider: E.createGeometryProvider({
        site: site,
        custom: true,
        referenceSite: ref,
        referenceEphem: state.ephem[ref.id],
        referenceDaily: state.daily[ref.id],
      }),
      referenceId: ref.id,
    };
  }

  function runScenario(options) {
    if (state.running || !state.sites.length) return Promise.resolve();
    var input = readScenarioInputs();
    if (input.error) {
      showError(input.error);
      return Promise.resolve();
    }
    clearError();
    state.running = true;
    setScenarioStatus("loading", "جارٍ حساب السيناريو…");
    var previousSelected = state.selectedMs;
    var site = input.site;
    var horizonPromise = site.custom ? customHorizonFor(site) : Promise.resolve(null);
    return tick()
      .then(function () { return horizonPromise; })
      .then(function (customHorizon) {
        var customAvailable = !!(customHorizon && customHorizon.available);
        state.customHorizon = customAvailable ? customHorizon : null;
        var geo = geometryFor(site);
        var sim = E.buildSimulation({
          site: site,
          startMs: input.startMs,
          durationHours: input.durationHours,
          stepMinutes: input.stepMinutes,
          geometryAt: geo.provider,
          customHorizon: customAvailable ? customHorizon : null,
          custom: input.custom,
          derivedFrom: input.custom ? geo.referenceId : null,
          powerParams: null,
          selectedMs: input.startMs,
          provenance: {
            site: input.custom ? "user coordinates" : site.id,
            ephemeris: input.custom ? "re-projected from " + geo.referenceId : site.id,
            terrain: input.custom
              ? (customAvailable ? "browser DEM " + customHorizon.demId : "unavailable")
              : "precomputed 5 m LOLA horizon",
          },
        });

        state.site = site;
        state.provider = geo.provider;
        state.referenceId = geo.referenceId;
        state.sim = sim;
        state.startMs = sim.startMs;
        state.durationH = sim.durationHours;
        state.stepMinutes = sim.stepMinutes;
        state.tzOffset = input.tzOffset;
        state.selectedMs = previousSelected >= sim.startMs && previousSelected <= sim.endMs
          ? previousSelected
          : sim.startMs;
        state.powerSim = null;
        state.powerParams = null;
        state.delay = null;
        state.compare = null;
        state.link = null;
        state.timelineZoom = 1;
        state.timelineCenter = 0.5;
        state.timelineHover = null;
        sim.selectedMs = state.selectedMs;

        if (site.custom) {
          site.altM = customAvailable ? customHorizon.observerZ : null;
          site.slopeDeg = null;
        }
        updateCustomPolicyNote(customHorizon, site);
        renderAll();
        renderLazyForTab();
        setScenarioStatus("", "جاهز · " + esc(siteLabel(site)) + " · " +
          fmt(input.durationHours, 0) + " ساعة · " + sim.samples.length + " عينة");
      })
      .catch(function (err) {
        showError("تعذّر حساب السيناريو: " + err.message);
      })
      .then(function () {
        state.running = false;
      });
  }

  function updateCustomPolicyNote(horizon, site) {
    var note = $id("customPolicyNote");
    if (!note) return;
    if (!site.custom) {
      note.textContent = "الهندسة السماوية للموقع المخصص تُشتق من سلسلة JPL Horizons لموقع مرجعي عبر تحويل إطار مُتحقَّق منه. " +
        "التضاريس تُحسب فقط إذا وقع الموقع داخل نافذة DEM مشحونة؛ وإلا تُعرض النتائج الهندسية فقط.";
      return;
    }
    if (horizon && horizon.available) {
      note.innerHTML = "الموقع داخل نافذة <span class=\"mono\">" + esc(horizon.demId) +
        "</span>. حُسب أفق 360° في المتصفح من DEM بدقة 20 m/px، بخطوة 10 m حتى 9 km، مع تصحيح انحناء." +
        " هذا الأفق أقل دقة من أفق 5 m المخزّن للنقاط الثلاث.";
    } else {
      note.textContent = "الموقع خارج نافذتي DEM المشحونتين. الرؤية المعروضة هندسية فقط، ونتائج التضاريس «غير متاحة» ولا تُملأ بقيم مفترضة. " +
        "الهندسة السماوية مشتقة من موقع مرجعي حقيقي عبر تحويل إطار مُتحقَّق منه.";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shared rendering                                                    */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    if (!state.sim) return;
    renderOverview();
    renderSimulator();
    renderHorizon();
    renderTimeline();
    renderMethod();
  }

  function renderLazyForTab() {
    if (state.tab === "delay" && !state.delay) runDelay();
    if (state.tab === "compare" && !state.compare) runCompare();
    if (state.tab === "engineering") {
      if (!state.powerSim) runPower();
      if (!state.link) runLink();
    }
  }

  function basisLabel(basis) {
    return basis === "terrain" ? "تضاريس" : "هندسي";
  }

  function renderOverview() {
    var sim = state.sim;
    if (!sim) return;
    var site = sim.site;
    var m = sim.metrics;
    setText("ovSite", siteLabel(site));
    setText("ovCoords", "خط عرض " + numUnit(site.lat, "°", 4, true) + " · طول " + numUnit(site.lon, "°", 3, true) +
      (site.altM != null ? " · ارتفاع " + numUnit(site.altM, "m", 0) : " · ارتفاع غير متاح"));
    setHTML("ovWindow", '<span class="nav-nowrap">' + esc(dateISO(sim.startMs)) + '</span> <span class="nav-nowrap">→ ' + esc(dateISO(sim.endMs)) + "</span>");
    setText("ovDuration", fmt(sim.durationHours, 0) + " ساعة · خطوة " + fmt(sim.stepMinutes, 0) + " دقيقة · UTC");
    setText("ovSunPct", fmtPct(m.sun.visibilityPct));
    setText("ovSunState", fmtH(m.sun.visibilityH) + " · أساس " + basisLabel(m.sun.blackoutBasis));
    setText("ovEarthPct", fmtPct(m.earth.visibilityPct));
    setText("ovEarthState", fmtH(m.earth.visibilityH) + " · أساس " + basisLabel(m.earth.blackoutBasis));
    setText("ovOverlap", fmtPct(m.overlap.pct));
    setText("ovOverlapBasis", fmtH(m.overlap.totalH) + " · أساس " + basisLabel(m.overlap.basis));

    if (sim.next) {
      var type = sim.next.type === "rise" ? "ظهور" : "غياب";
      var body = sim.next.body === "sun" ? "الشمس" : "الأرض";
      setText("ovNext", selectedLabel(sim.next.tMs));
      setText("ovNextBody", type + " " + body + " بالنسبة لأفق التضاريس");
    } else {
      setText("ovNext", "لا حدث داخلي");
      setText("ovNextBody", "لا يوجد عبور داخلي قبل نهاية النافذة؛ أحداث الطرف مستبعدة.");
    }

    var warn = $id("overviewWarnings");
    if (warn) {
      var items = (sim.warnings || []).slice();
      if (!items.length) items.push("لا تحذيرات إضافية من المحرك لهذا السيناريو.");
      items.push("النتائج هندسية/تضاريسية، وليست حكمًا على صلاحية الموقع للهبوط أو على أداء المهمة.");
      warn.innerHTML = items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    }

    drawMiniTimeline($id("overviewTimeline"), sim, { power: powerTrack(sim) });
    renderOverviewLegend(sim);
    renderSelectedReadouts();
  }

  function renderOverviewLegend(sim) {
    var defs = [
      { label: "شمس · " + (sim.tracks.sunTerrain.available ? "تضاريس" : "هندسي"), color: C.sun },
      { label: "أرض · " + (sim.tracks.earthTerrain.available ? "تضاريس" : "هندسي"), color: C.earth },
      { label: "تداخل", color: C.overlap },
    ];
    if (powerTrack(sim)) defs.push({ label: "طاقة > 0", color: C.power });
    setHTML("overviewLegend", defs.map(function (d) {
      return '<span><i class="line" style="background:' + d.color + '"></i> ' + esc(d.label) + "</span>";
    }).join("") + '<span><i class="line selected"></i> الزمن المحدد</span>');
  }

  function clearanceText(body) {
    if (!body || body.clearanceDeg == null) return "الفرق مع الأفق غير متاح";
    var d = body.clearanceDeg;
    return "الحافة العليا " + (d >= 0 ? "أعلى" : "أخفض") + " من أفق التضاريس بمقدار " + numUnit(Math.abs(d), "°", 2, true);
  }

  function renderSelectedReadouts() {
    var sim = state.sim;
    if (!sim) return;
    var sample = E.sampleAt(sim, state.selectedMs);
    if (!sample) return;
    var sun = sample.sun, earth = sample.earth;
    setHTML("ovTime", timeHTML(E.timeLabel(state.selectedMs, state.tzOffset, true)));
    setText("ovSunAz", fmtDeg(sun.az) + " · " + cardinal(sun.az));
    setText("ovSunEl", fmtDeg(sun.el));
    setText("ovEarthAz", fmtDeg(earth.az) + " · " + cardinal(earth.az));
    setText("ovEarthEl", fmtDeg(earth.el));
    setText("ovSunNow", stateLabel(sun.state));
    setClass("ovSunNow", stateClass(sun.state));
    setText("ovEarthNow", stateLabel(earth.state));
    setClass("ovEarthNow", stateClass(earth.state));
    setText("ovSunHorizon", sun.horizonEl == null ? "غير متاح" : fmtDeg(sun.horizonEl));

    var nearest = E.timeLabel(sample.tMs, state.tzOffset, true);
    var parts = [];
    if (sun.terrainAvailable) parts.push("الشمس: " + clearanceText(sun) + ".");
    else parts.push("الشمس: رؤية هندسية فقط — لا يوجد أفق تضاريس لهذا الموقع.");
    if (earth.terrainAvailable) parts.push("الأرض: " + clearanceText(earth) + ".");
    else parts.push("الأرض: رؤية هندسية فقط — لا يوجد أفق تضاريس.");
    parts.push("العينة المحسوبة: " + nearest + ".");
    setText("ovSelectedNote", parts.join(" "));
  }

  /* ------------------------------------------------------------------ */
  /* Simulator panel                                                     */
  /* ------------------------------------------------------------------ */

  function renderSimulator() {
    var sim = state.sim;
    if (!sim) return;
    var site = sim.site;
    var sample = E.sampleAt(sim, state.selectedMs);
    if (!sample) return;
    var sun = sample.sun, earth = sample.earth;

    setText("siteRole", site.role || (site.custom ? "إحداثيات مخصصة" : "نقطة تحليل"));
    setText("siteName", site.nameAr || siteLabel(site));
    setText("siteEn", site.nameEn || site.id);
    var note = site.noteAr || "";
    if (site.custom) {
      note = sim.horizon.available
        ? "أفق التضاريس محسوب من DEM " + (sim.horizon.arrays && sim.horizon.arrays.demId ? sim.horizon.arrays.demId : "") + " بدقة 20 m/px."
        : "لا يوجد DEM عند هذه الإحداثيات؛ الرؤية هندسية فقط ونتائج التضاريس غير متاحة.";
    }
    setText("siteNote", note);

    var slider = $id("simTimeSlider");
    if (slider) {
      slider.max = String(Math.max(1, sim.samples.length - 1));
      slider.value = String(E.nearestSampleIndex(sim, state.selectedMs));
    }
    setText("simTimeOut", selectedLabel(state.selectedMs));

    setText("simSunAz", fmtDeg(sun.az));
    setText("simSunEl", fmtDeg(sun.el));
    setText("simSunHorizon", sun.horizonEl == null ? "غير متاح" : fmtDeg(sun.horizonEl));
    setText("simSunState", stateLabel(sun.state));
    setClass("simSunState", stateClass(sun.state));
    setText("simEarthAz", fmtDeg(earth.az));
    setText("simEarthEl", fmtDeg(earth.el));
    setText("simEarthHorizon", earth.horizonEl == null ? "غير متاح" : fmtDeg(earth.horizonEl));
    setText("simEarthState", stateLabel(earth.state));
    setClass("simEarthState", stateClass(earth.state));

    setText("simNote", "أساس الرؤية: " + (sim.metrics.terrainAvailable ? "أفق تضاريس " + (sim.horizon.resolutionM ? numUnit(sim.horizon.resolutionM, "m", 0) : "") : "هندسي فقط") +
      " · " + (site.custom ? "هندسة مشتقة من " + ltrValue(state.referenceId || "—") : ltrValue("JPL topocentric")) +
      " · العينة " + ltrValue(E.isoMinuteUtc(sample.tMs)));

    renderEvents(sim);
    drawMap();
    drawDirection();
    drawSky();
  }

  function allTransitions(sim) {
    var events = [];
    ["sun", "earth"].forEach(function (body) {
      var track = body === "sun"
        ? (sim.tracks.sunTerrain.available ? sim.tracks.sunTerrain : sim.tracks.sunGeom)
        : (sim.tracks.earthTerrain.available ? sim.tracks.earthTerrain : sim.tracks.earthGeom);
      if (!track || !track.intervals) return;
      track.intervals.forEach(function (r) {
        if (!r.edgeStart) events.push({ tMs: r.startMs, type: "rise", body: body });
        if (!r.edgeEnd) events.push({ tMs: r.endMs, type: "set", body: body });
      });
    });
    return events.sort(function (a, b) { return a.tMs - b.tMs; });
  }

  function renderEvents(sim) {
    var box = $id("simEvents");
    if (!box) return;
    var events = allTransitions(sim).slice(0, 8);
    if (!events.length) {
      box.innerHTML = '<li><span class="empty">لا توجد أحداث عبور داخلية. قد تكون النافذة قصيرة أو كاملة الرؤية أو محجوبة طوالها؛ أحداث الطرف مستبعدة.</span></li>';
      return;
    }
    box.innerHTML = events.map(function (e) {
      var body = e.body === "sun" ? "الشمس" : "الأرض";
      var type = e.type === "rise" ? "ظهور" : "غياب";
      return "<li><b>" + type + " " + body + "</b><span>" + esc(selectedLabel(e.tMs)) + "</span></li>";
    }).join("");
  }

  function drawMap() {
    var overlay = $id("mapOverlay");
    var sim = state.sim;
    if (!overlay || !sim || !state.sitesDoc || !state.sitesDoc.mosaic) return;
    var m = state.sitesDoc.mosaic;
    var sample = E.sampleAt(sim, state.selectedMs);
    var svg = [];
    svg.push('<svg viewBox="0 0 ' + m.width + " " + m.height + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">');
    svg.push("<defs>");
    svg.push('<filter id="navGlow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
    svg.push("</defs>");
    function mapPoint(x, y) {
      return {
        x: (x - m.xmin) / m.pixelM,
        y: (m.ymax - y) / m.pixelM,
      };
    }
    state.sites.forEach(function (site) {
      var p = mapPoint(site.x, site.y);
      var current = site.id === sim.site.id;
      svg.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (current ? 8 : 5) + '" fill="' + (current ? site.color : "rgba(232,242,251,.45)") + '" stroke="#05090f" stroke-width="2"/>');
      if (current) {
        svg.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="15" fill="none" stroke="' + site.color + '" stroke-width="1.4" opacity=".85"/>');
        svg.push('<text x="' + (p.x + 18).toFixed(1) + '" y="' + (p.y - 12).toFixed(1) + '" fill="#e8f2fb" font-size="18" font-family="IBM Plex Sans Arabic, sans-serif">' + esc(siteLabel(site)) + "</text>");
      }
    });
    var site = sim.site;
    var xy = E.latLonToXY(site.lat, site.lon);
    var p = mapPoint(xy.x, xy.y);
    if (site.custom) {
      svg.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="12" fill="none" stroke="' + C.amber + '" stroke-width="2" stroke-dasharray="4 3"/>');
      svg.push('<text x="' + (p.x + 18).toFixed(1) + '" y="' + (p.y + 24).toFixed(1) + '" fill="' + C.amber + '" font-size="18" font-family="IBM Plex Sans Arabic, sans-serif">' + esc(siteLabel(site)) + "</text>");
    }
    if (sample) {
      var base = mapPoint(xy.x, xy.y);
      [["sun", sample.sun, C.sun], ["earth", sample.earth, C.earth]].forEach(function (item) {
        var az = item[1].az * Math.PI / 180;
        var len = 230;
        var ex = base.x + Math.sin(az) * len;
        var ey = base.y - Math.cos(az) * len;
        svg.push('<line x1="' + base.x.toFixed(1) + '" y1="' + base.y.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '" stroke="' + item[2] + '" stroke-width="3" opacity=".9"/>');
        svg.push('<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="6" fill="' + item[2] + '"/>');
        svg.push('<text x="' + (ex + 9).toFixed(1) + '" y="' + (ey - 7).toFixed(1) + '" fill="' + item[2] + '" font-size="16" font-family="IBM Plex Sans Arabic, sans-serif">' + (item[0] === "sun" ? "الشمس" : "الأرض") + "</text>");
      });
    }
    svg.push("</svg>");
    overlay.innerHTML = svg.join("");
  }

  /* ------------------------------------------------------------------ */
  /* Horizon panel                                                       */
  /* ------------------------------------------------------------------ */

  function horizonSourceText(h) {
    var src = h.source || "";
    if (/^precomputed/.test(src)) src = "أفق محسوب مسبقًا من DEM LOLA";
    else if (/browser-computed/.test(src)) src = "DEM " + ltrValue(h.demId || "—") + " · محسوب في المتصفح";
    else if (src === "computed") src = "محسوب في المتصفح";
    else if (src === "unavailable") src = "غير متاح";
    else src = ltrValue(src);
    return "المصدر: " + src +
      (h.resolutionM ? " · دقة " + numUnit(h.resolutionM, "m", 0) : "") +
      (h.partial ? " · تغطية جزئية" : "");
  }

  function renderHorizon() {
    var sim = state.sim;
    if (!sim) return;
    var sample = E.sampleAt(sim, state.selectedMs);
    if (!sample) return;
    var h = sim.horizon;
    setText("horizonSource", h.available ? horizonSourceText(h) : "لا يوجد DEM موثّق لهذا الموقع: الأفق التضاريسي غير متاح، والرؤية المعروضة هندسية فقط.");

    var rows = [];
    [["الشمس", sample.sun, C.sun], ["الأرض", sample.earth, C.earth]].forEach(function (item) {
      var b = item[1];
      rows.push([
        item[0],
        fmtDeg(b.az),
        fmtDeg(b.el),
        b.horizonEl == null ? "غير متاح" : fmtDeg(b.horizonEl),
        b.clearanceDeg == null ? "—" : signedUnit(b.clearanceDeg, "°", 2, true),
        '<span class="state-' + (b.state || "unavailable") + '">' + stateLabel(b.state) + "</span>",
      ]);
    });
    fillRows("horizonBodyTable", rows);

    var azInput = $id("horizonAz");
    var az = azInput ? Number(azInput.value) : 0;
    setText("horizonAzOut", fmt(azNorm(az), 0) + "°");
    var hel = h.available ? h.at(az) : null;
    setText("hAz", numUnit(azNorm(az), "°", 0, true) + " · " + cardinal(az));
    setText("hEl", hel == null ? "غير متاح" : fmtDeg(hel));
    if (h.available && h.arrays) {
      var idx = Math.round(azNorm(az)) % 360;
      var dist = h.arrays.horizonDistM ? h.arrays.horizonDistM[idx] : null;
      var z = h.arrays.horizonZ ? h.arrays.horizonZ[idx] : null;
      setText("hDist", h.available
        ? ltrValue((dist != null && isFinite(dist) ? fmt(dist, 0) + " m" : "—") + " / " +
          (z != null && isFinite(z) ? fmt(z, 0) + " m" : "—"))
        : "—");
    } else {
      setText("hDist", "—");
    }

    drawHorizonPolar();
    drawHorizonProfile();
  }

  /* ------------------------------------------------------------------ */
  /* Canvas helpers                                                      */
  /* ------------------------------------------------------------------ */

  function fit(canvas) {
    if (!canvas || canvas.offsetParent === null) return null;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(220, Math.floor(canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 640));
    var h = Math.max(140, Math.floor(canvas.clientHeight || w * 0.45));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function dot(ctx, x, y, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
  }

  function drawDirection() {
    var f = fit($id("directionCanvas"));
    if (!f) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var sim = state.sim;
    var sample = sim ? E.sampleAt(sim, state.selectedMs) : null;
    if (!sample) return;
    var sun = sample.sun, earth = sample.earth;
    var horizon = sim.horizon && sim.horizon.available ? sim.horizon : null;
    var values = [sun.el, earth.el, 0];
    if (horizon && horizon.arrays && horizon.arrays.horizonEl) values = values.concat(horizon.arrays.horizonEl);
    var max = Math.max.apply(null, values) + 0.8;
    var min = Math.min.apply(null, values) - 0.8;
    if (max - min < 3) { max += 1.5; min -= 1.5; }
    var cx = w / 2, cy = h / 2 + 4;
    var R = Math.min(w, h) / 2 - 34;
    function rOf(el) { return R * (max - el) / (max - min); }
    function pt(az, el) {
      var a = azNorm(az) * Math.PI / 180;
      var r = clamp(rOf(el), 0, R);
      return { x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r };
    }
    ctx.save();
    ctx.direction = "rtl";
    // rings
    [max, 0, min].forEach(function (el) {
      if (el > max || el < min) return;
      var r = rOf(el);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.setLineDash(el === 0 ? [] : [2, 4]);
      ctx.strokeStyle = el === 0 ? "rgba(90,216,230,.34)" : "rgba(100,124,147,.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.dim;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(fmt(el, 1) + "°", cx + r + 4, cy + 3);
    });
    // cardinal cross
    [0, 90, 180, 270].forEach(function (az) {
      var p = pt(az, max);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = "rgba(90,216,230,.09)";
      ctx.stroke();
      var q = pt(az, max);
      var lx = cx + Math.sin(az * Math.PI / 180) * (R + 17);
      var ly = cy - Math.cos(az * Math.PI / 180) * (R + 17);
      ctx.fillStyle = C.muted;
      ctx.font = "10px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(["ش", "ق", "ج", "غ"][Math.round(az / 90) % 4], lx, ly + 3);
    });
    // terrain polygon
    if (horizon && horizon.arrays && horizon.arrays.horizonEl) {
      ctx.beginPath();
      var arr = horizon.arrays.horizonEl;
      for (var a = 0; a <= 360; a++) {
        var el = arr[a % 360];
        var p = pt(a, el);
        if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(127,199,217,.10)";
      ctx.fill();
      ctx.strokeStyle = C.horizon;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    // bodies
    var sunPt = pt(sun.az, sun.el);
    var earthPt = pt(earth.az, earth.el);
    var closeBodies = Math.hypot(sunPt.x - earthPt.x, sunPt.y - earthPt.y) < 100;
    [["الشمس", sun, C.sun, sunPt], ["الأرض", earth, C.earth, earthPt]].forEach(function (item, idx) {
      var b = item[1];
      var p = item[3];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = item[2] + "55";
      ctx.stroke();
      dot(ctx, p.x, p.y, 6, b.state === "visible" || b.state === "geometric" ? item[2] : "transparent", item[2]);
      ctx.fillStyle = item[2];
      ctx.font = "10px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "right";
      var lx = p.x - 12;
      var ly = p.y - 8;
      if (lx < 40) { lx = p.x + 12; ctx.textAlign = "left"; }
      if (closeBodies) {
        var otherY = idx === 0 ? earthPt.y : sunPt.y;
        var away = Math.abs(p.y - otherY) < 1 ? (idx === 0 ? 1 : -1) : (p.y > otherY ? 1 : -1);
        ly = clamp(p.y + away * 16, 14, h - 22);
      }
      ctx.fillText(item[0], lx, ly);
      ctx.fillStyle = C.dim;
      ctx.font = "8px IBM Plex Sans Arabic, sans-serif";
      ctx.fillText(fmtDeg(b.az), lx, ly + 11);
    });
    dot(ctx, cx, cy, 3, C.text);
    ctx.fillStyle = C.dim;
    ctx.font = "8px IBM Plex Sans Arabic, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("المراقب", cx, cy + 16);
    ctx.fillStyle = "rgba(145,169,194,.75)";
    ctx.font = "8.5px IBM Plex Sans Arabic, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("المسافة الشعاعية = الارتفاع", 8, 14);
    ctx.restore();
  }

  function drawSky() {
    var f = fit($id("skyCanvas"));
    if (!f) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var sim = state.sim;
    if (!sim) return;
    var spanH = Math.min(24, sim.durationHours);
    var w0 = sim.startMs;
    if (sim.durationHours > spanH) {
      w0 = clamp(state.selectedMs - 12 * 3600000, sim.startMs, sim.endMs - spanH * 3600000);
    }
    var w1 = w0 + spanH * 3600000;
    var samples = sim.samples.filter(function (s) { return s.tMs >= w0 - 1 && s.tMs <= w1 + 1; });
    if (samples.length < 2) samples = sim.samples.slice(0, Math.min(48, sim.samples.length));
    var horizon = sim.horizon && sim.horizon.available ? sim.horizon : null;
    var vals = [0];
    samples.forEach(function (s) { vals.push(s.sun.el, s.earth.el); });
    if (horizon && horizon.arrays && horizon.arrays.horizonEl) vals = vals.concat(horizon.arrays.horizonEl);
    var min = Math.min.apply(null, vals) - 0.7;
    var max = Math.max.apply(null, vals) + 0.7;
    if (max - min < 2) { max += 0.6; min -= 0.6; }
    var pad = { l: 36, r: 12, t: 16, b: 24 };
    var x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b;
    function xOf(az) { return x0 + azNorm(az) / 360 * (x1 - x0); }
    function yOf(el) { return y1 - (el - min) / (max - min) * (y1 - y0); }
    ctx.save();
    ctx.direction = "ltr";
    // grid
    for (var az = 0; az <= 360; az += 45) {
      var x = xOf(az);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      ctx.strokeStyle = "rgba(90,216,230,.10)"; ctx.lineWidth = 1; ctx.stroke();
      if (az % 90 === 0) {
        ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(["ش", "ق", "ج", "غ", "ش"][az / 90], x, y1 + 14);
      }
    }
    var ticks = 4;
    for (var k = 0; k <= ticks; k++) {
      var el = min + (max - min) * k / ticks;
      var y = yOf(el);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.strokeStyle = "rgba(100,124,147,.14)"; ctx.stroke();
      ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(fmt(el, 1) + "°", x0 - 5, y + 3);
    }
    // zero line
    if (min <= 0 && max >= 0) {
      ctx.beginPath(); ctx.moveTo(x0, yOf(0)); ctx.lineTo(x1, yOf(0));
      ctx.strokeStyle = "rgba(145,169,194,.55)"; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    // horizon
    if (horizon) {
      ctx.beginPath();
      for (var a = 0; a <= 360; a++) {
        var p = { x: xOf(a), y: yOf(horizon.at(a)) };
        if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = C.horizon; ctx.lineWidth = 1.4; ctx.stroke();
    }
    // paths, split on azimuth wrap
    function path(key, color) {
      ctx.beginPath();
      var started = false;
      var prev = null;
      samples.forEach(function (s) {
        var az = azNorm(s[key].az);
        var p = { x: xOf(az), y: yOf(s[key].el) };
        if (prev != null && Math.abs(az - prev) > 180) started = false;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
        prev = az;
      });
      ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
    }
    path("sun", C.sun);
    path("earth", C.earth);
    // selected sample
    var sel = E.sampleAt(sim, state.selectedMs);
    if (sel) {
      [[sel.sun, C.sun], [sel.earth, C.earth]].forEach(function (it) {
        var p = { x: xOf(it[0].az), y: yOf(it[0].el) };
        dot(ctx, p.x, p.y, 4, it[1]);
      });
    }
    ctx.fillStyle = "rgba(145,169,194,.7)";
    ctx.font = "8px IBM Plex Sans Arabic, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("24 ساعة · " + axisTime(w0, 86400000) + " → " + axisTime(w1, 86400000) + " " + tzText(), x0, y0 - 4);
    ctx.restore();
  }

  function drawHorizonPolar() {
    var f = fit($id("horizonPolar"));
    if (!f) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var sim = state.sim;
    if (!sim) return;
    var sample = E.sampleAt(sim, state.selectedMs);
    if (!sample) return;
    var horizon = sim.horizon && sim.horizon.available ? sim.horizon : null;
    var vals = [sample.sun.el, sample.earth.el, 0];
    if (horizon && horizon.arrays && horizon.arrays.horizonEl) vals = vals.concat(horizon.arrays.horizonEl);
    var min = Math.floor(Math.min.apply(null, vals) - 1);
    var max = Math.ceil(Math.max.apply(null, vals) + 1);
    if (max - min < 4) max = min + 4;
    var cx = w / 2, cy = h / 2 + 2;
    var R = Math.min(w, h) / 2 - 32;
    function rOf(el) { return R * (max - el) / (max - min); }
    function pt(az, el) {
      var a = azNorm(az) * Math.PI / 180;
      var r = clamp(rOf(el), 0, R);
      return { x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r };
    }
    ctx.save();
    ctx.direction = "rtl";
    [min, 0, max].forEach(function (el) {
      if (el < min || el > max) return;
      var r = rOf(el);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.setLineDash(el === 0 ? [] : [3, 4]);
      ctx.strokeStyle = el === 0 ? "rgba(90,216,230,.4)" : "rgba(100,124,147,.24)";
      ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.dim; ctx.font = "8.5px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(fmt(el, 0) + "°", cx, cy - r + 12);
    });
    [0, 90, 180, 270].forEach(function (az) {
      var p = pt(az, max);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = "rgba(90,216,230,.11)"; ctx.stroke();
      var lx = cx + Math.sin(az * Math.PI / 180) * (R + 16);
      var ly = cy - Math.cos(az * Math.PI / 180) * (R + 16);
      ctx.fillStyle = C.muted; ctx.font = "10px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(["ش", "ق", "ج", "غ"][az / 90], lx, ly + 3);
    });
    if (horizon) {
      ctx.beginPath();
      var arr = horizon.arrays.horizonEl;
      for (var a = 0; a <= 360; a++) {
        var p = pt(a, arr[a % 360]);
        if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(127,199,217,.12)";
      ctx.fill();
      ctx.strokeStyle = C.horizon; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // selected azimuth
    var azInput = $id("horizonAz");
    var selAz = azInput ? Number(azInput.value) : 0;
    var sp = pt(selAz, min);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sp.x, sp.y);
    ctx.strokeStyle = C.amber; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    [["الشمس", sample.sun, C.sun], ["الأرض", sample.earth, C.earth]].forEach(function (item) {
      var b = item[1];
      var p = pt(b.az, b.el);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = item[2] + "66"; ctx.stroke();
      dot(ctx, p.x, p.y, 5.5, item[2]);
      ctx.fillStyle = item[2]; ctx.font = "9px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "right";
      var lx = p.x - 10, ly = p.y - 7;
      if (lx < 40) { lx = p.x + 10; ctx.textAlign = "left"; }
      ctx.fillText(item[0], lx, ly);
    });
    dot(ctx, cx, cy, 2.5, C.text);
    ctx.restore();
  }

  function drawHorizonProfile() {
    var f = fit($id("horizonProfile"));
    if (!f) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var sim = state.sim;
    if (!sim) return;
    var sample = E.sampleAt(sim, state.selectedMs);
    if (!sample) return;
    var horizon = sim.horizon && sim.horizon.available ? sim.horizon : null;
    var vals = [0, sample.sun.el, sample.earth.el];
    if (horizon && horizon.arrays) vals = vals.concat(horizon.arrays.horizonEl);
    var min = Math.min.apply(null, vals) - 1;
    var max = Math.max.apply(null, vals) + 1;
    if (max - min < 3) { max += 0.8; min -= 0.8; }
    var pad = { l: 36, r: 10, t: 14, b: 22 };
    var x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b;
    function xOf(az) { return x0 + azNorm(az) / 360 * (x1 - x0); }
    function yOf(el) { return y1 - (el - min) / (max - min) * (y1 - y0); }
    ctx.save();
    ctx.direction = "ltr";
    for (var az = 0; az <= 360; az += 90) {
      var x = xOf(az);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      ctx.strokeStyle = "rgba(90,216,230,.10)"; ctx.stroke();
      ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(["ش", "ق", "ج", "غ", "ش"][az / 90], x, y1 + 14);
    }
    for (var k = 0; k <= 4; k++) {
      var el = min + (max - min) * k / 4;
      var y = yOf(el);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.strokeStyle = "rgba(100,124,147,.13)"; ctx.stroke();
      ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(fmt(el, 1) + "°", x0 - 5, y + 3);
    }
    if (min <= 0 && max >= 0) {
      ctx.beginPath(); ctx.moveTo(x0, yOf(0)); ctx.lineTo(x1, yOf(0));
      ctx.strokeStyle = "rgba(145,169,194,.55)"; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (horizon) {
      ctx.beginPath();
      var arr = horizon.arrays.horizonEl;
      for (var a = 0; a <= 360; a++) {
        var p = { x: xOf(a), y: yOf(arr[a % 360]) };
        if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = C.horizon; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // selected azimuth
    var azInput = $id("horizonAz");
    var selAz = azInput ? Number(azInput.value) : 0;
    var sx = xOf(selAz);
    ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1);
    ctx.strokeStyle = C.amber; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    [["الشمس", sample.sun, C.sun], ["الأرض", sample.earth, C.earth]].forEach(function (item) {
      var p = { x: xOf(item[1].az), y: yOf(item[1].el) };
      dot(ctx, p.x, p.y, 4, item[2]);
    });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Timeline and interval helpers                                       */
  /* ------------------------------------------------------------------ */

  function intervalStats(intervals, startMs, endMs) {
    if (intervals == null) return null;
    var total = 0;
    intervals.forEach(function (r) { total += r.durationH; });
    var gaps = E.complementIntervals(intervals, startMs, endMs);
    var interior = gaps.filter(function (g) { return !g.edgeStart && !g.edgeEnd; });
    var edge = gaps.filter(function (g) { return g.edgeStart || g.edgeEnd; });
    var longest = interior.length ? interior.reduce(function (a, b) { return b.durationH > a.durationH ? b : a; }) : null;
    var longestEdge = edge.length ? edge.reduce(function (a, b) { return b.durationH > a.durationH ? b : a; }) : null;
    var spanH = (endMs - startMs) / 3600000;
    return {
      totalH: total,
      pct: spanH > 0 ? total / spanH * 100 : 0,
      longestH: longest ? longest.durationH : null,
      edgeLimited: !longest && edge.length > 0,
      edgeH: longestEdge ? longestEdge.durationH : null,
      count: intervals.length,
      gaps: gaps,
    };
  }

  function powerTrack(sim) {
    if (!state.powerSim) return null;
    var p = state.powerSim;
    if (!sim || p.site.id !== sim.site.id || p.startMs !== sim.startMs ||
        p.durationHours !== sim.durationHours || p.stepMinutes !== sim.stepMinutes) return null;
    return p.tracks.power;
  }

  function trackDefs(sim) {
    var terrain = sim.metrics.terrainAvailable;
    var defs = [
      { key: "sunTerrain", label: "شمس · تضاريس", color: C.sun, intervals: terrain ? sim.tracks.sunTerrain.intervals : null },
      { key: "sunGeom", label: "شمس · هندسي", color: "rgba(255,207,107,.40)", intervals: sim.tracks.sunGeom.intervals },
      { key: "earthTerrain", label: "أرض · تضاريس", color: C.earth, intervals: terrain ? sim.tracks.earthTerrain.intervals : null },
      { key: "earthGeom", label: "أرض · هندسي", color: "rgba(90,216,230,.40)", intervals: sim.tracks.earthGeom.intervals },
      { key: "overlap", label: "تداخل", color: C.overlap, intervals: sim.tracks.overlap.intervals },
    ];
    var p = powerTrack(sim);
    if (p) defs.push({ key: "power", label: "طاقة > 0", color: C.power, intervals: p.intervals });
    return defs;
  }

  function renderTimeline() {
    var sim = state.sim;
    if (!sim) return;
    var sample = E.sampleAt(sim, state.selectedMs);
    if (!sample) return;
    var sun = sample.sun, earth = sample.earth;

    setText("timelineRange", ltrValue(selectedLabel(sim.startMs) + " → " + selectedLabel(sim.endMs)));
    setText("timelineSelected", "المحدد: " + selectedLabel(state.selectedMs));

    var items = [
      { label: "الزمن المحدد", value: timeHTML(E.timeLabel(state.selectedMs, state.tzOffset, true)) },
      { label: "سمت الشمس", value: fmtDeg(sun.az) + " · " + cardinal(sun.az) },
      { label: "ارتفاع الشمس", value: fmtDeg(sun.el) },
      { label: "حالة الشمس", value: stateLabel(sun.state), cls: stateClass(sun.state) },
      { label: "سمت الأرض", value: fmtDeg(earth.az) + " · " + cardinal(earth.az) },
      { label: "ارتفاع الأرض", value: fmtDeg(earth.el) },
      { label: "حالة الأرض", value: stateLabel(earth.state), cls: stateClass(earth.state) },
      { label: "أفق الشمس / الأرض", value: (sun.horizonEl == null ? "—" : fmtDeg(sun.horizonEl)) + " / " + (earth.horizonEl == null ? "—" : fmtDeg(earth.horizonEl)) },
    ];
    var p = state.powerSim;
    if (p) {
      var psample = E.sampleAt(p, state.selectedMs);
      items.push({ label: "القدرة عند العينة", value: psample && psample.power && psample.power.available ? numUnit(psample.power.powerW, "W", 1) : "—" });
      items.push({ label: "أساس الإضاءة", value: basisLabel(p.metrics.terrainBasis) });
    }
    fillReadouts("timelineDetails", items);

    setText("timelineIntervalNote", windowSentence(sim, state.selectedMs));

    var rows = [];
    function addRow(label, stats, kind) {
      if (!stats) {
        rows.push([label, "غير متاح", "—", "—", "—"]);
        return;
      }
      var longest = stats.longestH != null ? fmtH(stats.longestH)
        : stats.edgeLimited ? "≥ " + fmtH(stats.edgeH) + " (طرف)" : "0";
      rows.push([label, fmtH(stats.totalH), fmtPct(stats.pct), longest, String(stats.count)]);
    }
    addRow("شمس — تضاريس", intervalStats(sim.tracks.sunTerrain.available ? sim.tracks.sunTerrain.intervals : null, sim.startMs, sim.endMs));
    addRow("شمس — هندسي", intervalStats(sim.tracks.sunGeom.intervals, sim.startMs, sim.endMs));
    addRow("أرض — تضاريس", intervalStats(sim.tracks.earthTerrain.available ? sim.tracks.earthTerrain.intervals : null, sim.startMs, sim.endMs));
    addRow("أرض — هندسي", intervalStats(sim.tracks.earthGeom.intervals, sim.startMs, sim.endMs));
    addRow("تداخل الشمس والأرض", intervalStats(sim.tracks.overlap.intervals, sim.startMs, sim.endMs));
    if (powerTrack(sim)) addRow("طاقة > 0", intervalStats(powerTrack(sim).intervals, sim.startMs, sim.endMs));
    fillRows("timelineSummary", rows);

    renderWindowTable(sim);
    renderTimelineLegend(sim);
    drawTimeline();
  }

  function windowSentence(sim, tMs) {
    function part(name, intervals, basis) {
      if (!intervals) return name + ": نتائج التضاريس غير متاحة.";
      var inside = null;
      intervals.forEach(function (r) { if (tMs >= r.startMs && tMs <= r.endMs) inside = r; });
      if (inside) {
        return name + ": داخل نافذة مرئية (" + basis + ") من " + selectedLabel(inside.startMs) +
          " إلى " + selectedLabel(inside.endMs) + ".";
      }
      var prev = null, next = null;
      intervals.forEach(function (r) {
        if (r.endMs < tMs && (!prev || r.endMs > prev.endMs)) prev = r;
        if (r.startMs > tMs && (!next || r.startMs < next.startMs)) next = r;
      });
      return name + ": خارج نافذة الرؤية الآن (" + basis + ")" +
        (prev ? " · آخر نافذة انتهت " + selectedLabel(prev.endMs) : "") +
        (next ? " · النافذة التالية تبدأ " + selectedLabel(next.startMs) : "") + ".";
    }
    var sunTrack = sim.tracks.sunTerrain.available ? sim.tracks.sunTerrain.intervals : sim.tracks.sunGeom.intervals;
    var earthTrack = sim.tracks.earthTerrain.available ? sim.tracks.earthTerrain.intervals : sim.tracks.earthGeom.intervals;
    return [part("الشمس", sunTrack, sim.metrics.terrainAvailable ? "تضاريس" : "هندسي"),
      part("الأرض", earthTrack, sim.metrics.terrainAvailable ? "تضاريس" : "هندسي")].join(" ");
  }

  function renderWindowTable(sim) {
    var body = $id("timelineTable");
    if (!body) return;
    var defs = trackDefs(sim);
    var rows = [];
    defs.forEach(function (d) {
      if (!d.intervals) return;
      d.intervals.forEach(function (r) {
        var edge = r.edgeStart && r.edgeEnd ? "طرفان" : r.edgeStart ? "بداية" : r.edgeEnd ? "نهاية" : "داخلي";
        rows.push({ t: r.startMs, cells: [d.label, esc(selectedLabel(r.startMs)), esc(selectedLabel(r.endMs)), fmtH(r.durationH, 2), edge] });
      });
    });
    rows.sort(function (a, b) { return a.t - b.t; });
    var total = rows.length;
    var shown = rows.slice(0, 400);
    var html = shown.map(function (r) { return "<tr>" + r.cells.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("");
    if (!shown.length) html = '<tr><td colspan="5" class="nav-empty">لا توجد نوافذ لعرضها.</td></tr>';
    if (total > shown.length) html += '<tr><td colspan="5" class="nav-empty">عرض أول 400 نافذة من ' + total + ". استخدم تنزيل CSV للحصول على القائمة الكاملة.</td></tr>";
    body.innerHTML = html;
  }

  function renderTimelineLegend(sim) {
    var box = $id("timelineLegend");
    if (!box) return;
    var defs = trackDefs(sim);
    box.innerHTML = defs.map(function (d) {
      return '<span><i class="line" style="background:' + d.color + '"></i> ' + esc(d.label) + (d.intervals == null ? " (غير متاح)" : "") + "</span>";
    }).join("") + '<span><i class="line selected"></i> الزمن المحدد</span>';
  }

  function timelineView(sim, w, h) {
    var pad = { l: 10, r: 108, t: 22, b: 28 };
    var x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b;
    var zoom = clamp(state.timelineZoom, 1, 16);
    var span = 1 / zoom;
    var viewStart = clamp(state.timelineCenter - span / 2, 0, 1 - span);
    var total = sim.endMs - sim.startMs;
    return {
      pad: pad, x0: x0, x1: x1, y0: y0, y1: y1, zoom: zoom, span: span, viewStart: viewStart,
      xOf: function (t) { return x0 + (((t - sim.startMs) / total) - viewStart) / span * (x1 - x0); },
      tOf: function (x) { return sim.startMs + ((((x - x0) / (x1 - x0)) * span) + viewStart) * total; },
    };
  }

  function drawTimeline() {
    var f = fit($id("timelineCanvas"));
    if (!f) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var sim = state.sim;
    if (!sim) return;
    var defs = trackDefs(sim);
    var v = timelineView(sim, w, h);
    state.timelineLayout = v;
    var laneH = (v.y1 - v.y0) / Math.max(1, defs.length);
    ctx.save();
    ctx.direction = "ltr";
    // background + grid
    ctx.fillStyle = "rgba(5,11,18,.35)";
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    var spanMs = (sim.endMs - sim.startMs) * v.span;
    var ticks = w < 480 ? 4 : 6;
    var compactTicks = w < 560 && spanMs > 3 * 86400000;
    for (var i = 0; i <= ticks; i++) {
      var frac = i / ticks;
      var x = v.x0 + frac * (v.x1 - v.x0);
      var t = sim.startMs + (v.viewStart + frac * v.span) * (sim.endMs - sim.startMs);
      ctx.beginPath(); ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1);
      ctx.strokeStyle = "rgba(90,216,230,.09)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = C.dim;
      ctx.font = "8px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "center";
      var tickLabel = axisTime(t, spanMs, compactTicks);
      var tickW = ctx.measureText(tickLabel).width;
      ctx.fillText(tickLabel, clamp(x, v.x0 + tickW / 2, v.x1 - tickW / 2), v.y1 + 14);
    }
    // lanes
    defs.forEach(function (d, idx) {
      var y = v.y0 + idx * laneH;
      if (idx > 0) {
        ctx.beginPath(); ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y);
        ctx.strokeStyle = "rgba(100,124,147,.12)"; ctx.stroke();
      }
      // label column at right
      ctx.fillStyle = d.intervals == null ? "rgba(100,124,147,.65)" : C.muted;
      ctx.font = "9px IBM Plex Sans Arabic, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(d.label, w - 6, y + laneH / 2 + 3);
      if (d.intervals == null) {
        ctx.fillStyle = "rgba(100,124,147,.55)";
        ctx.font = "8px IBM Plex Sans Arabic, sans-serif";
        ctx.fillText("غير متاح", w - 6, y + laneH / 2 + 14);
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(v.x0, y + 2, v.x1 - v.x0, Math.max(6, laneH - 4));
      ctx.clip();
      d.intervals.forEach(function (r) {
        var xa = v.xOf(r.startMs), xb = v.xOf(r.endMs);
        if (xb < v.x0 - 2 || xa > v.x1 + 2) return;
        xa = clamp(xa, v.x0, v.x1);
        xb = clamp(xb, v.x0, v.x1);
        ctx.fillStyle = d.color;
        ctx.fillRect(xa, y + Math.max(2, laneH * 0.22), Math.max(1, xb - xa), Math.max(5, laneH * 0.56));
      });
      ctx.restore();
    });
    // selection
    if (state.selectedMs >= sim.startMs && state.selectedMs <= sim.endMs) {
      var sx = v.xOf(state.selectedMs);
      if (sx >= v.x0 && sx <= v.x1) {
        ctx.beginPath(); ctx.moveTo(sx, v.y0 - 4); ctx.lineTo(sx, v.y1);
        ctx.strokeStyle = C.amber; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 4, v.y0 - 7); ctx.lineTo(sx + 4, v.y0 - 7); ctx.lineTo(sx, v.y0);
        ctx.closePath(); ctx.fillStyle = C.amber; ctx.fill();
      }
    }
    // hover
    if (state.timelineHover != null) {
      var hx = v.xOf(state.timelineHover);
      if (hx >= v.x0 && hx <= v.x1) {
        ctx.beginPath(); ctx.moveTo(hx, v.y0); ctx.lineTo(hx, v.y1);
        ctx.strokeStyle = "rgba(232,242,251,.35)"; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        var label = E.timeLabel(state.timelineHover, state.tzOffset, true);
        ctx.font = "8.5px IBM Plex Sans Arabic, sans-serif";
        var tw = ctx.measureText(label).width + 10;
        var lx = clamp(hx - tw / 2, v.x0, v.x1 - tw);
        ctx.fillStyle = "rgba(5,11,18,.92)";
        ctx.fillRect(lx, v.y0 - 20, tw, 14);
        ctx.strokeStyle = "rgba(90,216,230,.25)"; ctx.strokeRect(lx, v.y0 - 20, tw, 14);
        ctx.fillStyle = C.text; ctx.textAlign = "center";
        ctx.fillText(label, lx + tw / 2, v.y0 - 9);
      }
    }
    // zoom hint
    if (v.zoom > 1) {
      ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("تكبير ×" + fmt(v.zoom, 1), v.x0 + 2, v.y0 - 7);
    }
    ctx.restore();
  }

  function drawMiniTimeline(canvas, sim, options) {
    var f = fit(canvas);
    if (!f || !sim) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var opts = options || {};
    var defs = [
      { label: "شمس", color: C.sun, intervals: sim.tracks.sunTerrain.available ? sim.tracks.sunTerrain.intervals : sim.tracks.sunGeom.intervals },
      { label: "أرض", color: C.earth, intervals: sim.tracks.earthTerrain.available ? sim.tracks.earthTerrain.intervals : sim.tracks.earthGeom.intervals },
      { label: "تداخل", color: C.overlap, intervals: sim.tracks.overlap.intervals },
    ];
    if (opts.power) defs.push({ label: "طاقة", color: C.power, intervals: opts.power.intervals });
    var pad = { l: 8, r: 74, t: 8, b: 17 };
    var x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b;
    var laneH = (y1 - y0) / defs.length;
    ctx.save();
    ctx.direction = "ltr";
    ctx.fillStyle = "rgba(5,11,18,.35)"; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    defs.forEach(function (d, idx) {
      var y = y0 + idx * laneH;
      ctx.fillStyle = d.intervals == null ? "rgba(100,124,147,.55)" : C.muted;
      ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(d.label, w - 5, y + laneH / 2 + 3);
      if (!d.intervals) return;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y, x1 - x0, laneH); ctx.clip();
      d.intervals.forEach(function (r) {
        var xa = x0 + (r.startMs - sim.startMs) / (sim.endMs - sim.startMs) * (x1 - x0);
        var xb = x0 + (r.endMs - sim.startMs) / (sim.endMs - sim.startMs) * (x1 - x0);
        ctx.fillStyle = d.color;
        ctx.fillRect(clamp(xa, x0, x1), y + Math.max(1, laneH * 0.22), Math.max(1, clamp(xb, x0, x1) - clamp(xa, x0, x1)), Math.max(3, laneH * 0.56));
      });
      ctx.restore();
    });
    var sx = x0 + (state.selectedMs - sim.startMs) / (sim.endMs - sim.startMs) * (x1 - x0);
    if (sx >= x0 && sx <= x1) {
      ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1);
      ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (canvas.id === "overviewTimeline" && state.miniHover != null &&
        state.miniHover >= sim.startMs && state.miniHover <= sim.endMs) {
      var hx = x0 + (state.miniHover - sim.startMs) / (sim.endMs - sim.startMs) * (x1 - x0);
      if (hx >= x0 && hx <= x1) {
        ctx.beginPath(); ctx.moveTo(hx, y0); ctx.lineTo(hx, y1);
        ctx.strokeStyle = "rgba(232,242,251,.45)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.fillStyle = C.dim; ctx.font = "7.5px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(axisTime(sim.startMs, sim.endMs - sim.startMs), x0, h - 4);
    ctx.textAlign = "right";
    ctx.fillText(axisTime(sim.endMs, sim.endMs - sim.startMs), x1, h - 4);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Delay impact analyzer                                               */
  /* ------------------------------------------------------------------ */

  function runDelay() {
    if (!state.sim) return;
    var hours = Number($id("delayHours") ? $id("delayHours").value : 24);
    var siteB = $id("delaySiteB") ? state.byId[$id("delaySiteB").value] : state.site;
    var status = $id("delayStatus");
    if (!isFinite(hours) || hours < 0 || hours > 720) {
      if (status) status.textContent = "ساعات التأخير يجب أن تكون بين 0 و720.";
      return;
    }
    if (!siteB) siteB = state.site;
    var startB = state.sim.startMs + hours * 3600000;
    var endB = startB + state.durationH * 3600000;
    if (startB < E.DATA_START_MS || endB > E.DATA_END_MS + 1) {
      if (status) status.textContent = "السيناريو B يخرج عن نطاق البيانات (2026-11-01 → 2027-11-01 UTC). قلّل التأخير أو المدة.";
      return;
    }
    try {
      var geo = geometryFor(siteB);
      var simB = E.buildSimulation({
        site: siteB,
        startMs: startB,
        durationHours: state.durationH,
        stepMinutes: state.stepMinutes,
        geometryAt: geo.provider,
        selectedMs: startB,
        powerParams: null,
      });
      state.delay = { a: state.sim, b: simB, hours: hours, siteA: state.sim.site, siteB: siteB };
      renderDelay();
    } catch (err) {
      if (status) status.textContent = "تعذّر حساب سيناريو التأخير: " + err.message;
    }
  }

  function delayReadouts(sim) {
    var m = sim.metrics;
    return [
      { label: "الشمس المتاحة", value: fmtPct(m.sun.visibilityPct), cls: "green" },
      { label: "رؤية الأرض", value: fmtPct(m.earth.visibilityPct), cls: "cyan" },
      { label: "التداخل", value: fmtPct(m.overlap.pct), cls: "amber" },
      { label: "أطول انقطاع شمسي", value: m.sun.longestBlackoutH == null ? "— (طرف)" : fmtH(m.sun.longestBlackoutH), cls: "" },
    ];
  }

  function renderDelay() {
    var d = state.delay;
    if (!d) return;
    var a = d.a, b = d.b;
    var c = E.compareMetrics(a.metrics, b.metrics);
    var status = $id("delayStatus");
    if (status) {
      status.textContent = "السيناريو A: " + siteLabel(d.siteA) + " من " + selectedLabel(a.startMs) +
        " · السيناريو B: " + siteLabel(d.siteB) + " من " + selectedLabel(b.startMs) +
        " · إزاحة " + numUnit(d.hours, "ساعة", 0) + " · المدة " + numUnit(a.durationHours, "ساعة", 0) + " لكل سيناريو.";
    }
    var kpis = [];
    function kpi(label, aa, bb, digits) {
      var delta = bb - aa;
      var cls = delta > 0 ? "green" : delta < 0 ? "amber" : "";
      kpis.push('<article class="nav-kpi"><span class="nav-kpi-label">' + esc(label) + "</span><strong class=\"" + cls + "\">" +
        signedUnit(delta, "pp", digits) + "</strong><small>" + ltrValue("A " + fmtPct(aa, digits) + " → B " + fmtPct(bb, digits)) + "</small></article>");
    }
    kpi("تغيّر نسبة الشمس", a.metrics.sun.visibilityPct, b.metrics.sun.visibilityPct, 1);
    kpi("تغيّر نسبة رؤية الأرض", a.metrics.earth.visibilityPct, b.metrics.earth.visibilityPct, 1);
    kpi("تغيّر التداخل", a.metrics.overlap.pct, b.metrics.overlap.pct, 1);
    setHTML("delayKpis", kpis.join(""));
    fillReadouts("delayReadoutA", delayReadouts(a));
    fillReadouts("delayReadoutB", delayReadouts(b));
    drawMiniTimeline($id("delayTimelineA"), a, {});
    drawMiniTimeline($id("delayTimelineB"), b, {});
    var notes = E.explainComparison(c).map(function (n) {
      return '<li class="' + n.tone + '">' + esc(n.text) + "</li>";
    });
    if (d.siteA.id !== d.siteB.id) {
      notes.unshift('<li class="neutral">السيناريو B يغيّر الموقع أيضًا، وليس الزمن فقط؛ اعزل الأثر عند الحاجة بإبقاء الموقع نفسه.</li>');
    }
    if (Math.abs(d.hours) < 1e-9) {
      notes.unshift('<li class="neutral">التأخير صفر والموقع نفسه: السيناريوهان متطابقان.</li>');
    }
    notes.push('<li class="neutral">الفروق تُقاس على المدة نفسها. «pp» تعني نقطة مئوية، وليست نسبة تغيّر نسبي.</li>');
    setHTML("delayNotes", notes.join(""));
  }

  /* ------------------------------------------------------------------ */
  /* Site comparison                                                     */
  /* ------------------------------------------------------------------ */

  function checkedCompareIds() {
    return $$("#compareSites input:checked").map(function (i) { return i.value; });
  }

  function bestIndex(values, higherBetter) {
    var best = -1, bestV = null;
    values.forEach(function (v, i) {
      if (v == null || !isFinite(v)) return;
      if (best < 0 || (higherBetter ? v > bestV : v < bestV)) { best = i; bestV = v; }
    });
    return best;
  }

  function longestText(m) {
    if (m == null) return "—";
    if (m.longestBlackoutH != null) return fmtH(m.longestBlackoutH);
    if (m.longestBlackoutEdgeLimited) return "≥ " + fmtH(m.edgeBlackoutH) + " (طرف)";
    return "0";
  }

  function runCompare() {
    if (!state.sim) return;
    var ids = checkedCompareIds();
    var note = $id("compareNote");
    if (ids.length < 2) {
      if (note) note.textContent = "اختر موقعين على الأقل للمقارنة. حتى ثلاثة مواقع مدعومة في الجدول.";
      state.compare = null;
      return;
    }
    try {
      var entries = ids.map(function (id) {
        var site = state.byId[id];
        var sim = E.buildSimulation({
          site: site,
          startMs: state.sim.startMs,
          durationHours: state.sim.durationHours,
          stepMinutes: state.sim.stepMinutes,
          geometryAt: E.createGeometryProvider({ site: site, ephem: state.ephem[id], daily: state.daily[id] }),
          selectedMs: state.sim.startMs,
          powerParams: null,
        });
        return {
          site: site,
          metrics: sim.metrics,
          completeness: sim.metrics.terrainAvailable ? 1 : 0.5,
          sim: sim,
        };
      });
      var profile = state.compareProfile || "balanced";
      var scores = E.scoreSites(entries, profile);
      state.compare = { ids: ids, entries: entries, scores: scores, profile: profile };
      renderCompare();
    } catch (err) {
      if (note) note.textContent = "تعذّر حساب المقارنة: " + err.message;
    }
  }

  function renderCompare() {
    var c = state.compare;
    if (!c) return;
    var entries = c.entries;
    var head = '<tr><th>المقياس</th>' + entries.map(function (e) { return "<th>" + esc(siteLabel(e.site)) + "</th>"; }).join("") + "</tr>";
    var table = $id("compareTable");
    if (table && table.tHead) table.tHead.innerHTML = head;

    function row(label, values, formatter, higherBetter) {
      var best = bestIndex(values, higherBetter);
      return [label].concat(values.map(function (v, i) {
        var text = formatter(v);
        return i === best ? '<b class="state-visible">' + text + "</b>" : text;
      }));
    }
    var rows = [];
    rows.push(row("نسبة الشمس المتاحة", entries.map(function (e) { return e.metrics.sun.visibilityPct; }), function (v) { return fmtPct(v); }, true));
    rows.push(row("أطول انقطاع شمسي", entries.map(function (e) { return e.metrics.sun.longestBlackoutH; }), function (v) { return v == null ? "—" : fmtH(v); }, false));
    rows.push(row("نسبة رؤية الأرض", entries.map(function (e) { return e.metrics.earth.visibilityPct; }), function (v) { return fmtPct(v); }, true));
    rows.push(row("أطول انقطاع أرضي", entries.map(function (e) { return e.metrics.earth.longestBlackoutH; }), function (v) { return v == null ? "—" : fmtH(v); }, false));
    rows.push(row("تداخل الشمس والأرض", entries.map(function (e) { return e.metrics.overlap.pct; }), function (v) { return fmtPct(v); }, true));
    rows.push(row("الميل الموضعي", entries.map(function (e) { return e.site.slopeDeg; }), function (v) { return v == null ? "غير متاح" : numUnit(v, "°", 2, true); }, false));
    rows.push(["التضاريس"].concat(entries.map(function (e) {
      return e.metrics.terrainAvailable ? '<span class="state-visible">متاحة</span>' : '<span class="state-unavailable">غير متاحة</span>';
    })));
    rows.push(["اكتمال البيانات"].concat(entries.map(function (e) { return fmtPct(e.completeness * 100, 0); })));
    fillRows("compareBody", rows);

    var sorted = c.scores.results.slice().sort(function (a, b) { return b.score - a.score; });
    var scoreHTML = sorted.map(function (r, rank) {
      var details = r.contributions.map(function (x) {
        return "<li>" + esc(x.label) + ": " + ltrValue(fmt(x.value, 2) + " " + x.unit) + " → " + fmt(x.points, 1) + " نقطة (وزن " + fmtPct(x.weight * 100, 0) + ")</li>";
      }).join("");
      return '<article class="nav-score">' +
        '<div class="nav-score-head"><b>' + (rank + 1) + " · " + esc(r.siteName) + "</b><strong>" + fmt(r.score, 1) + "</strong></div>" +
        '<div class="nav-score-bar"><i style="width:' + clamp(r.score, 0, 100).toFixed(1) + '%"></i></div>' +
        '<small>درجة نسبية من 100 · ' + (r.terrainAvailable ? "تضاريس متاحة" : "هندسي فقط") + " · اكتمال " + fmtPct(r.completeness * 100, 0) + "</small>" +
        '<details><summary>تفصيل النقاط</summary><ul>' + details + "</ul></details></article>";
    }).join("");
    setHTML("compareScores", scoreHTML);

    var weightRows = c.scores.criteria.map(function (x) {
      return [esc(x.label), x.better === "higher" ? "أعلى أفضل" : "أقل أفضل", fmtPct(x.weight * 100, 1),
        (x.range ? ltrValue(fmt(x.range.min, 2) + " – " + fmt(x.range.max, 2)) : "—"), "مستخدم"];
    });
    c.scores.excluded.forEach(function (x) {
      weightRows.push([esc(x.label), "—", "—", "—", "مستبعد: " + esc(x.reason)]);
    });
    fillRows("compareWeights", weightRows);

    var note = $id("compareNote");
    if (note) {
      note.textContent = c.scores.profileLabel + ". " + c.scores.note +
        (c.scores.excluded.length ? " المعايير المستبعدة: " + c.scores.excluded.map(function (x) { return x.label; }).join("، ") + "." : "");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Solar power estimator                                               */
  /* ------------------------------------------------------------------ */

  function num(id, fallback) {
    var node = $id(id);
    var v = node ? Number(node.value) : NaN;
    return isFinite(v) ? v : fallback;
  }

  function readPowerParams() {
    return {
      enabled: true,
      areaM2: num("pwArea", 4),
      efficiencyPct: num("pwEff", 29),
      packingPct: num("pwPacking", 90),
      panelTiltDeg: num("pwTilt", 60),
      panelAzDeg: num("pwAz", 180),
      lossesPct: num("pwLoss", 20),
      batteryWh: num("pwBattery", 10000),
      initialPct: num("pwInitial", 100),
      loadW: num("pwLoad", 300),
    };
  }

  function runPower() {
    if (!state.sim) return;
    var params = readPowerParams();
    if (!(params.areaM2 > 0)) return powerError("مساحة المصفوفة يجب أن تكون أكبر من صفر.");
    if (params.efficiencyPct <= 0 || params.efficiencyPct > 50) return powerError("كفاءة الخلية يجب أن تكون بين 1% و50%.");
    if (params.packingPct <= 0 || params.packingPct > 100) return powerError("نسبة التعبئة يجب أن تكون بين 1% و100%.");
    if (params.lossesPct < 0 || params.lossesPct >= 100) return powerError("خسائر النظام يجب أن تكون بين 0% و99%.");
    if (params.batteryWh < 0) return powerError("سعة البطارية لا يمكن أن تكون سالبة.");
    if (params.initialPct < 0 || params.initialPct > 100) return powerError("الشحن الابتدائي يجب أن يكون بين 0% و100%.");
    if (params.loadW < 0) return powerError("الحمل المستمر لا يمكن أن يكون سالبًا.");
    var basisNode = $id("pwBasis");
    var basis = basisNode ? basisNode.value : "terrain";
    try {
      var sim = E.buildSimulation({
        site: state.sim.site,
        startMs: state.sim.startMs,
        durationHours: state.sim.durationHours,
        stepMinutes: state.sim.stepMinutes,
        geometryAt: state.provider,
        customHorizon: state.site.custom ? state.customHorizon : null,
        selectedMs: state.selectedMs,
        powerParams: params,
        powerBasis: basis,
      });
      state.powerSim = sim;
      state.powerParams = params;
      renderPower();
      renderOverview();
      renderTimeline();
      drawPowerChart();
    } catch (err) {
      powerError("تعذّر حساب الطاقة: " + err.message);
    }
  }

  function powerError(message) {
    var note = $id("pwNote");
    if (note) note.textContent = message;
  }

  function renderPower() {
    var sim = state.powerSim;
    var note = $id("pwNote");
    if (!sim) {
      fillReadouts("pwResults", [
        { label: "الطاقة الكلية", value: "—" },
        { label: "القدرة الذروة", value: "—" },
        { label: "أدنى شحن", value: "—" },
      ]);
      return;
    }
    var p = sim.metrics.power;
    if (!p || !p.available) {
      if (note) note.textContent = "لم تُفعّل حسابات الطاقة.";
      return;
    }
    var batteryPct = p.batteryAvailable
      ? (p.minChargeWh / p.capacityWh) * 100 : null;
    var finalPct = p.batteryAvailable
      ? (p.finalChargeWh / p.capacityWh) * 100 : null;
    var status = !p.batteryAvailable ? "بدون بطارية"
      : p.depleted ? "نُفدت أثناء النافذة" : "لم تُنفد";
    fillReadouts("pwResults", [
      { label: "الطاقة الكلية", value: numUnit(p.totalEnergyWh / 1000, "kWh", 2), cls: "green" },
      { label: "القدرة الذروة", value: numUnit(p.peakPowerW, "W", 1), cls: "amber" },
      { label: "أدنى شحن", value: batteryPct == null ? "—" : fmtPct(batteryPct), cls: batteryPct != null && batteryPct < 20 ? "no" : "" },
      { label: "الشحن النهائي", value: finalPct == null ? "—" : fmtPct(finalPct), cls: "" },
      { label: "حالة البطارية", value: status, cls: p.depleted ? "no" : "ok" },
      { label: "أساس الإضاءة", value: basisLabel(sim.metrics.terrainBasis), cls: "cyan" },
    ]);
    var fallback = state.powerParams && ($id("pwBasis") ? $id("pwBasis").value : "terrain") === "terrain" && !state.sim.metrics.terrainAvailable;
    if (note) {
      note.innerHTML = "افتراضات المستخدم: مساحة " + fmt(state.powerParams.areaM2, 1) + " m²، كفاءة " +
        fmt(state.powerParams.efficiencyPct, 0) + "%، تعبئة " + fmt(state.powerParams.packingPct, 0) + "%، خسائر " +
        fmt(state.powerParams.lossesPct, 0) + "%، حمل " + fmt(state.powerParams.loadW, 0) + " W. " +
        "الإشعاع محسوب عند مسافة الشمس الفعلية، بلا انتثار أو انعكاس أرضي. " +
        (fallback ? "لا يوجد أفق تضاريس، فاستُخدم الأساس الهندسي رغم اختيار «تضاريس». " : "") +
        (p.note ? p.note : "") +
        " هذه ليست معاملات مهمة حقيقية.";
    }
    drawPowerChart();
  }

  function drawPowerChart() {
    var f = fit($id("pwChart"));
    if (!f) return;
    var ctx = f.ctx, w = f.w, h = f.h;
    var sim = state.powerSim;
    if (!sim || !sim.metrics.power || !sim.metrics.power.available) return;
    var p = sim.metrics.power;
    var samples = sim.samples;
    var power = samples.map(function (s) { return s.power && s.power.available ? s.power.powerW : 0; });
    var maxP = Math.max.apply(null, power.concat([1]));
    var hasBattery = p.batteryAvailable && p.series && p.series.length;
    var pad = { l: 40, r: hasBattery ? 42 : 12, t: 14, b: 22 };
    var x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b;
    function xOf(t) { return x0 + (t - sim.startMs) / (sim.endMs - sim.startMs) * (x1 - x0); }
    function yP(v) { return y1 - (v / maxP) * (y1 - y0); }
    function yB(v) { return y1 - (v / 100) * (y1 - y0); }
    ctx.save();
    ctx.direction = "ltr";
    for (var k = 0; k <= 4; k++) {
      var val = maxP * k / 4;
      var y = yP(val);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.strokeStyle = "rgba(100,124,147,.13)"; ctx.stroke();
      ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(fmt(val, 0) + " W", x0 - 5, y + 3);
      if (hasBattery) {
        ctx.fillStyle = C.blue; ctx.textAlign = "left";
        ctx.fillText(fmt(100 * k / 4, 0) + "%", x1 + 5, y + 3);
      }
    }
    // power area
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    samples.forEach(function (s, i) { ctx.lineTo(xOf(s.tMs), yP(power[i])); });
    ctx.lineTo(x1, y1); ctx.closePath();
    ctx.fillStyle = "rgba(94,224,160,.13)"; ctx.fill();
    ctx.beginPath();
    samples.forEach(function (s, i) {
      var x = xOf(s.tMs), y = yP(power[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = C.power; ctx.lineWidth = 1.7; ctx.stroke();
    // battery
    if (hasBattery) {
      ctx.beginPath();
      p.series.forEach(function (s, i) {
        var x = xOf(s.tMs), y = yB(s.chargeWh / p.capacityWh * 100);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = C.blue; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    var sx = xOf(state.selectedMs);
    if (sx >= x0 && sx <= x1) {
      ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1);
      ctx.strokeStyle = C.amber; ctx.lineWidth = 1.1; ctx.stroke();
    }
    ctx.fillStyle = C.dim; ctx.font = "8px IBM Plex Sans Arabic, sans-serif"; ctx.textAlign = "left";
    ctx.fillText("القدرة (W)", x0, y0 - 3);
    if (hasBattery) {
      ctx.textAlign = "right"; ctx.fillStyle = C.blue;
      ctx.fillText("شحن البطارية (%)", x1, y0 - 3);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Simplified link budget                                              */
  /* ------------------------------------------------------------------ */

  function readLinkParams() {
    return {
      txPowerW: num("lkPower", 20),
      frequencyMHz: num("lkFreq", 8400),
      gtxDbi: num("lkGtx", 35),
      grxDbi: num("lkGrx", 40),
      lossesDb: num("lkLoss", 3),
      pointingLossDb: num("lkPointing", 0),
      thresholdDbm: num("lkThreshold", -160),
      distanceKm: num("lkDistance", 384400),
    };
  }

  function runLink() {
    if (!state.sim) return;
    var params = readLinkParams();
    var note = $id("lkNote");
    if (!(params.txPowerW > 0)) { if (note) note.textContent = "قدرة الإرسال يجب أن تكون أكبر من صفر."; return; }
    if (!(params.frequencyMHz > 0)) { if (note) note.textContent = "التردد يجب أن يكون أكبر من صفر."; return; }
    if (!(params.distanceKm > 0)) { if (note) note.textContent = "المسافة يجب أن تكون أكبر من صفر."; return; }
    var result = E.linkBudget(params);
    state.link = { params: params, result: result };
    renderLink();
  }

  function renderLink() {
    var l = state.link;
    var note = $id("lkNote");
    if (!l) {
      fillReadouts("lkResults", [
        { label: "قدرة الإرسال", value: "—" },
        { label: "FSPL", value: "—" },
        { label: "الاستقبال", value: "—" },
      ]);
      return;
    }
    var r = l.result;
    fillReadouts("lkResults", [
      { label: "قدرة الإرسال", value: numUnit(r.txDbm, "dBm", 2), cls: "cyan" },
      { label: "FSPL", value: numUnit(r.fsplDb, "dB", 2), cls: "amber" },
      { label: "القدرة المستقبَلة", value: numUnit(r.rxDbm, "dBm", 2), cls: "" },
      { label: "الهامش", value: signedUnit(r.marginDb, "dB", 2), cls: r.feasible ? "ok" : "no" },
      { label: "الحكم", value: r.feasible ? "ممكن هندسيًا" : "غير ممكن", cls: r.feasible ? "ok" : "no" },
      { label: "العتبة المفترضة", value: numUnit(r.assumedThresholdDbm, "dBm", 0), cls: "" },
    ]);
    var sample = state.sim ? E.sampleAt(state.sim, state.selectedMs) : null;
    var earthDist = sample ? sample.earth.distanceKm : null;
    if (note) {
      note.innerHTML = "FSPL = 20 log₁₀(d_km) + 20 log₁₀(f_MHz) + 32.44778. " +
        "المدخلات: " + fmt(l.params.txPowerW, 2) + " W، " + fmt(l.params.frequencyMHz, 0) + " MHz، " +
        "كسب " + fmt(l.params.gtxDbi, 1) + "/" + fmt(l.params.grxDbi, 1) + " dBi، خسائر " +
        fmt(l.params.lossesDb, 1) + " dB. " +
        (earthDist != null ? "مسافة الأرض عند اللحظة المحددة: " + fmtDistance(earthDist) + ". " : "") +
        "لا يحسب الضوضاء أو معدل البيانات أو الترميز أو Doppler. " +
        (sample && !sample.earth.geometric ? "الأرض تحت الأفق الهندسي في اللحظة المحددة؛ هذه النتيجة ليست نافذة اتصال. " : "") +
        '<button class="btn btn-ghost btn-sm" type="button" data-use-distance="' + (earthDist != null ? Math.round(earthDist) : "") + '">استخدم مسافة اللحظة المحددة</button>';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Method and validation                                               */
  /* ------------------------------------------------------------------ */

  function renderMethodValidation() {
    if (state.validation) {
      fillRows("methodValidation", state.validation);
      return;
    }
    if (!state.ephem.site01 || !state.ephem["site04-peak"]) return;
    var pairs = [
      ["site01", "site04-peak"],
      ["site01", "site04-low"],
      ["site04-peak", "site04-low"],
    ];
    var rows = [];
    pairs.forEach(function (pair) {
      var ref = state.byId[pair[0]], target = state.byId[pair[1]];
      if (!ref || !target) return;
      try {
        var r = E.validateFrameTransform(ref, state.ephem[ref.id], state.daily[ref.id], target, state.ephem[target.id]);
        rows.push([
          esc(siteLabel(ref)) + " → " + esc(siteLabel(target)),
          fmt(r.maxAzErrorDeg, 4) + "°",
          fmt(r.maxElErrorDeg, 4) + "°",
          String(r.samples),
        ]);
      } catch (err) {
        rows.push([esc(siteLabel(ref)) + " → " + esc(siteLabel(target)), "—", "—", "خطأ"]);
      }
    });
    state.validation = rows;
    fillRows("methodValidation", rows);
  }

  function renderMethod() {
    setText("methodVersion", "LMN v" + E.VERSION);
    renderMethodValidation();
  }

  /* ------------------------------------------------------------------ */
  /* CSV export                                                          */
  /* ------------------------------------------------------------------ */

  function downloadCsv() {
    if (!state.sim) return;
    var sim = state.sim;
    var rows = [["site_id", "layer", "start_utc", "end_utc", "duration_h", "edge_start", "edge_end"]];
    var defs = trackDefs(sim);
    defs.forEach(function (d) {
      if (!d.intervals) return;
      d.intervals.forEach(function (r) {
        rows.push([
          sim.site.id,
          d.key,
          E.isoUtc(r.startMs),
          E.isoUtc(r.endMs),
          r.durationH.toFixed(4),
          r.edgeStart ? "true" : "false",
          r.edgeEnd ? "true" : "false",
        ]);
      });
    });
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "lunar-windows_" + sim.site.id + "_" + dateISO(sim.startMs) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Tabs, selection, and playback                                       */
  /* ------------------------------------------------------------------ */

  function syncTabUI() {
    $$(".nav-tabs button").forEach(function (btn) {
      btn.setAttribute("aria-selected", btn.getAttribute("data-tab") === state.tab ? "true" : "false");
    });
    TABS.forEach(function (name) {
      var panel = $id("panel-" + name);
      if (panel) panel.hidden = name !== state.tab;
    });
  }

  function renderActiveTab() {
    if (!state.sim) return;
    if (state.tab === "overview") renderOverview();
    else if (state.tab === "simulator") renderSimulator();
    else if (state.tab === "horizon") renderHorizon();
    else if (state.tab === "timeline") renderTimeline();
    else if (state.tab === "delay") renderDelay();
    else if (state.tab === "compare") renderCompare();
    else if (state.tab === "engineering") { renderPower(); renderLink(); drawPowerChart(); }
    else if (state.tab === "method") renderMethod();
  }

  function activateTab(name, options) {
    if (TABS.indexOf(name) < 0) return;
    var opts = options || {};
    state.tab = name;
    syncTabUI();
    if (opts.updateHash !== false && window.history && history.replaceState) {
      history.replaceState(null, "", "#" + name);
    }
    if (!state.sim) return;
    renderLazyForTab();
    window.requestAnimationFrame(function () { renderActiveTab(); });
  }

  function refreshSelection() {
    var sim = state.sim;
    if (!sim) return;
    state.selectedMs = clamp(state.selectedMs, sim.startMs, sim.endMs);
    sim.selectedMs = state.selectedMs;
    var slider = $id("simTimeSlider");
    if (slider) slider.value = String(E.nearestSampleIndex(sim, state.selectedMs));
    setText("simTimeOut", selectedLabel(state.selectedMs));
    renderSelectedReadouts();
    renderSimulator();
    renderHorizon();
    renderTimeline();
    drawMiniTimeline($id("overviewTimeline"), sim, { power: powerTrack(sim) });
    if (state.delay) {
      drawMiniTimeline($id("delayTimelineA"), state.delay.a, {});
      drawMiniTimeline($id("delayTimelineB"), state.delay.b, {});
    }
    drawPowerChart();
  }

  function setSelected(ms) {
    if (!state.sim) return;
    state.selectedMs = clamp(ms, state.sim.startMs, state.sim.endMs);
    refreshSelection();
  }

  function updatePlayButtons() {
    var ids = ["simPlay", "tlPlay"];
    ids.forEach(function (id) {
      var b = $id(id);
      if (!b) return;
      b.setAttribute("aria-pressed", state.playing ? "true" : "false");
      b.textContent = state.playing ? "⏸ إيقاف" : "▶ تشغيل";
    });
  }

  function stopPlayback() {
    state.playing = false;
    if (state.playTimer) {
      clearInterval(state.playTimer);
      state.playTimer = null;
    }
    updatePlayButtons();
  }

  function togglePlay() {
    if (state.playing) { stopPlayback(); return; }
    if (!state.sim) return;
    var sim = state.sim;
    var idx = E.nearestSampleIndex(sim, state.selectedMs);
    if (idx >= sim.samples.length - 1) state.selectedMs = sim.startMs;
    state.playing = true;
    updatePlayButtons();
    refreshSelection();
    state.playTimer = setInterval(function () {
      var i = E.nearestSampleIndex(sim, state.selectedMs);
      if (i >= sim.samples.length - 1) { stopPlayback(); return; }
      state.selectedMs = sim.samples[i + 1].tMs;
      refreshSelection();
    }, 300);
  }

  /* ------------------------------------------------------------------ */
  /* Bindings                                                            */
  /* ------------------------------------------------------------------ */

  function on(id, event, handler, options) {
    var node = $id(id);
    if (node) node.addEventListener(event, handler, options);
  }

  function markDirty() {
    if (state.sim) setScenarioStatus("", "تغييرات غير مطبقة — اضغط «تشغيل المحاكاة».");
  }

  function syncDurationPreset() {
    var value = $id("durationHours") ? String(Number($id("durationHours").value)) : "";
    $$("#durationPresets button").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-hours") === value);
    });
  }

  function syncDelayPreset() {
    var value = $id("delayHours") ? String(Number($id("delayHours").value)) : "";
    var known = { "24": true, "48": true, "72": true };
    $$("#delayPresets button").forEach(function (b) {
      var key = b.getAttribute("data-delay");
      b.classList.toggle("is-active", key === "custom" ? !known[value] : key === value);
    });
  }

  function previewCustomPolicy() {
    var note = $id("customPolicyNote");
    if (!note) return;
    var lat = Number($id("customLat") ? $id("customLat").value : NaN);
    var lon = Number($id("customLon") ? $id("customLon").value : NaN);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > -60 || lon < 0 || lon > 360) {
      note.textContent = "أدخل خط عرض بين −90° و−60° وخط طول شرقي بين 0° و360°.";
      return;
    }
    var xy = E.latLonToXY(lat, lon);
    var meta = demForPoint(xy.x, xy.y);
    if (meta) {
      note.innerHTML = "الإحداثيات داخل نافذة <span class=\"mono\">" + esc(meta.id) +
        "</span>؛ سيُحسب أفق تضاريسي من DEM بدقة 20 m/px عند تشغيل السيناريو. " +
        "الهندسة السماوية مشتقة من أقرب موقع مرجعي حقيقي.";
    } else {
      note.textContent = "الإحداثيات خارج نافذتي DEM المشحونتين. ستُعرض الرؤية الهندسية فقط، ونتائج التضاريس «غير متاحة» دون تقدير.";
    }
  }

  function bindTabs() {
    $$(".nav-tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () { activateTab(btn.getAttribute("data-tab")); });
      btn.addEventListener("keydown", function (e) {
        var idx = TABS.indexOf(btn.getAttribute("data-tab"));
        if (e.key === "ArrowRight") { e.preventDefault(); activateTab(TABS[(idx + 1) % TABS.length]); }
        if (e.key === "ArrowLeft") { e.preventDefault(); activateTab(TABS[(idx - 1 + TABS.length) % TABS.length]); }
        if (e.key === "Home") { e.preventDefault(); activateTab(TABS[0]); }
        if (e.key === "End") { e.preventDefault(); activateTab(TABS[TABS.length - 1]); }
      });
    });
    window.addEventListener("hashchange", function () {
      var name = window.location.hash.replace("#", "");
      if (TABS.indexOf(name) >= 0 && name !== state.tab) activateTab(name, { updateHash: false });
    });
  }

  function bindScenarioControls() {
    on("runScenario", "click", function () { runScenario(); });
    on("applyCustom", "click", function () { previewCustomPolicy(); runScenario(); });
    on("siteSelect", "change", function () {
      var custom = this.value === "custom";
      var fields = $id("customSiteFields");
      if (fields) fields.hidden = !custom;
      if (custom) previewCustomPolicy();
      else updateCustomPolicyNote(null, state.byId[this.value] || state.site);
      markDirty();
    });
    ["startDate", "startTime", "durationHours", "stepMinutes"].forEach(function (id) {
      on(id, "change", markDirty);
    });
    on("durationHours", "input", syncDurationPreset);
    ["customName", "customLat", "customLon"].forEach(function (id) {
      on(id, "input", function () { previewCustomPolicy(); markDirty(); });
    });
    on("durationPresets", "click", function (e) {
      var btn = e.target.closest("button[data-hours]");
      if (!btn) return;
      $$("#durationPresets button").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      var dur = $id("durationHours");
      if (dur) dur.value = btn.getAttribute("data-hours");
      runScenario();
    });
    on("tzOffset", "change", function () {
      state.tzOffset = Number(this.value) || 0;
      if (state.sim) {
        renderAll();
        if (state.delay) renderDelay();
        if (state.link) renderLink();
        drawPowerChart();
      }
    });
    on("horizonAz", "input", function () {
      renderHorizon();
    });
    on("simTimeSlider", "input", function () {
      if (!state.sim) return;
      var idx = Number(this.value);
      setSelected(state.sim.startMs + idx * state.sim.stepMinutes * 60000);
    });
    on("downloadCsv", "click", downloadCsv);
  }

  function bindDelayCompare() {
    on("delayPresets", "click", function (e) {
      var btn = e.target.closest("button[data-delay]");
      if (!btn) return;
      $$("#delayPresets button").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      var value = btn.getAttribute("data-delay");
      var input = $id("delayHours");
      if (value === "custom") {
        if (input) input.focus();
        return;
      }
      if (input) input.value = value;
      runDelay();
    });
    on("delayRun", "click", runDelay);
    on("delaySiteB", "change", runDelay);
    on("delayHours", "input", syncDelayPreset);
    on("compareRun", "click", runCompare);
    on("compareProfile", "click", function (e) {
      var btn = e.target.closest("button[data-profile]");
      if (!btn) return;
      $$("#compareProfile button").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      state.compareProfile = btn.getAttribute("data-profile");
      runCompare();
    });
    on("compareSites", "change", function (e) {
      var checked = checkedCompareIds();
      if (checked.length > 3) {
        if (e.target && e.target.checked) e.target.checked = false;
        var note = $id("compareNote");
        if (note) note.textContent = "الحد الأقصى ثلاثة مواقع في جدول المقارنة. أزل موقعًا قبل إضافة آخر.";
      }
    });
  }

  function bindEngineering() {
    on("pwRun", "click", runPower);
    on("lkRun", "click", runLink);
    var note = $id("lkNote");
    if (note) {
      note.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-use-distance]");
        if (!btn) return;
        var d = Number(btn.getAttribute("data-use-distance"));
        if (isFinite(d) && d > 0) {
          var input = $id("lkDistance");
          if (input) input.value = String(Math.round(d));
          runLink();
        }
      });
    }
  }

  function bindTimeline() {
    var canvas = $id("timelineCanvas");
    if (!canvas) return;
    var drag = null;
    canvas.addEventListener("pointerdown", function (e) {
      if (!state.sim || e.button !== 0) return;
      var v = state.timelineLayout || timelineView(state.sim, canvas.clientWidth, canvas.clientHeight);
      drag = { x: e.clientX, center: state.timelineCenter, moved: false, v: v };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!state.sim) return;
      var v = state.timelineLayout || timelineView(state.sim, canvas.clientWidth, canvas.clientHeight);
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      if (drag) {
        var dx = e.clientX - drag.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (drag.moved && state.timelineZoom > 1) {
          state.timelineCenter = clamp(drag.center - dx / Math.max(1, v.x1 - v.x0) * v.span, 0, 1);
          drawTimeline();
        }
        return;
      }
      if (x >= v.x0 && x <= v.x1) {
        state.timelineHover = v.tOf(x);
        drawTimeline();
      } else if (state.timelineHover != null) {
        state.timelineHover = null;
        drawTimeline();
      }
    });
    function endDrag(e) {
      if (!drag || !state.sim) return;
      var v = drag.v;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var wasClick = !drag.moved;
      drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (wasClick && x >= v.x0 && x <= v.x1) setSelected(v.tOf(x));
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", function () { drag = null; });
    canvas.addEventListener("pointerleave", function () {
      drag = null;
      if (state.timelineHover != null) { state.timelineHover = null; drawTimeline(); }
    });
    canvas.addEventListener("wheel", function (e) {
      if (!state.sim) return;
      e.preventDefault();
      var v = state.timelineLayout || timelineView(state.sim, canvas.clientWidth, canvas.clientHeight);
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      if (x < v.x0 || x > v.x1) return;
      var frac = (v.tOf(x) - state.sim.startMs) / (state.sim.endMs - state.sim.startMs);
      var factor = e.deltaY < 0 ? 1.25 : 0.8;
      state.timelineZoom = clamp(state.timelineZoom * factor, 1, 16);
      state.timelineCenter = clamp(frac, 0, 1);
      drawTimeline();
    }, { passive: false });
    canvas.addEventListener("dblclick", function () {
      state.timelineZoom = 1;
      state.timelineCenter = 0.5;
      drawTimeline();
    });
    on("tlZoomIn", "click", function () {
      if (!state.sim) return;
      var frac = (state.selectedMs - state.sim.startMs) / (state.sim.endMs - state.sim.startMs);
      if (state.timelineZoom === 1) state.timelineCenter = clamp(frac, 0, 1);
      state.timelineZoom = clamp(state.timelineZoom * 1.6, 1, 16);
      drawTimeline();
    });
    on("tlZoomOut", "click", function () {
      state.timelineZoom = clamp(state.timelineZoom / 1.6, 1, 16);
      if (state.timelineZoom === 1) state.timelineCenter = 0.5;
      drawTimeline();
    });
    on("tlReset", "click", function () {
      state.timelineZoom = 1;
      state.timelineCenter = 0.5;
      state.timelineHover = null;
      drawTimeline();
    });
  }

  function bindPlayback() {
    ["simPlay", "tlPlay"].forEach(function (id) {
      on(id, "click", togglePlay);
    });
  }

  function bindOverviewAndMisc() {
    var mini = $id("overviewTimeline");
    if (mini) {
      function miniTimeAt(e) {
        if (!state.sim) return null;
        var rect = mini.getBoundingClientRect();
        var w = rect.width;
        var x0 = 8, x1 = w - 74;
        var x = e.clientX - rect.left;
        if (x < x0 || x > x1) return null;
        var frac = (x - x0) / (x1 - x0);
        return state.sim.startMs + frac * (state.sim.endMs - state.sim.startMs);
      }
      mini.style.cursor = "crosshair";
      mini.addEventListener("click", function (e) {
        var t = miniTimeAt(e);
        if (t != null) setSelected(t);
      });
      mini.addEventListener("pointermove", function (e) {
        var t = miniTimeAt(e);
        if (t == null) return;
        state.miniHover = t;
        drawMiniTimeline(mini, state.sim, { power: powerTrack(state.sim) });
      });
      mini.addEventListener("pointerleave", function () {
        if (state.miniHover == null) return;
        state.miniHover = null;
        drawMiniTimeline(mini, state.sim, { power: powerTrack(state.sim) });
      });
    }
    window.addEventListener("resize", function () {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(function () {
        if (state.sim) renderActiveTab();
      }, 160);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopPlayback();
    });
  }

  function init() {
    bindTabs();
    bindScenarioControls();
    bindDelayCompare();
    bindEngineering();
    bindTimeline();
    bindPlayback();
    bindOverviewAndMisc();
    var hash = window.location.hash.replace("#", "");
    if (TABS.indexOf(hash) >= 0) state.tab = hash;
    state.compareProfile = "balanced";
    syncTabUI();
    updatePlayButtons();
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
