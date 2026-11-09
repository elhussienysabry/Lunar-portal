/* ==========================================================================
   Lunar Mission Navigator — scientific calculation engine
   --------------------------------------------------------------------------
   This file is intentionally dependency-free and usable both in the browser
   (window.LMN) and in Node.js (module.exports) for automated tests.

   Canonical internal conventions
   ------------------------------
   Time            : UTC milliseconds. The source ephemeris is hourly UTC.
   Angles          : degrees at the public API boundary.
   Azimuth         : true north = 0°, clockwise through east = 90°.
   Elevation       : degrees above the local geometric horizon.
   Coordinate frame: the internal "LMN south-polar frame" is the frame used by
                     the supplied JPL Horizons topocentric series. It uses
                     phi = -latitude and lambda = east longitude. This frame is
                     validated against all three supplied sites; see
                     validateFrameTransform() and the tests.
   Terrain horizon : 1° azimuth bins, maximum elevation angle including the
                     spherical curvature drop d^2 / (2R). No refraction.
   Visibility      : an object is geometrically visible when its upper limb
                     (elevation + angular radius) is above 0°. It is terrain
                     visible when the upper limb is above the terrain horizon
                     at its azimuth. This is a geometric criterion, not a
                     statement about radio performance or instrument duty.
   ========================================================================== */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LMN = Object.assign(root.LMN || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "1.0.0";
  var MOON_RADIUS_KM = 1737.4;
  var MOON_RADIUS_M = MOON_RADIUS_KM * 1000;
  var SUN_RADIUS_KM = 696340;
  var EARTH_RADIUS_KM = 6371;
  var AU_KM = 149597870.7;
  var SOLAR_CONSTANT_W_M2 = 1361;
  var DATA_START_MS = Date.parse("2026-11-01T00:00:00Z");
  var DATA_END_MS = Date.parse("2027-11-01T00:00:00Z");
  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;
  var EPS = 1e-9;

  /* ------------------------------------------------------------------ */
  /* Generic helpers                                                     */
  /* ------------------------------------------------------------------ */

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function azNorm(a) {
    return ((a % 360) + 360) % 360;
  }

  function wrap180(a) {
    return ((a + 180) % 360 + 360) % 360 - 180;
  }

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function sum(arr) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i];
    return t;
  }

  function parseUtc(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value !== "string") return NaN;
    var s = value.trim();
    if (!s) return NaN;
    // Accept "YYYY-MM-DDTHH:MM" and "YYYY-MM-DD HH:MM" as UTC, and full ISO.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "Z";
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(" ", "T") + "Z";
    return Date.parse(s);
  }

  function isoUtc(ms) {
    return new Date(ms).toISOString().replace(".000Z", "Z");
  }

  function isoMinuteUtc(ms) {
    return new Date(ms).toISOString().slice(0, 16) + "Z";
  }

  function isoDateUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function timeLabel(ms, offsetMinutes, withDate) {
    var off = isFiniteNumber(offsetMinutes) ? offsetMinutes : 0;
    var d = new Date(ms + off * 60000);
    var iso = d.toISOString();
    var date = iso.slice(0, 10);
    var time = iso.slice(11, 16);
    var sign = off >= 0 ? "+" : "-";
    var ao = Math.abs(off);
    var zone = "UTC" + (ao === 0 ? "" : sign + String(Math.floor(ao / 60)).padStart(2, "0") + ":" + String(ao % 60).padStart(2, "0"));
    return (withDate ? date + " · " : "") + time + " " + zone;
  }

  function hoursBetween(a, b) {
    return (b - a) / 3600000;
  }

  function round(v, digits) {
    var p = Math.pow(10, digits || 0);
    return Math.round(v * p) / p;
  }

  /* ------------------------------------------------------------------ */
  /* Frame transforms and body geometry                                  */
  /* ------------------------------------------------------------------ */

  function enuBasis(latDeg, lonDeg) {
    // Internal LMN south-polar frame: phi = -latitude, lambda = east longitude.
    var phi = -latDeg * DEG;
    var lam = lonDeg * DEG;
    var sp = Math.sin(phi), cp = Math.cos(phi);
    var sl = Math.sin(lam), cl = Math.cos(lam);
    return {
      east: [-sl, cl, 0],
      north: [-sp * cl, -sp * sl, cp],
      up: [cp * cl, cp * sl, sp],
    };
  }

  function moonPosition(latDeg, lonDeg) {
    var b = enuBasis(latDeg, lonDeg);
    return [b.up[0] * MOON_RADIUS_KM, b.up[1] * MOON_RADIUS_KM, b.up[2] * MOON_RADIUS_KM];
  }

  function directionVector(latDeg, lonDeg, azDeg, elDeg) {
    var b = enuBasis(latDeg, lonDeg);
    var a = azDeg * DEG;
    var e = elDeg * DEG;
    var ce = Math.cos(e);
    var x = ce * Math.sin(a);
    var y = ce * Math.cos(a);
    var z = Math.sin(e);
    return [
      x * b.east[0] + y * b.north[0] + z * b.up[0],
      x * b.east[1] + y * b.north[1] + z * b.up[1],
      x * b.east[2] + y * b.north[2] + z * b.up[2],
    ];
  }

  function vectorToAzEl(latDeg, lonDeg, v) {
    var b = enuBasis(latDeg, lonDeg);
    var x = v[0] * b.east[0] + v[1] * b.east[1] + v[2] * b.east[2];
    var y = v[0] * b.north[0] + v[1] * b.north[1] + v[2] * b.north[2];
    var z = v[0] * b.up[0] + v[1] * b.up[1] + v[2] * b.up[2];
    var n = Math.sqrt(x * x + y * y + z * z);
    if (!(n > 0)) return { az: 0, el: 0, distanceKm: 0 };
    return {
      az: azNorm(Math.atan2(x, y) * RAD),
      el: Math.asin(clamp(z / n, -1, 1)) * RAD,
      distanceKm: n,
    };
  }

  function bodyPositionFromObservation(site, obs) {
    var u = directionVector(site.lat, site.lon, obs.az, obs.el);
    var r = moonPosition(site.lat, site.lon);
    var d = obs.distanceKm;
    return [r[0] + d * u[0], r[1] + d * u[1], r[2] + d * u[2]];
  }

  function observationFromBodyPosition(site, pos) {
    var r = moonPosition(site.lat, site.lon);
    return vectorToAzEl(site.lat, site.lon, [pos[0] - r[0], pos[1] - r[1], pos[2] - r[2]]);
  }

  function angularRadiusDeg(radiusKm, distanceKm) {
    if (!(distanceKm > radiusKm)) return 90;
    return Math.asin(radiusKm / distanceKm) * RAD;
  }

  function sunAngularRadiusDeg(distanceKm) {
    return angularRadiusDeg(SUN_RADIUS_KM, distanceKm);
  }

  function earthAngularRadiusDeg(distanceKm) {
    return angularRadiusDeg(EARTH_RADIUS_KM, distanceKm);
  }

  /* ------------------------------------------------------------------ */
  /* Ephemeris sampling                                                  */
  /* ------------------------------------------------------------------ */

  function validateEphemeris(ephem) {
    var errors = [];
    if (!ephem || typeof ephem !== "object") return ["ephemeris is not an object"];
    var start = parseUtc(ephem.start);
    if (!isFinite(start)) errors.push("invalid ephemeris.start");
    if (!isFiniteNumber(ephem.stepHours) || ephem.stepHours <= 0) errors.push("invalid ephemeris.stepHours");
    if (!Number.isInteger(ephem.count) || ephem.count < 2) errors.push("invalid ephemeris.count");
    ["sunAz", "sunEl", "earthAz", "earthEl"].forEach(function (k) {
      if (!Array.isArray(ephem[k]) || ephem[k].length !== ephem.count) errors.push("invalid or wrong-length " + k);
      else {
        for (var i = 0; i < ephem[k].length; i++) {
          if (!isFiniteNumber(ephem[k][i])) { errors.push(k + " contains a non-finite value at index " + i); break; }
        }
      }
    });
    return errors;
  }

  function validateDaily(daily) {
    var errors = [];
    if (!daily || !Array.isArray(daily.dist) || !daily.dist.length) return ["daily.dist is missing"];
    daily.dist.forEach(function (d, i) {
      if (!isFiniteNumber(d.sunAu) || d.sunAu <= 0) errors.push("daily.dist[" + i + "].sunAu invalid");
      if (!isFiniteNumber(d.earthAu) || d.earthAu <= 0) errors.push("daily.dist[" + i + "].earthAu invalid");
    });
    return errors;
  }

  function sampleEphemeris(ephem, tMs) {
    var start = parseUtc(ephem.start);
    var stepMs = ephem.stepHours * 3600000;
    var x = (tMs - start) / stepMs;
    if (x < -EPS || x > ephem.count - 1 + EPS) return null;
    var i0 = clamp(Math.floor(x), 0, ephem.count - 1);
    var i1 = Math.min(i0 + 1, ephem.count - 1);
    var f = i0 === i1 ? 0 : x - i0;
    function lerpAngle(a, b, t) {
      return azNorm(a + wrap180(b - a) * t);
    }
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }
    return {
      tMs: tMs,
      sunAz: lerpAngle(ephem.sunAz[i0], ephem.sunAz[i1], f),
      sunEl: lerp(ephem.sunEl[i0], ephem.sunEl[i1], f),
      earthAz: lerpAngle(ephem.earthAz[i0], ephem.earthAz[i1], f),
      earthEl: lerp(ephem.earthEl[i0], ephem.earthEl[i1], f),
      index: i0,
      fraction: f,
    };
  }

  function dailyDistances(daily, ephem, tMs) {
    var start = parseUtc(ephem.start);
    var day = clamp(Math.floor((tMs - start) / 86400000), 0, daily.dist.length - 1);
    var d = daily.dist[day];
    return { sunKm: d.sunAu * AU_KM, earthKm: d.earthAu * AU_KM, day: day };
  }

  function geometryAtFromEphemeris(ephem, daily, tMs) {
    var s = sampleEphemeris(ephem, tMs);
    if (!s) return null;
    var d = dailyDistances(daily, ephem, tMs);
    return {
      sun: { az: s.sunAz, el: s.sunEl, distanceKm: d.sunKm, angularRadiusDeg: sunAngularRadiusDeg(d.sunKm) },
      earth: { az: s.earthAz, el: s.earthEl, distanceKm: d.earthKm, angularRadiusDeg: earthAngularRadiusDeg(d.earthKm) },
      sampledIndex: s.index,
    };
  }

  /**
   * Create a geometry provider. For a predefined site this interpolates the
   * supplied topocentric series. For a custom site it reconstructs the
   * Moon-fixed body position from a real reference site and re-projects it to
   * the custom observer. This is a coordinate transformation of measured
   * ephemeris data, not synthetic data. Its accuracy is validated in
   * validateFrameTransform().
   */
  function createGeometryProvider(opts) {
    var site = opts.site;
    var ephem = opts.ephem;
    var daily = opts.daily;
    var refSite = opts.referenceSite || null;
    var refEphem = opts.referenceEphem || null;
    var refDaily = opts.referenceDaily || null;
    var custom = !!opts.custom;

    if (!custom) {
      return function (tMs) {
        return geometryAtFromEphemeris(ephem, daily, tMs);
      };
    }
    if (!refSite || !refEphem || !refDaily) throw new Error("custom geometry requires reference ephemeris");
    var refErrors = validateEphemeris(refEphem).concat(validateDaily(refDaily));
    if (refErrors.length) throw new Error("reference data invalid: " + refErrors.join("; "));

    return function (tMs) {
      var ref = sampleEphemeris(refEphem, tMs);
      if (!ref) return null;
      var dist = dailyDistances(refDaily, refEphem, tMs);
      var sunPos = bodyPositionFromObservation(refSite, { az: ref.sunAz, el: ref.sunEl, distanceKm: dist.sunKm });
      var earthPos = bodyPositionFromObservation(refSite, { az: ref.earthAz, el: ref.earthEl, distanceKm: dist.earthKm });
      var sun = observationFromBodyPosition(site, sunPos);
      var earth = observationFromBodyPosition(site, earthPos);
      return {
        sun: {
          az: sun.az,
          el: sun.el,
          distanceKm: sun.distanceKm,
          angularRadiusDeg: sunAngularRadiusDeg(sun.distanceKm),
          derivedFrom: refSite.id,
        },
        earth: {
          az: earth.az,
          el: earth.el,
          distanceKm: earth.distanceKm,
          angularRadiusDeg: earthAngularRadiusDeg(earth.distanceKm),
          derivedFrom: refSite.id,
        },
        sampledIndex: ref.index,
      };
    };
  }

  /* ------------------------------------------------------------------ */
  /* Terrain horizons                                                    */
  /* ------------------------------------------------------------------ */

  function horizonAt(site, azDeg) {
    if (!site || !Array.isArray(site.horizonEl) || site.horizonEl.length !== 360) return null;
    var a = azNorm(azDeg);
    var i = Math.floor(a);
    var j = (i + 1) % 360;
    var t = a - i;
    return site.horizonEl[i] * (1 - t) + site.horizonEl[j] * t;
  }

  function latLonToXY(latDeg, lonDeg) {
    var rho = 2 * MOON_RADIUS_M * Math.tan(((90 + latDeg) / 2) * DEG);
    var lon = lonDeg * DEG;
    return { x: rho * Math.sin(lon), y: rho * Math.cos(lon) };
  }

  function xyToLatLon(x, y) {
    var rho = Math.hypot(x, y);
    var lat = 90 - 2 * Math.atan(rho / (2 * MOON_RADIUS_M)) * RAD;
    var lon = azNorm(Math.atan2(x, y) * RAD);
    return { lat: lat, lon: lon };
  }

  function demContains(meta, x, y) {
    if (!meta) return false;
    var x1 = meta.x0 + (meta.width - 1) * meta.pixelM;
    var y1 = meta.y0 - (meta.height - 1) * meta.pixelM;
    return x >= meta.x0 && x <= x1 && y >= y1 && y <= meta.y0;
  }

  /**
   * Compute a 360° horizon from a browser DEM grid.
   * `sample(x, y)` must return elevation in metres or NaN.
   */
  function computeTerrainHorizon(opts) {
    var sample = opts.sample;
    var x = opts.x;
    var y = opts.y;
    var z = opts.z;
    var lon = opts.lon;
    var naz = opts.azimuthSamples || 360;
    var maxM = opts.maxDistanceM || 9000;
    var stepM = opts.stepM || 10;
    var az = [];
    var horizonEl = [];
    var horizonDistM = [];
    var horizonZ = [];
    var coverage = [];
    var lastValidOverall = 0;
    var lam = lon * DEG;
    for (var k = 0; k < naz; k++) {
      var a = (k * 360) / naz;
      var e = Math.sin(a * DEG);
      var n = Math.cos(a * DEG);
      var dx = e * Math.cos(lam) - n * Math.sin(lam);
      var dy = -e * Math.sin(lam) - n * Math.cos(lam);
      var bestEl = -90;
      var bestD = NaN;
      var bestZ = NaN;
      var lastValid = 0;
      for (var d = stepM; d <= maxM + EPS; d += stepM) {
        var zz = sample(x + d * dx, y + d * dy);
        if (!isFinite(zz)) continue;
        lastValid = d;
        var drop = (d * d) / (2 * MOON_RADIUS_M);
        var el = Math.atan2(zz - z - drop, d) * RAD;
        if (el > bestEl) {
          bestEl = el;
          bestD = d;
          bestZ = zz;
        }
      }
      az.push(a);
      horizonEl.push(bestEl);
      horizonDistM.push(bestD);
      horizonZ.push(bestZ);
      coverage.push(lastValid);
      if (lastValid > lastValidOverall) lastValidOverall = lastValid;
    }
    var complete = coverage.every(function (d) { return d >= maxM * 0.98; });
    return {
      azimuthDeg: az,
      horizonEl: horizonEl,
      horizonDistM: horizonDistM,
      horizonZ: horizonZ,
      coverageM: coverage,
      partial: !complete,
      maxDistanceM: maxM,
      stepM: stepM,
      azimuthSamples: naz,
      lastValidOverallM: lastValidOverall,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Visibility classification                                           */
  /* ------------------------------------------------------------------ */

  function classifyBody(body, horizonEl) {
    var geom = body.el + body.angularRadiusDeg > 0;
    var terrainAvailable = isFiniteNumber(horizonEl);
    var terrainVisible = terrainAvailable ? body.el + body.angularRadiusDeg > horizonEl : null;
    var state;
    if (!geom) state = "below";
    else if (!terrainAvailable) state = "geometric";
    else state = terrainVisible ? "visible" : "obstructed";
    return {
      state: state,
      geometric: geom,
      terrainAvailable: terrainAvailable,
      terrainVisible: terrainVisible,
      blockedByTerrain: geom && terrainAvailable && !terrainVisible,
      horizonEl: terrainAvailable ? horizonEl : null,
      clearanceDeg: terrainAvailable ? body.el + body.angularRadiusDeg - horizonEl : null,
    };
  }

  function bodyState(body, horizon) {
    var h = horizon && horizon.available ? horizon.at(body.az) : null;
    return Object.assign({}, body, classifyBody(body, h));
  }

  /* ------------------------------------------------------------------ */
  /* Interval detection and metrics                                      */
  /* ------------------------------------------------------------------ */

  function refineCrossing(t0, t1, predicate, iterations) {
    var lo = t0;
    var hi = t1;
    var flo = !!predicate(lo);
    var fhi = !!predicate(hi);
    if (flo === fhi) return (t0 + t1) / 2;
    for (var i = 0; i < (iterations || 14); i++) {
      var mid = (lo + hi) / 2;
      if (!!predicate(mid) === flo) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function booleanIntervals(times, flags, flagAt, windowStart, windowEnd) {
    var out = [];
    var open = null;
    for (var i = 0; i < times.length - 1; i++) {
      var f0 = flags[i];
      var f1 = flags[i + 1];
      if (f0 && !f1) {
        var end = refineCrossing(times[i], times[i + 1], flagAt);
        out.push({ startMs: open === null ? times[0] : open, endMs: end });
        open = null;
      } else if (!f0 && f1) {
        open = refineCrossing(times[i], times[i + 1], flagAt);
      } else if (f0 && f1 && open === null) {
        open = times[i];
      }
    }
    if (open !== null) out.push({ startMs: open, endMs: windowEnd });
    if (!out.length && flags[0]) out.push({ startMs: windowStart, endMs: windowEnd });
    return out.map(function (r) {
      var a = Math.max(windowStart, r.startMs);
      var b = Math.min(windowEnd, r.endMs);
      return {
        startMs: a,
        endMs: b,
        durationH: Math.max(0, hoursBetween(a, b)),
        edgeStart: Math.abs(a - windowStart) < 1,
        edgeEnd: Math.abs(b - windowEnd) < 1,
      };
    }).filter(function (r) { return r.durationH > 1e-6; });
  }

  function complementIntervals(intervals, windowStart, windowEnd) {
    var sorted = intervals.slice().sort(function (a, b) { return a.startMs - b.startMs; });
    var gaps = [];
    var cursor = windowStart;
    sorted.forEach(function (r) {
      if (r.startMs > cursor + 1) gaps.push({ startMs: cursor, endMs: r.startMs });
      cursor = Math.max(cursor, r.endMs);
    });
    if (cursor < windowEnd - 1) gaps.push({ startMs: cursor, endMs: windowEnd });
    return gaps.map(function (g) {
      return {
        startMs: g.startMs,
        endMs: g.endMs,
        durationH: hoursBetween(g.startMs, g.endMs),
        edgeStart: Math.abs(g.startMs - windowStart) < 1,
        edgeEnd: Math.abs(g.endMs - windowEnd) < 1,
      };
    });
  }

  function longestInterior(gaps) {
    var best = null;
    gaps.forEach(function (g) {
      if (g.edgeStart || g.edgeEnd) return;
      if (!best || g.durationH > best.durationH) best = g;
    });
    return best;
  }

  function nextTransition(intervals, fromMs, body, windowEnd) {
    for (var i = 0; i < intervals.length; i++) {
      var r = intervals[i];
      if (r.startMs > fromMs + 1) return { type: "rise", body: body, tMs: r.startMs };
      if (r.endMs > fromMs + 1) {
        if (windowEnd && Math.abs(r.endMs - windowEnd) < 1) return null;
        return { type: "set", body: body, tMs: r.endMs };
      }
    }
    return null;
  }

  function makeHorizonAdapter(site, customHorizon) {
    if (customHorizon && customHorizon.horizonEl) {
      return {
        available: true,
        source: customHorizon.source || "computed",
        resolutionM: customHorizon.resolutionM || null,
        partial: !!customHorizon.partial,
        at: function (az) {
          var a = azNorm(az);
          var i = Math.floor(a) % customHorizon.horizonEl.length;
          var j = (i + 1) % customHorizon.horizonEl.length;
          var t = a - Math.floor(a);
          return customHorizon.horizonEl[i] * (1 - t) + customHorizon.horizonEl[j] * t;
        },
        arrays: customHorizon,
      };
    }
    if (site && Array.isArray(site.horizonEl) && site.horizonEl.length === 360) {
      return {
        available: true,
        source: "precomputed 5 m LOLA DEM",
        resolutionM: 5,
        partial: false,
        at: function (az) { return horizonAt(site, az); },
        arrays: { horizonEl: site.horizonEl, horizonDistM: site.horizonDistM, horizonZ: site.horizonZ, azimuthDeg: site.horizonAz },
      };
    }
    return {
      available: false,
      source: "unavailable",
      resolutionM: null,
      partial: false,
      at: function () { return null; },
      arrays: null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Power and link budget                                               */
  /* ------------------------------------------------------------------ */

  function solarIrradiance(distanceKm) {
    var au = distanceKm / AU_KM;
    return SOLAR_CONSTANT_W_M2 / (au * au);
  }

  function incidenceCosine(sunAz, sunEl, tiltDeg, panelAzDeg) {
    var el = sunEl * DEG;
    var tilt = tiltDeg * DEG;
    // Fixed panel normal = cos(tilt)*up + sin(tilt)*horizontal(panelAz).
    // dot with the Sun unit vector gives the cosine of the incidence angle.
    return Math.cos(el) * Math.sin(tilt) * Math.cos((sunAz - panelAzDeg) * DEG) + Math.sin(el) * Math.cos(tilt);
  }

  function computePowerAt(sun, params, terrainBasis) {
    if (!params || !params.enabled) return { available: false };
    var cosInc = incidenceCosine(sun.az, sun.el, params.panelTiltDeg || 0, params.panelAzDeg || 0);
    var lit;
    if (terrainBasis === "terrain") lit = !!sun.terrainVisible;
    else lit = !!sun.geometric;
    var irradiance = solarIrradiance(sun.distanceKm);
    var direct = lit ? irradiance : 0;
    var incident = direct * Math.max(0, cosInc);
    var electrical = incident
      * (params.areaM2 || 0)
      * ((params.efficiencyPct || 0) / 100)
      * ((params.packingPct == null ? 100 : params.packingPct) / 100)
      * (1 - (params.lossesPct || 0) / 100);
    return {
      available: true,
      lit: lit,
      cosIncidence: cosInc,
      irradianceWm2: irradiance,
      incidentWm2: incident,
      powerW: Math.max(0, electrical),
      terrainBasis: terrainBasis,
    };
  }

  function integratePower(times, powerW, params) {
    if (!params || !params.enabled) return null;
    var capacityWh = (params.batteryWh || 0);
    var load = params.loadW || 0;
    var totalWh = 0;
    for (var j = 0; j < times.length - 1; j++) {
      totalWh += (((powerW[j] || 0) + (powerW[j + 1] || 0)) / 2) * hoursBetween(times[j], times[j + 1]);
    }
    if (!(capacityWh > 0)) {
      return {
        available: true,
        batteryAvailable: false,
        totalEnergyWh: totalWh,
        peakPowerW: Math.max.apply(null, powerW),
        minChargeWh: null,
        maxChargeWh: null,
        finalChargeWh: null,
        capacityWh: 0,
        depleted: null,
        series: [],
        note: "لم تُحدَّد سعة بطارية؛ حساب عمر البطارية غير متاح. الطاقة المقدّرة هي طاقة كهربائية نظرية فقط.",
      };
    }
    var charge = capacityWh * ((params.initialPct == null ? 100 : params.initialPct) / 100);
    var minCharge = charge;
    var depleted = false;
    var maxCharge = charge;
    var series = [{ tMs: times[0], chargeWh: charge, powerW: powerW[0] || 0 }];
    for (var i = 0; i < times.length - 1; i++) {
      var dtH = hoursBetween(times[i], times[i + 1]);
      var p = ((powerW[i] || 0) + (powerW[i + 1] || 0)) / 2;
      charge += (p - load) * dtH;
      if (charge < 0) { charge = 0; depleted = true; }
      if (charge > capacityWh) charge = capacityWh;
      minCharge = Math.min(minCharge, charge);
      maxCharge = Math.max(maxCharge, charge);
      series.push({ tMs: times[i + 1], chargeWh: charge, powerW: powerW[i + 1] || 0 });
    }
    return {
      available: true,
      batteryAvailable: true,
      totalEnergyWh: totalWh,
      peakPowerW: Math.max.apply(null, powerW),
      minChargeWh: minCharge,
      maxChargeWh: maxCharge,
      finalChargeWh: charge,
      capacityWh: capacityWh,
      depleted: depleted,
      series: series,
    };
  }

  function fsplDb(distanceKm, frequencyMHz) {
    if (!(distanceKm > 0) || !(frequencyMHz > 0)) return NaN;
    return 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMHz) + 32.44778;
  }

  function linkBudget(p) {
    var txDbm = 10 * Math.log10((p.txPowerW || 0) * 1000);
    var fspl = fsplDb(p.distanceKm, p.frequencyMHz);
    var pointingLoss = p.pointingLossDb || 0;
    var rxDbm = txDbm + (p.gtxDbi || 0) + (p.grxDbi || 0) - fspl - (p.lossesDb || 0) - pointingLoss;
    var margin = rxDbm - (p.thresholdDbm == null ? -160 : p.thresholdDbm);
    return {
      txDbm: txDbm,
      fsplDb: fspl,
      pointingLossDb: pointingLoss,
      rxDbm: rxDbm,
      marginDb: margin,
      feasible: margin >= 0,
      assumedThresholdDbm: p.thresholdDbm == null ? -160 : p.thresholdDbm,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Simulation builder                                                  */
  /* ------------------------------------------------------------------ */

  function sampleTimes(startMs, durationHours, stepMinutes) {
    var stepMs = stepMinutes * 60000;
    var endMs = startMs + durationHours * 3600000;
    var out = [];
    for (var t = startMs; t < endMs - 1; t += stepMs) out.push(t);
    out.push(endMs);
    return out;
  }

  function buildSimulation(opts) {
    var site = opts.site;
    var startMs = opts.startMs;
    var durationHours = opts.durationHours;
    var stepMinutes = opts.stepMinutes;
    var geometryAt = opts.geometryAt;
    var horizon = makeHorizonAdapter(site, opts.customHorizon);
    var powerParams = opts.powerParams || null;
    var windowEnd = startMs + durationHours * 3600000;
    var times = sampleTimes(startMs, durationHours, stepMinutes);
    var samples = [];
    var powerValues = [];
    // The lighting basis for power is user-selectable, but a terrain basis
    // cannot be honoured when no terrain horizon exists. In that case the
    // calculation falls back to geometric visibility and says so.
    var terrainBasis;
    if (opts.powerBasis === "geometric") terrainBasis = "geometric";
    else if (opts.powerBasis === "terrain") terrainBasis = horizon.available ? "terrain" : "geometric";
    else terrainBasis = horizon.available ? "terrain" : "geometric";

    for (var i = 0; i < times.length; i++) {
      var g = geometryAt(times[i]);
      // A simulation may legitimately end exactly at the last source
      // timestamp. There is no sample beyond it, so evaluate the final
      // boundary one millisecond earlier instead of inventing data.
      if (!g && i === times.length - 1 && Math.abs(times[i] - windowEnd) < 1) {
        g = geometryAt(times[i] - 1);
      }
      if (!g) throw new Error("ephemeris does not cover " + isoUtc(times[i]));
      var sun = bodyState(g.sun, horizon);
      var earth = bodyState(g.earth, horizon);
      var power = powerParams && powerParams.enabled
        ? computePowerAt(sun, powerParams, terrainBasis)
        : null;
      samples.push({ tMs: times[i], sun: sun, earth: earth, power: power });
      powerValues.push(power && power.available ? power.powerW : NaN);
    }

    function flagAtFactory(key) {
      return function (t) {
        var g = geometryAt(t);
        if (!g) return false;
        var sun = bodyState(g.sun, horizon);
        var earth = bodyState(g.earth, horizon);
        if (key === "sunGeom") return !!sun.geometric;
        if (key === "sunTerrain") return !!sun.terrainVisible;
        if (key === "earthGeom") return !!earth.geometric;
        if (key === "earthTerrain") return !!earth.terrainVisible;
        if (key === "overlap") {
          if (horizon.available) return !!(sun.terrainVisible && earth.terrainVisible);
          return !!(sun.geometric && earth.geometric);
        }
        if (key === "power") {
          var p = computePowerAt(sun, powerParams, terrainBasis);
          return !!(p.available && p.powerW > 0);
        }
        return false;
      };
    }

    function flagsFor(key, fn) {
      return samples.map(function (s) {
        if (key === "sunGeom") return !!s.sun.geometric;
        if (key === "sunTerrain") return !!s.sun.terrainVisible;
        if (key === "earthGeom") return !!s.earth.geometric;
        if (key === "earthTerrain") return !!s.earth.terrainVisible;
        if (key === "overlap") {
          if (horizon.available) return !!(s.sun.terrainVisible && s.earth.terrainVisible);
          return !!(s.sun.geometric && s.earth.geometric);
        }
        if (key === "power") return !!(s.power && s.power.available && s.power.powerW > 0);
        return false;
      });
    }

    function intervalsFor(key, available) {
      if (!available) return null;
      return booleanIntervals(times, flagsFor(key), flagAtFactory(key), startMs, windowEnd);
    }

    var terrainAvailable = horizon.available;
    var sunGeom = intervalsFor("sunGeom", true);
    var sunTerrain = intervalsFor("sunTerrain", terrainAvailable);
    var earthGeom = intervalsFor("earthGeom", true);
    var earthTerrain = intervalsFor("earthTerrain", terrainAvailable);
    var overlap = intervalsFor("overlap", true);
    var powerOn = powerParams && powerParams.enabled ? intervalsFor("power", true) : null;

    function intervalStats(intervals, available) {
      if (!available || intervals === null) {
        return { available: false, intervals: [], totalH: null, pct: null, longestBlackoutH: null, blackoutCount: null, count: null, edgeLimited: false, edgeBlackoutH: null };
      }
      var totalH = sum(intervals.map(function (r) { return r.durationH; }));
      var gaps = complementIntervals(intervals, startMs, windowEnd);
      var longest = longestInterior(gaps);
      var interiorGaps = gaps.filter(function (g) { return !g.edgeStart && !g.edgeEnd; });
      var edgeGaps = gaps.filter(function (g) { return g.edgeStart || g.edgeEnd; });
      var longestEdge = edgeGaps.length ? edgeGaps.reduce(function (a, b) { return b.durationH > a.durationH ? b : a; }) : null;
      return {
        available: true,
        intervals: intervals,
        totalH: totalH,
        pct: durationHours > 0 ? (totalH / durationHours) * 100 : 0,
        longestBlackoutH: longest ? longest.durationH : (interiorGaps.length === 0 && edgeGaps.length > 0 ? null : 0),
        longestBlackout: longest,
        edgeLimited: !longest && edgeGaps.length > 0,
        edgeBlackoutH: longestEdge ? longestEdge.durationH : null,
        blackoutCount: interiorGaps.length,
        count: intervals.length,
      };
    }

    var sunStats = intervalStats(sunTerrain, terrainAvailable);
    var earthStats = intervalStats(earthTerrain, terrainAvailable);
    var sunGeomStats = intervalStats(sunGeom, true);
    var earthGeomStats = intervalStats(earthGeom, true);
    var overlapStats = intervalStats(overlap, true);

    var selectedPower = powerParams && powerParams.enabled
      ? integratePower(times, powerValues, powerParams)
      : null;

    var metrics = {
      durationH: durationHours,
      stepMinutes: stepMinutes,
      terrainAvailable: terrainAvailable,
      terrainBasis: terrainBasis,
      sun: {
        geometric: { totalH: sunGeomStats.totalH, pct: sunGeomStats.pct, count: sunGeomStats.count, intervals: sunGeom },
        terrain: terrainAvailable ? { totalH: sunStats.totalH, pct: sunStats.pct, count: sunStats.count, intervals: sunTerrain } : null,
        visibilityH: terrainAvailable ? sunStats.totalH : sunGeomStats.totalH,
        visibilityPct: terrainAvailable ? sunStats.pct : sunGeomStats.pct,
        longestBlackoutH: terrainAvailable ? sunStats.longestBlackoutH : sunGeomStats.longestBlackoutH,
        longestBlackoutEdgeLimited: terrainAvailable ? sunStats.edgeLimited : sunGeomStats.edgeLimited,
        edgeBlackoutH: terrainAvailable ? sunStats.edgeBlackoutH : sunGeomStats.edgeBlackoutH,
        blackoutCount: terrainAvailable ? sunStats.blackoutCount : sunGeomStats.blackoutCount,
        blackoutBasis: terrainAvailable ? "terrain" : "geometric",
      },
      earth: {
        geometric: { totalH: earthGeomStats.totalH, pct: earthGeomStats.pct, count: earthGeomStats.count, intervals: earthGeom },
        terrain: terrainAvailable ? { totalH: earthStats.totalH, pct: earthStats.pct, count: earthStats.count, intervals: earthTerrain } : null,
        visibilityH: terrainAvailable ? earthStats.totalH : earthGeomStats.totalH,
        visibilityPct: terrainAvailable ? earthStats.pct : earthGeomStats.pct,
        longestBlackoutH: terrainAvailable ? earthStats.longestBlackoutH : earthGeomStats.longestBlackoutH,
        longestBlackoutEdgeLimited: terrainAvailable ? earthStats.edgeLimited : earthGeomStats.edgeLimited,
        edgeBlackoutH: terrainAvailable ? earthStats.edgeBlackoutH : earthGeomStats.edgeBlackoutH,
        blackoutCount: terrainAvailable ? earthStats.blackoutCount : earthGeomStats.blackoutCount,
        blackoutBasis: terrainAvailable ? "terrain" : "geometric",
      },
      overlap: {
        totalH: overlapStats.totalH,
        pct: overlapStats.pct,
        basis: terrainAvailable ? "terrain" : "geometric",
        intervals: overlap,
      },
      power: selectedPower,
      dataCompleteness: opts.dataCompleteness == null ? 1 : opts.dataCompleteness,
    };

    var tracks = {
      sunGeom: { available: true, intervals: sunGeom },
      sunTerrain: { available: terrainAvailable, intervals: sunTerrain },
      earthGeom: { available: true, intervals: earthGeom },
      earthTerrain: { available: terrainAvailable, intervals: earthTerrain },
      overlap: { available: true, intervals: overlap },
      power: { available: !!powerParams && powerParams.enabled, intervals: powerOn },
    };

    var selectedMs = opts.selectedMs == null ? startMs : clamp(opts.selectedMs, startMs, windowEnd);
    var nextSun = nextTransition(tracks.sunTerrain.available ? sunTerrain : sunGeom, selectedMs, "sun", windowEnd);
    var nextEarth = nextTransition(tracks.earthTerrain.available ? earthTerrain : earthGeom, selectedMs, "earth", windowEnd);
    var next = null;
    if (nextSun && nextEarth) next = nextSun.tMs <= nextEarth.tMs ? nextSun : nextEarth;
    else next = nextSun || nextEarth;

    var warnings = [];
    if (!terrainAvailable) warnings.push("لا يوجد DEM موثّق لهذا الموقع: نتائج التضاريس غير متاحة، والتصنيف المعروض هندسي فقط.");
    if (horizon.partial) warnings.push("تغطية DEM جزئية: بعض اتجاهات الأفق قد تكون مبتورة عند حافة النافذة.");
    if (opts.custom && opts.derivedFrom) warnings.push("الهندسة السماوية مشتقة من سلسلة JPL Horizons لموقع مرجعي عبر تحويل إطار مُتحقَّق منه، لا من ملفات فلكية خاصة بالموقع المخصص.");
    if (opts.synthetic) warnings.push("هذه النتائج تستخدم بيانات عرض اصطناعية موسومة، وليست قياسات قمرية حقيقية.");

    return {
      version: VERSION,
      site: site,
      startMs: startMs,
      endMs: windowEnd,
      durationHours: durationHours,
      stepMinutes: stepMinutes,
      times: times,
      samples: samples,
      horizon: horizon,
      metrics: metrics,
      tracks: tracks,
      next: next,
      selectedMs: selectedMs,
      warnings: warnings,
      provenance: opts.provenance || {},
    };
  }

  function sampleAt(sim, tMs) {
    if (!sim || !sim.samples.length) return null;
    var stepMs = sim.stepMinutes * 60000;
    var i = clamp(Math.round((tMs - sim.startMs) / stepMs), 0, sim.samples.length - 1);
    return sim.samples[i];
  }

  function nearestSampleIndex(sim, tMs) {
    if (!sim || !sim.samples.length) return 0;
    var stepMs = sim.stepMinutes * 60000;
    return clamp(Math.round((tMs - sim.startMs) / stepMs), 0, sim.samples.length - 1);
  }

  /* ------------------------------------------------------------------ */
  /* Comparison and scoring                                              */
  /* ------------------------------------------------------------------ */

  function compareMetrics(a, b) {
    function d(x, y) {
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { a: x, b: y, delta: null, pct: null };
      var delta = y - x;
      return { a: x, b: y, delta: delta, pct: Math.abs(x) > 1e-9 ? (delta / x) * 100 : null };
    }
    return {
      sunPct: d(a.sun.visibilityPct, b.sun.visibilityPct),
      sunH: d(a.sun.visibilityH, b.sun.visibilityH),
      sunBlackout: d(a.sun.longestBlackoutH, b.sun.longestBlackoutH),
      earthPct: d(a.earth.visibilityPct, b.earth.visibilityPct),
      earthH: d(a.earth.visibilityH, b.earth.visibilityH),
      earthBlackout: d(a.earth.longestBlackoutH, b.earth.longestBlackoutH),
      overlapPct: d(a.overlap.pct, b.overlap.pct),
      overlapH: d(a.overlap.totalH, b.overlap.totalH),
      powerWh: d(a.power ? a.power.totalEnergyWh : null, b.power ? b.power.totalEnergyWh : null),
    };
  }

  function explainComparison(c) {
    var notes = [];
    function add(key, label, unit, better) {
      var r = c[key];
      if (!r || !isFiniteNumber(r.delta)) return;
      if (Math.abs(r.delta) < 1e-6) {
        notes.push({ key: key, tone: "neutral", text: label + ": لا تغيير جوهري." });
        return;
      }
      var direction = r.delta > 0 ? "أعلى" : "أقل";
      var pct = isFiniteNumber(r.pct) ? " (" + (r.pct > 0 ? "+" : "") + round(r.pct, 1) + "%)" : "";
      notes.push({
        key: key,
        tone: better === "higher" ? (r.delta > 0 ? "good" : "bad") : better === "lower" ? (r.delta < 0 ? "good" : "bad") : "neutral",
        text: label + ": " + direction + " بمقدار " + round(Math.abs(r.delta), 2) + " " + unit + pct + ".",
      });
    }
    add("sunH", "ساعات الشمس المتاحة", "ساعة", "higher");
    add("sunBlackout", "أطول انقطاع شمسي", "ساعة", "lower");
    add("earthH", "ساعات رؤية الأرض", "ساعة", "higher");
    add("earthBlackout", "أطول انقطاع أرضي", "ساعة", "lower");
    add("overlapH", "تداخل الشمس ورؤية الأرض", "ساعة", "higher");
    add("powerWh", "الطاقة الكهربائية المقدّرة", "Wh", "higher");
    return notes;
  }

  var SCORE_PROFILES = {
    power: {
      label: "مهمة تركّز على الطاقة",
      weights: { sunPct: 0.32, sunBlackout: 0.20, overlapPct: 0.10, earthPct: 0.08, earthBlackout: 0.06, slope: 0.10, completeness: 0.14 },
    },
    comm: {
      label: "مهمة تركّز على الاتصال",
      weights: { sunPct: 0.10, sunBlackout: 0.08, overlapPct: 0.12, earthPct: 0.28, earthBlackout: 0.22, slope: 0.06, completeness: 0.14 },
    },
    balanced: {
      label: "مهمة متوازنة",
      weights: { sunPct: 0.20, sunBlackout: 0.15, overlapPct: 0.12, earthPct: 0.20, earthBlackout: 0.15, slope: 0.08, completeness: 0.10 },
    },
  };

  function scoreSites(entries, profileName) {
    var profile = SCORE_PROFILES[profileName] || SCORE_PROFILES.balanced;
    var criteria = [
      { key: "sunPct", label: "نسبة الشمس المتاحة", get: function (e) { return e.metrics.sun.visibilityPct; }, better: "higher", unit: "%" },
      { key: "sunBlackout", label: "أطول انقطاع شمسي", get: function (e) { return e.metrics.sun.longestBlackoutH; }, better: "lower", unit: "h" },
      { key: "earthPct", label: "نسبة رؤية الأرض", get: function (e) { return e.metrics.earth.visibilityPct; }, better: "higher", unit: "%" },
      { key: "earthBlackout", label: "أطول انقطاع أرضي", get: function (e) { return e.metrics.earth.longestBlackoutH; }, better: "lower", unit: "h" },
      { key: "overlapPct", label: "تداخل الشمس ورؤية الأرض", get: function (e) { return e.metrics.overlap.pct; }, better: "higher", unit: "%" },
      { key: "slope", label: "الميل الموضعي", get: function (e) { return e.site && isFiniteNumber(e.site.slopeDeg) ? e.site.slopeDeg : null; }, better: "lower", unit: "°" },
      { key: "completeness", label: "اكتمال البيانات", get: function (e) { return e.completeness; }, better: "higher", unit: "" },
    ];
    var excluded = [];
    var active = criteria.filter(function (c) {
      var vals = entries.map(c.get);
      var ok = vals.every(function (v) { return isFiniteNumber(v); });
      if (!ok) excluded.push({ key: c.key, label: c.label, reason: "بيانات ناقصة لبعض المواقع" });
      return ok;
    });
    var weightSum = active.reduce(function (s, c) { return s + (profile.weights[c.key] || 0); }, 0);
    if (weightSum <= 0) weightSum = 1;
    var ranges = {};
    active.forEach(function (c) {
      var vals = entries.map(c.get);
      ranges[c.key] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
    });
    var results = entries.map(function (e) {
      var contributions = [];
      var score = 0;
      active.forEach(function (c) {
        var v = c.get(e);
        var r = ranges[c.key];
        var norm = r.max - r.min < 1e-9 ? 0.5 : (v - r.min) / (r.max - r.min);
        if (c.better === "lower") norm = 1 - norm;
        var w = (profile.weights[c.key] || 0) / weightSum;
        score += norm * w;
        contributions.push({ key: c.key, label: c.label, value: v, unit: c.unit, normalized: norm, weight: w, points: norm * w * 100 });
      });
      return {
        siteId: e.site.id,
        siteName: e.site.shortAr || e.site.nameAr,
        score: score * 100,
        contributions: contributions,
        completeness: e.completeness,
        terrainAvailable: e.metrics.terrainAvailable,
        metrics: e.metrics,
      };
    });
    return {
      profile: profileName,
      profileLabel: profile.label,
      weights: profile.weights,
      weightSum: weightSum,
      criteria: active.map(function (c) { return { key: c.key, label: c.label, better: c.better, unit: c.unit, range: ranges[c.key], weight: (profile.weights[c.key] || 0) / weightSum }; }),
      excluded: excluded,
      results: results,
      note: "درجة نسبية داخل مجموعة المواقع المختارة فقط. ليست توصية رسمية من ناسا ولا حكمًا مطلقًا على أي موقع.",
    };
  }

  /* ------------------------------------------------------------------ */
  /* Validation and adapters                                             */
  /* ------------------------------------------------------------------ */

  function validateSite(site) {
    var errors = [];
    if (!site || typeof site !== "object") return ["site is not an object"];
    if (!site.id) errors.push("site.id missing");
    if (!isFiniteNumber(site.lat) || site.lat < -90 || site.lat > 90) errors.push("site.lat invalid");
    if (!isFiniteNumber(site.lon)) errors.push("site.lon invalid");
    if (site.horizonEl && (!Array.isArray(site.horizonEl) || site.horizonEl.length !== 360)) errors.push("site.horizonEl must have 360 bins");
    return errors;
  }

  function validateScenario(s) {
    var errors = [];
    if (!s) return ["scenario missing"];
    if (!s.site) errors.push("site missing");
    if (!isFiniteNumber(s.startMs)) errors.push("start time invalid");
    if (!isFiniteNumber(s.durationHours) || s.durationHours <= 0) errors.push("duration must be positive");
    if (!isFiniteNumber(s.stepMinutes) || s.stepMinutes <= 0) errors.push("step must be positive");
    if (isFiniteNumber(s.startMs)) {
      var end = s.startMs + s.durationHours * 3600000;
      if (s.startMs < DATA_START_MS || end > DATA_END_MS + 1) errors.push("scenario is outside the supplied 2026-11-01 → 2027-11-01 UTC data window");
    }
    return errors;
  }

  function validateFrameTransform(refSite, refEphem, refDaily, targetSite, targetEphem, indices) {
    var idx = indices || [];
    if (!idx.length) {
      for (var k = 0; k < 60; k++) idx.push(Math.floor((k * (refEphem.count - 1)) / 59));
    }
    var start = parseUtc(refEphem.start);
    var stepMs = refEphem.stepHours * 3600000;
    var maxAz = 0;
    var maxEl = 0;
    idx.forEach(function (i) {
      var t = start + i * stepMs;
      var ref = geometryAtFromEphemeris(refEphem, refDaily, t);
      var target = geometryAtFromEphemeris(targetEphem, refDaily, t);
      ["sun", "earth"].forEach(function (body) {
        var pos = bodyPositionFromObservation(refSite, ref[body]);
        var obs = observationFromBodyPosition(targetSite, pos);
        var dAz = Math.abs(wrap180(obs.az - target[body].az));
        var dEl = Math.abs(obs.el - target[body].el);
        if (dAz > maxAz) maxAz = dAz;
        if (dEl > maxEl) maxEl = dEl;
      });
    });
    return { maxAzErrorDeg: maxAz, maxElErrorDeg: maxEl, samples: idx.length, body: "Sun and Earth" };
  }

  function validateSitesDocument(doc) {
    var errors = [];
    if (!doc || !Array.isArray(doc.sites)) return ["sites.json must contain a sites array"];
    var ids = {};
    doc.sites.forEach(function (s) {
      validateSite(s).forEach(function (e) { errors.push((s.id || "?") + ": " + e); });
      if (ids[s.id]) errors.push("duplicate site id " + s.id);
      ids[s.id] = true;
    });
    return errors;
  }

  function parseCsvEphemeris(text, options) {
    var opts = options || {};
    var lines = String(text || "").replace(/\r/g, "").split("\n").filter(function (l) { return l.trim() && l.trim()[0] !== "#"; });
    if (!lines.length) throw new Error("CSV is empty");
    var header = lines[0].split(",").map(function (h) { return h.trim().toLowerCase(); });
    function col(name, fallback) {
      var i = header.indexOf(name);
      return i >= 0 ? i : fallback;
    }
    var ci = {
      time: col("timestamp", col("time", 0)),
      target: col("target", col("body", 1)),
      az: col("azimuth_deg", col("azimuth", col("az", 2))),
      el: col("elevation_deg", col("elevation", col("el", 3))),
      dist: col("distance_km", col("distance", 4)),
    };
    var rows = [];
    for (var n = 1; n < lines.length; n++) {
      var p = lines[n].split(",");
      var target = String(p[ci.target] || "").trim().toLowerCase();
      if (target !== "sun" && target !== "earth") throw new Error("CSV row " + (n + 1) + ": target must be sun or earth");
      var t = parseUtc(p[ci.time]);
      var az = Number(p[ci.az]);
      var el = Number(p[ci.el]);
      var distance = Number(p[ci.dist]);
      if (!isFinite(t)) throw new Error("CSV row " + (n + 1) + ": invalid UTC timestamp");
      if (!isFinite(az) || az < 0 || az >= 360) throw new Error("CSV row " + (n + 1) + ": azimuth must be [0,360)");
      if (!isFinite(el) || el < -90 || el > 90) throw new Error("CSV row " + (n + 1) + ": elevation must be [-90,90]");
      if (!isFinite(distance) || distance <= 0) throw new Error("CSV row " + (n + 1) + ": distance must be positive");
      rows.push({ tMs: t, target: target, az: az, el: el, distanceKm: distance });
    }
    var sun = rows.filter(function (r) { return r.target === "sun"; }).sort(function (a, b) { return a.tMs - b.tMs; });
    var earth = rows.filter(function (r) { return r.target === "earth"; }).sort(function (a, b) { return a.tMs - b.tMs; });
    if (sun.length < 2 || earth.length < 2) throw new Error("CSV needs at least two Sun rows and two Earth rows");
    if (opts.requireEqualTimes !== false) {
      var n2 = Math.min(sun.length, earth.length);
      for (var k = 0; k < n2; k++) {
        if (sun[k].tMs !== earth[k].tMs) throw new Error("CSV Sun and Earth timestamps must align; mismatch at row " + (k + 1));
      }
    }
    return {
      siteId: opts.siteId || "custom",
      start: isoUtc(sun[0].tMs),
      stepHours: (sun[1].tMs - sun[0].tMs) / 3600000,
      count: sun.length,
      sunAz: sun.map(function (r) { return r.az; }),
      sunEl: sun.map(function (r) { return r.el; }),
      earthAz: earth.map(function (r) { return r.az; }),
      earthEl: earth.map(function (r) { return r.el; }),
      distancesKm: {
        sun: sun.map(function (r) { return r.distanceKm; }),
        earth: earth.map(function (r) { return r.distanceKm; }),
      },
      source: opts.source || "user-provided CSV",
    };
  }

  function fromEphemerisJson(json, options) {
    var opts = options || {};
    var errors = validateEphemeris(json);
    if (errors.length) throw new Error("Invalid ephemeris JSON: " + errors.join("; "));
    return Object.assign({}, json, { siteId: json.id || opts.siteId || "custom", source: opts.source || "user-provided JSON" });
  }

  return {
    VERSION: VERSION,
    MOON_RADIUS_KM: MOON_RADIUS_KM,
    MOON_RADIUS_M: MOON_RADIUS_M,
    SUN_RADIUS_KM: SUN_RADIUS_KM,
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    AU_KM: AU_KM,
    SOLAR_CONSTANT_W_M2: SOLAR_CONSTANT_W_M2,
    DATA_START_MS: DATA_START_MS,
    DATA_END_MS: DATA_END_MS,
    SCORE_PROFILES: SCORE_PROFILES,
    clamp: clamp,
    azNorm: azNorm,
    wrap180: wrap180,
    parseUtc: parseUtc,
    isoUtc: isoUtc,
    isoMinuteUtc: isoMinuteUtc,
    isoDateUtc: isoDateUtc,
    timeLabel: timeLabel,
    round: round,
    hoursBetween: hoursBetween,
    enuBasis: enuBasis,
    moonPosition: moonPosition,
    directionVector: directionVector,
    vectorToAzEl: vectorToAzEl,
    bodyPositionFromObservation: bodyPositionFromObservation,
    observationFromBodyPosition: observationFromBodyPosition,
    angularRadiusDeg: angularRadiusDeg,
    sunAngularRadiusDeg: sunAngularRadiusDeg,
    earthAngularRadiusDeg: earthAngularRadiusDeg,
    validateEphemeris: validateEphemeris,
    validateDaily: validateDaily,
    validateSite: validateSite,
    validateSitesDocument: validateSitesDocument,
    validateScenario: validateScenario,
    validateFrameTransform: validateFrameTransform,
    sampleEphemeris: sampleEphemeris,
    dailyDistances: dailyDistances,
    geometryAtFromEphemeris: geometryAtFromEphemeris,
    createGeometryProvider: createGeometryProvider,
    horizonAt: horizonAt,
    latLonToXY: latLonToXY,
    xyToLatLon: xyToLatLon,
    demContains: demContains,
    computeTerrainHorizon: computeTerrainHorizon,
    classifyBody: classifyBody,
    bodyState: bodyState,
    booleanIntervals: booleanIntervals,
    complementIntervals: complementIntervals,
    refineCrossing: refineCrossing,
    sampleTimes: sampleTimes,
    buildSimulation: buildSimulation,
    sampleAt: sampleAt,
    nearestSampleIndex: nearestSampleIndex,
    nextTransition: nextTransition,
    compareMetrics: compareMetrics,
    explainComparison: explainComparison,
    scoreSites: scoreSites,
    solarIrradiance: solarIrradiance,
    incidenceCosine: incidenceCosine,
    computePowerAt: computePowerAt,
    integratePower: integratePower,
    fsplDb: fsplDb,
    linkBudget: linkBudget,
    parseCsvEphemeris: parseCsvEphemeris,
    fromEphemerisJson: fromEphemerisJson,
  };
});
