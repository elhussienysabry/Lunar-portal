/* Node.js tests for the Lunar Mission Navigator calculation engine.
   Run with:  node --test _src/tests/navigator.test.cjs
   No external dependencies and no network access. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const LMN = require("../static/js/navigator-engine.js");

const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "assets", "data");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));

const sitesDoc = readJson("sites.json");
const sites = Object.fromEntries(sitesDoc.sites.map((s) => [s.id, s]));
const ephem = {
  site01: readJson("ephemeris_site01.json"),
  "site04-peak": readJson("ephemeris_site04-peak.json"),
  "site04-low": readJson("ephemeris_site04-low.json"),
};
const daily = {
  site01: readJson("daily_site01.json"),
  "site04-peak": readJson("daily_site04-peak.json"),
  "site04-low": readJson("daily_site04-low.json"),
};

test("data document validates and covers one year", () => {
  assert.deepEqual(LMN.validateSitesDocument(sitesDoc), []);
  for (const id of Object.keys(ephem)) {
    assert.deepEqual(LMN.validateEphemeris(ephem[id]), []);
    assert.deepEqual(LMN.validateDaily(daily[id]), []);
    assert.equal(ephem[id].count, 8760);
    assert.equal(ephem[id].stepHours, 1);
    assert.equal(ephem[id].start, "2026-11-01T00:00Z");
  }
  assert.equal(LMN.DATA_START_MS, Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(LMN.DATA_END_MS, Date.parse("2027-11-01T00:00:00Z"));
});

test("time parsing treats naive date-time input as UTC and rejects out-of-range scenarios", () => {
  assert.equal(LMN.parseUtc("2026-11-01T00:00"), Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(LMN.parseUtc("2026-11-01 12:30"), Date.parse("2026-11-01T12:30:00Z"));
  assert.equal(LMN.timeLabel(Date.parse("2026-11-01T00:00:00Z"), 180, true), "2026-11-01 · 03:00 UTC+03:00");
  const base = { site: sites.site01, durationHours: 24, stepMinutes: 30 };
  assert.deepEqual(LMN.validateScenario({ ...base, startMs: LMN.parseUtc("2026-10-31T23:00Z") }), ["scenario is outside the supplied 2026-11-01 → 2027-11-01 UTC data window"]);
  assert.deepEqual(LMN.validateScenario({ ...base, startMs: LMN.parseUtc("2027-10-31T23:00Z"), durationHours: 2 }), ["scenario is outside the supplied 2026-11-01 → 2027-11-01 UTC data window"]);
  assert.deepEqual(LMN.validateScenario({ ...base, startMs: LMN.parseUtc("2026-11-01T00:00Z") }), []);
});

test("azimuth interpolation crosses 0/360 along the short arc", () => {
  const fake = {
    start: "2026-11-01T00:00Z",
    stepHours: 1,
    count: 2,
    sunAz: [350, 10],
    sunEl: [0, 0],
    earthAz: [10, 350],
    earthEl: [0, 0],
  };
  const s = LMN.sampleEphemeris(fake, Date.parse("2026-11-01T00:30:00Z"));
  assert.ok(Math.abs(s.sunAz - 0) < 1e-9);
  assert.ok(Math.abs(s.earthAz - 0) < 1e-9);
  assert.equal(LMN.wrap180(350 - 10), -20);
});

test("horizon interpolation wraps at 360 degrees and classifyBody separates three states", () => {
  const site = { horizonEl: new Array(360).fill(0) };
  site.horizonEl[0] = -2;
  site.horizonEl[359] = 2;
  assert.ok(Math.abs(LMN.horizonAt(site, 359.5) - 0) < 1e-9);
  const below = LMN.classifyBody({ el: -1, az: 0, angularRadiusDeg: 0.27 }, 0);
  assert.equal(below.state, "below");
  const blocked = LMN.classifyBody({ el: 1, az: 0, angularRadiusDeg: 0.27 }, 2);
  assert.equal(blocked.state, "obstructed");
  assert.equal(blocked.blockedByTerrain, true);
  const visible = LMN.classifyBody({ el: 1, az: 0, angularRadiusDeg: 0.27 }, 0);
  assert.equal(visible.state, "visible");
  const unknown = LMN.classifyBody({ el: 1, az: 0, angularRadiusDeg: 0.27 }, null);
  assert.equal(unknown.state, "geometric");
  assert.equal(unknown.terrainVisible, null);
});

test("frame transform reproduces the independent JPL site series", () => {
  const ref = sites.site01;
  for (const target of ["site04-peak", "site04-low"]) {
    const r = LMN.validateFrameTransform(ref, ephem.site01, daily.site01, sites[target], ephem[target]);
    assert.ok(r.samples >= 60);
    assert.ok(r.maxAzErrorDeg < 0.15, `az error ${r.maxAzErrorDeg} for ${target}`);
    assert.ok(r.maxElErrorDeg < 0.02, `el error ${r.maxElErrorDeg} for ${target}`);
  }
});

test("custom-coordinate provider agrees with the real target ephemeris", () => {
  const target = sites["site04-peak"];
  const provider = LMN.createGeometryProvider({
    site: target,
    ephem: ephem["site04-peak"],
    daily: daily["site04-peak"],
    custom: true,
    referenceSite: sites.site01,
    referenceEphem: ephem.site01,
    referenceDaily: daily.site01,
  });
  let maxAz = 0;
  let maxEl = 0;
  const stepMs = 3600000 * 137;
  for (let i = 0; i < 60; i++) {
    const t = LMN.DATA_START_MS + i * stepMs;
    const got = provider(t);
    const want = LMN.geometryAtFromEphemeris(ephem["site04-peak"], daily["site04-peak"], t);
    maxAz = Math.max(maxAz, Math.abs(LMN.wrap180(got.sun.az - want.sun.az)));
    maxEl = Math.max(maxEl, Math.abs(got.sun.el - want.sun.el));
  }
  assert.ok(maxAz < 0.15, `max az ${maxAz}`);
  assert.ok(maxEl < 0.02, `max el ${maxEl}`);
});

test("terrain horizon finds a synthetic ridge and reports partial coverage", () => {
  const site = { lat: -89.5, lon: 0 };
  const xy = LMN.latLonToXY(site.lat, site.lon);
  const z = 1000;
  // Flat surface at 1000 m, plus a 1000 m high wall 1000 m north.
  // In the south-polar map frame, north is the -y direction.
  const sample = (x, y) => {
    const north = xy.y - y;
    if (north > 990 && north < 1010 && Math.abs(x - xy.x) < 100) return 2000;
    return 1000;
  };
  const h = LMN.computeTerrainHorizon({ sample, x: xy.x, y: xy.y, z, lon: site.lon, maxDistanceM: 3000, stepM: 10 });
  assert.equal(h.horizonEl.length, 360);
  assert.ok(h.horizonEl[0] > 40, `north horizon ${h.horizonEl[0]}`);
  assert.ok(h.horizonEl[180] < 0, `south horizon ${h.horizonEl[180]}`);
  assert.equal(h.partial, false);
  assert.ok(h.horizonDistM[0] > 900 && h.horizonDistM[0] < 1100);
  const missing = LMN.computeTerrainHorizon({ sample: () => NaN, x: 0, y: 0, z: 0, lon: 0, maxDistanceM: 1000, stepM: 100 });
  assert.equal(missing.partial, true);
});

test("visibility intervals, blackouts, and boundary refinement", () => {
  const start = 0;
  const end = 4 * 3600000;
  const times = [0, 1, 2, 3, 4].map((h) => h * 3600000);
  const flags = [false, false, true, true, false];
  const flagAt = (t) => t >= 1.25 * 3600000 && t < 3.5 * 3600000;
  const intervals = LMN.booleanIntervals(times, flags, flagAt, start, end);
  assert.equal(intervals.length, 1);
  assert.ok(Math.abs(intervals[0].startMs - 1.25 * 3600000) < 2 * 60000);
  assert.ok(Math.abs(intervals[0].endMs - 3.5 * 3600000) < 2 * 60000);
  const gaps = LMN.complementIntervals(intervals, start, end);
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].edgeStart, true);
  assert.equal(gaps[1].edgeEnd, true);
  // Only edge blackouts: longest interior blackout is unknown, not fabricated as zero.
  const sim = LMN.buildSimulation({
    site: sites.site01,
    startMs: start,
    durationHours: 4,
    stepMinutes: 60,
    geometryAt: (t) => ({
      sun: { az: 0, el: flagAt(t) ? 1 : -1, distanceKm: LMN.AU_KM, angularRadiusDeg: 0.27 },
      earth: { az: 0, el: flagAt(t) ? 1 : -1, distanceKm: 384400, angularRadiusDeg: 0.95 },
    }),
    customHorizon: { horizonEl: new Array(360).fill(0), resolutionM: 20, source: "test" },
    selectedMs: 0,
  });
  assert.equal(sim.metrics.sun.visibilityH, 2.25);
  assert.equal(sim.metrics.sun.longestBlackoutH, null);
  assert.equal(sim.metrics.sun.longestBlackoutEdgeLimited, true);
  assert.equal(sim.metrics.sun.edgeBlackoutH > 1.24 && sim.metrics.sun.edgeBlackoutH < 1.26, true);
});

test("buildSimulation computes terrain-aware metrics and next transitions", () => {
  const provider = LMN.createGeometryProvider({ site: sites.site01, ephem: ephem.site01, daily: daily.site01 });
  const start = LMN.parseUtc("2026-11-20T00:00Z");
  const sim = LMN.buildSimulation({
    site: sites.site01,
    startMs: start,
    durationHours: 168,
    stepMinutes: 30,
    geometryAt: provider,
    selectedMs: start + 12 * 3600000,
  });
  assert.equal(sim.samples.length, 337);
  assert.equal(sim.metrics.terrainAvailable, true);
  assert.ok(sim.metrics.sun.visibilityPct >= 0 && sim.metrics.sun.visibilityPct <= 100);
  assert.ok(sim.metrics.earth.visibilityPct >= 0 && sim.metrics.earth.visibilityPct <= 100);
  assert.ok(sim.metrics.sun.visibilityH <= 168);
  assert.ok(sim.metrics.earth.visibilityH <= 168);
  assert.ok(sim.metrics.overlap.totalH <= Math.min(sim.metrics.sun.visibilityH, sim.metrics.earth.visibilityH) + 1e-6);
  // The selected week is fully visible at this site, so there is no real
  // transition before the simulation edge.
  assert.equal(sim.next, null);
});

test("synthetic one-year sample reproduces the published annual percentages", () => {
  // The supplied precomputed 5 m horizon is the reference for annual values.
  // A 60-minute sweep over the full year should be within ~0.3 percentage points.
  const provider = LMN.createGeometryProvider({ site: sites.site01, ephem: ephem.site01, daily: daily.site01 });
  const sim = LMN.buildSimulation({
    site: sites.site01,
    startMs: LMN.DATA_START_MS,
    durationHours: 8760 - 1,
    stepMinutes: 60,
    geometryAt: provider,
  });
  assert.ok(Math.abs(sim.metrics.sun.visibilityPct - sites.site01.sunPct) < 0.3, `sun ${sim.metrics.sun.visibilityPct}`);
  assert.ok(Math.abs(sim.metrics.earth.visibilityPct - sites.site01.earthPct) < 0.3, `earth ${sim.metrics.earth.visibilityPct}`);
});

test("power model uses incidence angle and conserves energy", () => {
  assert.ok(Math.abs(LMN.incidenceCosine(180, 0, 0, 0)) < 1e-12);
  assert.ok(Math.abs(LMN.incidenceCosine(180, 90, 0, 0) - 1) < 1e-12);
  assert.ok(Math.abs(LMN.incidenceCosine(180, 0, 90, 180) - 1) < 1e-12);
  assert.ok(Math.abs(LMN.incidenceCosine(0, 0, 90, 180) + 1) < 1e-12);
  const sun = { az: 180, el: 30, distanceKm: LMN.AU_KM, angularRadiusDeg: 0.27, terrainVisible: true, geometric: true };
  const params = { enabled: true, areaM2: 2, efficiencyPct: 30, packingPct: 100, panelTiltDeg: 60, panelAzDeg: 180, lossesPct: 0 };
  const p = LMN.computePowerAt(sun, params, "terrain");
  const expected = LMN.solarIrradiance(LMN.AU_KM) * 2 * 0.3 * LMN.incidenceCosine(180, 30, 60, 180);
  assert.ok(Math.abs(p.powerW - expected) < 1e-6);
  assert.ok(p.powerW > 0);
  const blocked = LMN.computePowerAt({ ...sun, terrainVisible: false }, params, "terrain");
  assert.equal(blocked.powerW, 0);
});

test("link budget uses correct FSPL units and distinguishes visibility from feasibility", () => {
  const fspl = LMN.fsplDb(384400, 8400);
  assert.ok(Math.abs(fspl - 222.63) < 0.05, `fspl ${fspl}`);
  const link = LMN.linkBudget({ txPowerW: 20, frequencyMHz: 8400, gtxDbi: 35, grxDbi: 40, lossesDb: 3, thresholdDbm: -160, distanceKm: 384400 });
  assert.ok(Math.abs(link.txDbm - 43.0103) < 1e-3);
  assert.ok(Math.abs(link.marginDb - 52.3813) < 1e-3);
  assert.equal(link.feasible, true);
});

test("scenario comparison reports signed deltas and percentages", () => {
  const a = {
    sun: { visibilityPct: 80, visibilityH: 80, longestBlackoutH: 10 },
    earth: { visibilityPct: 50, visibilityH: 50, longestBlackoutH: 20 },
    overlap: { pct: 40, totalH: 40 },
    power: null,
  };
  const b = {
    sun: { visibilityPct: 90, visibilityH: 90, longestBlackoutH: 5 },
    earth: { visibilityPct: 40, visibilityH: 40, longestBlackoutH: 30 },
    overlap: { pct: 35, totalH: 35 },
    power: { totalEnergyWh: 1000 },
  };
  const c = LMN.compareMetrics(a, b);
  assert.equal(c.sunH.delta, 10);
  assert.equal(c.sunH.pct, 12.5);
  assert.equal(c.earthBlackout.delta, 10);
  assert.equal(c.powerWh.delta, null);
  const notes = LMN.explainComparison(c);
  assert.ok(notes.some((n) => n.key === "sunH" && n.tone === "good"));
  assert.ok(notes.some((n) => n.key === "earthBlackout" && n.tone === "bad"));
});

test("site scoring is normalized, explainable, and excludes missing criteria", () => {
  const entries = [
    { site: { id: "a", shortAr: "أ", slopeDeg: 1 }, metrics: { sun: { visibilityPct: 90, longestBlackoutH: 10 }, earth: { visibilityPct: 60, longestBlackoutH: 20 }, overlap: { pct: 55 }, terrainAvailable: true }, completeness: 1 },
    { site: { id: "b", shortAr: "ب", slopeDeg: 3 }, metrics: { sun: { visibilityPct: 70, longestBlackoutH: 30 }, earth: { visibilityPct: 40, longestBlackoutH: 40 }, overlap: { pct: 30 }, terrainAvailable: true }, completeness: 0.8 },
  ];
  const r = LMN.scoreSites(entries, "balanced");
  assert.equal(r.results.length, 2);
  assert.ok(r.results[0].score > r.results[1].score);
  assert.ok(r.results[0].score <= 100 && r.results[1].score >= 0);
  const totalPoints = r.results[0].contributions.reduce((s, c) => s + c.points, 0);
  assert.ok(Math.abs(totalPoints - r.results[0].score) < 1e-9);
  const profile = LMN.SCORE_PROFILES.comm;
  assert.ok(Math.abs(Object.values(profile.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const missing = LMN.scoreSites(entries.map((e) => ({ ...e, metrics: { ...e.metrics, sun: { ...e.metrics.sun, longestBlackoutH: null } } })), "power");
  assert.ok(missing.excluded.some((x) => x.key === "sunBlackout"));
});

test("CSV adapter validates and maps a user-provided ephemeris", () => {
  const csv = [
    "timestamp,target,azimuth_deg,elevation_deg,distance_km",
    "2026-11-01T00:00Z,sun,10,1,149000000",
    "2026-11-01T01:00Z,sun,11,1.1,149000000",
    "2026-11-01T00:00Z,earth,20,2,384400",
    "2026-11-01T01:00Z,earth,21,2.1,384400",
  ].join("\n");
  const e = LMN.parseCsvEphemeris(csv, { siteId: "custom" });
  assert.equal(e.count, 2);
  assert.deepEqual(e.sunAz, [10, 11]);
  assert.deepEqual(e.earthAz, [20, 21]);
  assert.deepEqual(LMN.validateEphemeris(e), []);
  assert.throws(() => LMN.parseCsvEphemeris(csv.replace("10,1", "400,1")), /azimuth/);
});
