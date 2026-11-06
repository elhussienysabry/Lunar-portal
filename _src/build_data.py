#!/usr/bin/env python3
"""
Build the static data assets for the Lunar Landing Site Navigator.

Inputs (not shipped in the repository because of size):
  * LOLA 5 m/px south-pole DEMs from PGDA, renamed to:
      site01_surf.tif  (Connecting Ridge)
      site04_surf.tif  (Shackleton rim)
  * JPL Horizons observer ephemerides for Sun (10) and Earth (399) at
    three sample points, 2026-11-01 .. 2027-11-01, 1 h steps, CSV.

The script produces:
  assets/data/sites.json
  assets/data/ephemeris_<site>.json
  assets/data/daily_<site>.json
  assets/data/dem_<dem>.bin + dem_<dem>.json
  assets/img/map_mosaic.jpg, dem_*.jpg, hero.jpg, shackleton_crop.jpg

Usage:
  python3 _src/build_data.py --research /tmp/opencode/research/lola \
      --horizons /tmp/opencode/research --out assets

  # Recompute checksums only (after editing a derived JSON, for example):
  python3 _src/build_data.py --out assets --manifest-only
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None

R_MOON = 1_737_400.0  # m, IAU mean radius used by the LOLA polar DEMs
AU_KM = 149_597_870.7
R_SUN_KM = 695_700.0
R_EARTH_KM = 6_378.137
SUN_ANG_RADIUS = 0.266  # deg at 1 AU
EARTH_ANG_RADIUS = 0.95  # deg at mean Earth-Moon distance

DEM_INFO = {
    "site01": {
        "file": "site01_surf.tif",
        "x0": -19_000.0,
        "y0": -4_000.0,  # top edge (y decreases with row)
        "label": "LOLA Site01 — Connecting Ridge",
    },
    "site04": {
        "file": "site04_surf.tif",
        "x0": -9_000.0,
        "y0": 1_000.0,
        "label": "LOLA Site04 — Shackleton rim",
    },
}

SITES = [
    {
        "id": "site01",
        "dem": "site01",
        "px": 1485,
        "py": 1694,
        "nameAr": "قمة حافة الاتصال",
        "nameEn": "Connecting Ridge summit",
        "shortAr": "حافة الاتصال",
        "color": "#5ee0a0",
        "role": "مرشح عالي الإضاءة",
        "noteAr": "أعلى نقطة في نموذج Site01، تنحدر التضاريس حولها من كل الاتجاهات تقريبًا. ميل موضعي منخفض جدًا في نموذج 5 أمتار.",
        "horizons": ("horizons_sun_D_year.txt", "horizons_earth_D_year.txt"),
    },
    {
        "id": "site04-peak",
        "dem": "site04",
        "px": 1470,
        "py": 690,
        "nameAr": "نقطة مرتفعة على حافة شاكليتون",
        "nameEn": "High point on Shackleton rim",
        "shortAr": "حافة شاكليتون",
        "color": "#57d7e8",
        "role": "مرشح متوازن",
        "noteAr": "قمة بارزة داخل نموذج Site04، على بُعد نحو 3.0 كم من القطب، وتطل على تضاريس منخفضة. النقطة مشتقة من أعلى ارتفاع في النافذة، وليست موقع هبوط رسميًا.",
        "horizons": ("horizons_sun_B_year.txt", "horizons_earth_B_year.txt"),
    },
    {
        "id": "site04-low",
        "dem": "site04",
        "px": 1600,
        "py": 500,
        "nameAr": "نقطة منخفضة على حافة شاكليتون",
        "nameEn": "Lower point on Shackleton rim",
        "shortAr": "حافة منخفضة",
        "color": "#ffb454",
        "role": "مقارنة تعليمية",
        "noteAr": "نقطة منبسطة نسبيًا داخل نموذج Site04، لكن حاجزًا تضاريسيًا قريبًا يحجب الشمس جزءًا كبيرًا من السنة. مشتقة للتحليل، وليست موقع هبوط رسميًا.",
        "horizons": ("horizons_sun_year.txt", "horizons_earth_year.txt"),
    },
]


# ----------------------------------------------------------------------------
# Basic geospatial helpers
# ----------------------------------------------------------------------------

def load_dem(path: Path) -> np.ndarray:
    return np.array(Image.open(path), dtype=np.float64)


def bilinear(a: np.ndarray, x0: float, y0: float, pix: float, x, y) -> np.ndarray:
    """Sample a north-up DEM whose first row is y0 and whose pixel size is pix."""
    c = (np.asarray(x, dtype=float) - x0) / pix
    r = (y0 - np.asarray(y, dtype=float)) / pix
    out = np.full(np.broadcast(c, r).shape, np.nan)
    cc, rr = np.broadcast_arrays(c, r)
    ok = (cc >= 0) & (rr >= 0) & (cc < a.shape[1] - 1) & (rr < a.shape[0] - 1)
    c0 = np.floor(cc[ok]).astype(int)
    r0 = np.floor(rr[ok]).astype(int)
    fc = cc[ok] - c0
    fr = rr[ok] - r0
    out[ok] = (
        a[r0, c0] * (1 - fc) * (1 - fr)
        + a[r0, c0 + 1] * fc * (1 - fr)
        + a[r0 + 1, c0] * (1 - fc) * fr
        + a[r0 + 1, c0 + 1] * fc * fr
    )
    return out


def latlon_to_xy(lat_deg: float, lon_deg: float) -> tuple[float, float]:
    """Inverse south-polar stereographic projection used by the PGDA DEMs.

    x = rho sin(lon), y = rho cos(lon), rho = 2 R tan((90 + lat)/2).
    This convention was checked against the USGS Shackleton centre and the
    visible crater geometry in the Site04 tile.
    """
    rho = 2 * R_MOON * math.tan(math.radians((90.0 + lat_deg) / 2.0))
    lon = math.radians(lon_deg)
    return rho * math.sin(lon), rho * math.cos(lon)


def xy_to_latlon(x: float, y: float) -> tuple[float, float]:
    rho = math.hypot(x, y)
    lat = 90.0 - 2.0 * math.degrees(math.atan(rho / (2 * R_MOON)))
    lon = math.degrees(math.atan2(x, y)) % 360.0
    return lat, lon


# ----------------------------------------------------------------------------
# Terrain horizon
# ----------------------------------------------------------------------------

def terrain_horizon(
    a: np.ndarray,
    x0: float,
    y0: float,
    pix: float,
    x: float,
    y: float,
    z: float,
    lon: float,
    *,
    naz: int = 360,
    rmax: float = 9_000.0,
    step: float = 10.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Maximum terrain elevation angle for each true-north azimuth.

    Local east/north are rotated from the map frame at the observer's
    longitude.  A spherical curvature drop d^2/(2R) is applied.  No
    atmospheric refraction is used (the Moon has no appreciable atmosphere).
    """
    az = np.arange(naz, dtype=float) * (360.0 / naz)
    lam = math.radians(lon)
    ds = np.arange(step, rmax + step, step)
    e = np.sin(np.radians(az))[:, None]
    n = np.cos(np.radians(az))[:, None]
    dx = e * math.cos(lam) - n * math.sin(lam)
    dy = -e * math.sin(lam) - n * math.cos(lam)
    xx = x + ds[None, :] * dx
    yy = y + ds[None, :] * dy
    zz = bilinear(a, x0, y0, pix, xx, yy)
    drop = ds[None, :] ** 2 / (2 * R_MOON)
    elev = np.degrees(np.arctan2(zz - z - drop, ds[None, :]))
    elev = np.where(np.isfinite(zz), elev, -90.0)
    j = np.argmax(elev, axis=1)
    rows = np.arange(naz)
    return az, elev[rows, j], ds[j], zz[rows, j]


def local_slope(a, x0, y0, pix, x, y, baseline=100.0) -> float:
    gx = (bilinear(a, x0, y0, pix, x + baseline / 2, y) - bilinear(a, x0, y0, pix, x - baseline / 2, y)) / baseline
    gy = (bilinear(a, x0, y0, pix, x, y + baseline / 2) - bilinear(a, x0, y0, pix, x, y - baseline / 2)) / baseline
    return float(np.degrees(np.arctan(np.hypot(gx, gy))))


# ----------------------------------------------------------------------------
# Horizons parsing
# ----------------------------------------------------------------------------

def parse_horizons(path: Path) -> list[dict]:
    rows: list[dict] = []
    inside = False
    for line in path.read_text(errors="replace").splitlines():
        if "$$SOE" in line:
            inside = True
            continue
        if "$$EOE" in line:
            break
        if not inside:
            continue
        p = [q.strip() for q in line.split(",")]
        if len(p) < 7:
            continue
        t = dt.datetime.strptime(p[0], "%Y-%b-%d %H:%M").replace(tzinfo=dt.timezone.utc)
        rows.append(
            {
                "t": t,
                "az": float(p[3]),
                "el": float(p[4]),
                "distAu": float(p[6]),
            }
        )
    return rows


def runs_from_flags(times: list[dt.datetime], flags: list[bool]) -> list[tuple[dt.datetime, dt.datetime, float]]:
    runs = []
    start = None
    for t, f in zip(times, flags):
        if f and start is None:
            start = t
        if not f and start is not None:
            runs.append((start, t, (t - start).total_seconds() / 3600.0))
            start = None
    if start is not None:
        runs.append((start, times[-1] + dt.timedelta(hours=1), (times[-1] + dt.timedelta(hours=1) - start).total_seconds() / 3600.0))
    return runs


def fmt_t(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%MZ")


# ----------------------------------------------------------------------------
# Image helpers
# ----------------------------------------------------------------------------

def colorize_hillshade(z: np.ndarray, lo: float, hi: float, dx: float = 20.0, tint=(0.55, 0.82, 0.95)) -> np.ndarray:
    gy, gx = np.gradient(z, dx)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = math.radians(315.0)
    alt = math.radians(42.0)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    hs = np.clip(hs, 0, 1)
    t = np.clip((z - lo) / (hi - lo), 0, 1)
    # dark navy -> steel blue -> pale cyan
    r = np.interp(t, [0, 0.35, 0.62, 0.82, 1], [5, 13, 30, 63, 140])
    g = np.interp(t, [0, 0.35, 0.62, 0.82, 1], [12, 27, 56, 103, 190])
    b = np.interp(t, [0, 0.35, 0.62, 0.82, 1], [22, 43, 78, 130, 200])
    shade = 0.34 + 0.70 * hs
    rgb = np.stack([r, g, b], axis=-1) * shade[..., None]
    rgb[..., 0] *= tint[0]
    rgb[..., 1] *= tint[1]
    rgb[..., 2] *= tint[2]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def add_contours(rgb: np.ndarray, z: np.ndarray, interval=250.0, alpha=0.20, color=(120, 220, 235)) -> np.ndarray:
    k = np.floor(z / interval)
    edge = np.zeros(z.shape, dtype=bool)
    edge[:-1, :] |= k[:-1, :] != k[1:, :]
    edge[:, :-1] |= k[:, :-1] != k[:, 1:]
    out = rgb.astype(np.float32)
    c = np.array(color, dtype=np.float32)
    out[edge] = out[edge] * (1 - alpha) + c * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


# ----------------------------------------------------------------------------
# Manifest
# ----------------------------------------------------------------------------

MANIFEST_GLOBS = (
    "sites.json",
    "daily_*.json",
    "ephemeris_*.json",
    "dem_*.bin",
    "dem_*.json",
)


def write_manifest(out: Path, generated: str | None = None) -> dict:
    """Write checksums for the derived data products, excluding the manifest itself.

    Only files produced by build_data.py are listed. Site build artifacts such as
    glossary.json and search.json are deliberately excluded, as is manifest.json
    (a file cannot contain its own final SHA-256).
    """
    data = out / "data"
    manifest_path = data / "manifest.json"

    if generated is None and manifest_path.exists():
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            generated = previous.get("generated")
        except (OSError, ValueError):
            generated = None
    generated = generated or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")

    found: dict[str, Path] = {}
    for pattern in MANIFEST_GLOBS:
        for path in data.glob(pattern):
            if path.is_file() and path.name != "manifest.json":
                found[path.name] = path

    manifest = {
        "schema": 2,
        "generated": generated,
        "scope": (
            "Derived data products written by build_data.py. "
            "manifest.json and site build artifacts (search.json, glossary.json) are excluded."
        ),
        "files": [
            {
                "name": name,
                "bytes": found[name].stat().st_size,
                "sha256": hashlib.sha256(found[name].read_bytes()).hexdigest(),
            }
            for name in sorted(found)
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--research", default="/tmp/opencode/research/lola", help="folder with the two GeoTIFF DEMs")
    ap.add_argument("--horizons", default="/tmp/opencode/research", help="folder with Horizons *_year.txt files")
    ap.add_argument("--out", default="assets", help="output assets folder")
    ap.add_argument(
        "--manifest-only",
        action="store_true",
        help="recompute data/manifest.json from existing files; no DEMs or Horizons inputs needed",
    )
    ap.add_argument("--generated", default=None, help="ISO UTC timestamp to record in the manifest")
    args = ap.parse_args()

    research = Path(args.research)
    hzdir = Path(args.horizons)
    out = Path(args.out)

    if args.manifest_only:
        if not (out / "data").is_dir():
            ap.error(f"{out / 'data'} does not exist")
        manifest = write_manifest(out, args.generated)
        print(f"manifest: {len(manifest['files'])} files, generated {manifest['generated']}")
        return

    (out / "data").mkdir(parents=True, exist_ok=True)
    (out / "img").mkdir(parents=True, exist_ok=True)

    dems = {}
    for key, info in DEM_INFO.items():
        dems[key] = load_dem(research / info["file"])
        print(f"loaded {key}: {dems[key].shape} {np.nanmin(dems[key]):.1f}..{np.nanmax(dems[key]):.1f} m")

    sites_out = []
    all_stats = {}

    for site in SITES:
        info = DEM_INFO[site["dem"]]
        a = dems[site["dem"]]
        x = info["x0"] + site["px"] * 5.0
        y = info["y0"] - site["py"] * 5.0
        z = float(bilinear(a, info["x0"], info["y0"], 5.0, x, y))
        lat, lon = xy_to_latlon(x, y)
        slope50 = local_slope(a, info["x0"], info["y0"], 5.0, x, y, 50.0)
        slope100 = local_slope(a, info["x0"], info["y0"], 5.0, x, y, 100.0)

        az, hel, hdist, hz = terrain_horizon(
            a, info["x0"], info["y0"], 5.0, x, y, z, lon, naz=360, rmax=9_000, step=10
        )

        sun = parse_horizons(hzdir / site["horizons"][0])
        earth = parse_horizons(hzdir / site["horizons"][1])
        times = [r["t"] for r in sun[:-1]]
        sun = sun[:-1]
        earth = earth[:-1]

        hz_at_sun = np.interp([r["az"] for r in sun], az, hel, period=360)
        hz_at_earth = np.interp([r["az"] for r in earth], az, hel, period=360)
        sun_vis = [r["el"] + SUN_ANG_RADIUS > h for r, h in zip(sun, hz_at_sun)]
        earth_vis = [r["el"] + EARTH_ANG_RADIUS > h for r, h in zip(earth, hz_at_earth)]

        sun_runs = runs_from_flags(times, sun_vis)
        earth_runs = runs_from_flags(times, earth_vis)
        sun_dark = runs_from_flags(times, [not f for f in sun_vis])

        # Daily aggregates (365 days, UTC).
        daily = []
        for d in range(365):
            sl = slice(d * 24, d * 24 + 24)
            day_sun = sun[sl]
            day_earth = earth[sl]
            daily.append(
                {
                    "d": (times[d * 24]).strftime("%Y-%m-%d"),
                    "sunH": round(float(sum(sun_vis[sl])), 2),
                    "earthH": round(float(sum(earth_vis[sl])), 2),
                    "sunElMin": round(min(r["el"] for r in day_sun), 3),
                    "sunElMax": round(max(r["el"] for r in day_sun), 3),
                    "earthElMin": round(min(r["el"] for r in day_earth), 3),
                    "earthElMax": round(max(r["el"] for r in day_earth), 3),
                }
            )

        # Monthly illumination.
        monthly = {}
        for d in daily:
            monthly.setdefault(d["d"][:7], {"sun": 0.0, "earth": 0.0, "n": 0})
            monthly[d["d"][:7]]["sun"] += d["sunH"]
            monthly[d["d"][:7]]["earth"] += d["earthH"]
            monthly[d["d"][:7]]["n"] += 1
        monthly = {
            k: {
                "sunPct": round(100 * v["sun"] / (24 * v["n"]), 2),
                "earthPct": round(100 * v["earth"] / (24 * v["n"]), 2),
                "days": v["n"],
            }
            for k, v in monthly.items()
        }

        # Distances at 00:00 UTC for power / angular-size calculations.
        daily_dist = []
        for d in range(365):
            daily_dist.append(
                {
                    "d": times[d * 24].strftime("%Y-%m-%d"),
                    "sunAu": round(sun[d * 24]["distAu"], 6),
                    "earthAu": round(earth[d * 24]["distAu"], 6),
                }
            )

        sun_pct = 100.0 * sum(sun_vis) / len(sun_vis)
        earth_pct = 100.0 * sum(earth_vis) / len(earth_vis)
        longest_sun = max(sun_runs, key=lambda r: r[2])
        longest_dark = max(sun_dark, key=lambda r: r[2])
        longest_earth = max(earth_runs, key=lambda r: r[2])
        longest_earth_out = max(runs_from_flags(times, [not f for f in earth_vis]), key=lambda r: r[2])

        sites_out.append(
            {
                "id": site["id"],
                "nameAr": site["nameAr"],
                "nameEn": site["nameEn"],
                "shortAr": site["shortAr"],
                "role": site["role"],
                "noteAr": site["noteAr"],
                "color": site["color"],
                "dem": site["dem"],
                "lat": round(lat, 6),
                "lon": round(lon, 4),
                "altM": round(z, 1),
                "slopeDeg": round(slope100, 2),
                "slope50Deg": round(slope50, 2),
                "sunPct": round(sun_pct, 2),
                "earthPct": round(earth_pct, 2),
                "longestSunHours": round(longest_sun[2], 1),
                "longestSunStart": fmt_t(longest_sun[0]),
                "longestSunEnd": fmt_t(longest_sun[1]),
                "longestDarkHours": round(longest_dark[2], 1),
                "longestEarthHours": round(longest_earth[2], 1),
                "longestEarthStart": fmt_t(longest_earth[0]),
                "longestEarthEnd": fmt_t(longest_earth[1]),
                "longestEarthOutageHours": round(longest_earth_out[2], 1),
                "horizonAz": [int(v) for v in az],
                "horizonEl": [round(float(v), 2) for v in hel],
                "horizonDistM": [int(v) for v in hdist],
                "horizonZ": [round(float(v), 1) for v in hz],
                "monthly": monthly,
                "px": site["px"],
                "py": site["py"],
                "x": round(x, 1),
                "y": round(y, 1),
            }
        )

        # Hourly compact ephemeris.  Azimuth 0.1 deg, elevation 0.01 deg.
        ephem = {
            "id": site["id"],
            "start": fmt_t(times[0]),
            "stepHours": 1,
            "count": len(times),
            "sunAz": [round(r["az"], 1) for r in sun],
            "sunEl": [round(r["el"], 2) for r in sun],
            "earthAz": [round(r["az"], 1) for r in earth],
            "earthEl": [round(r["el"], 2) for r in earth],
        }
        (out / "data" / f"ephemeris_{site['id']}.json").write_text(
            json.dumps(ephem, separators=(",", ":")), encoding="utf-8"
        )
        (out / "data" / f"daily_{site['id']}.json").write_text(
            json.dumps({"id": site["id"], "days": daily, "dist": daily_dist}, separators=(",", ":")),
            encoding="utf-8",
        )
        all_stats[site["id"]] = {
            "sunPct": round(sun_pct, 2),
            "earthPct": round(earth_pct, 2),
            "sunHours": int(round(float(sum(sun_vis)), 0)),
            "earthHours": int(round(float(sum(earth_vis)), 0)),
            "longestSunHours": round(longest_sun[2], 1),
            "longestDarkHours": round(longest_dark[2], 1),
            "longestEarthHours": round(longest_earth[2], 1),
        }
        print(
            f"{site['id']}: lat {lat:.6f} lon {lon:.4f} z {z:.1f} m slope {slope100:.2f}° "
            f"sun {sun_pct:.2f}% earth {earth_pct:.2f}% "
            f"longest sun {longest_sun[2]/24:.1f} d, longest dark {longest_dark[2]:.1f} h, "
            f"longest Earth {longest_earth[2]/24:.1f} d"
        )

    # ------------------------------------------------------------------
    # Downloadable/compact terrain grids (20 m/px, int16 metres)
    # ------------------------------------------------------------------
    dem_meta = {}
    for key, info in DEM_INFO.items():
        a = dems[key]
        ds = a[: a.shape[0] // 4 * 4, : a.shape[1] // 4 * 4].reshape(
            a.shape[0] // 4, 4, a.shape[1] // 4, 4
        ).mean(axis=(1, 3))
        arr = np.round(ds).astype("<i2")
        bin_name = f"dem_{key}.bin"
        arr.tofile(out / "data" / bin_name)
        meta = {
            "id": key,
            "label": info["label"],
            "x0": info["x0"],
            "y0": info["y0"],
            "width": int(arr.shape[1]),
            "height": int(arr.shape[0]),
            "pixelM": 20.0,
            "minEl": float(np.nanmin(ds)),
            "maxEl": float(np.nanmax(ds)),
            "source": "NASA LOLA / PGDA 5 m DEM, downsampled 4x for the browser",
            "file": bin_name,
        }
        (out / "data" / f"dem_{key}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        dem_meta[key] = meta

        # hillshade image for the clickable terrain lab
        rgb = colorize_hillshade(ds, np.nanpercentile(ds, 1), np.nanpercentile(ds, 99), dx=20.0, tint=(0.88, 0.98, 1.0))
        rgb = add_contours(rgb, ds, interval=250.0, alpha=0.10)
        Image.fromarray(rgb).save(out / "img" / f"dem_{key}.jpg", quality=88, optimize=True)

    # ------------------------------------------------------------------
    # Mosaic of both DEMs for the landing-site map
    # ------------------------------------------------------------------
    xmin, xmax = -20_000.0, 8_000.0
    ymin, ymax = -20_000.0, 2_000.0
    res = 10.0
    W = int((xmax - xmin) / res)
    H = int((ymax - ymin) / res)
    xs = xmin + (np.arange(W) + 0.5) * res
    ys = ymax - (np.arange(H) + 0.5) * res
    XX, YY = np.meshgrid(xs, ys)
    z1 = bilinear(dems["site01"], DEM_INFO["site01"]["x0"], DEM_INFO["site01"]["y0"], 5.0, XX, YY)
    z4 = bilinear(dems["site04"], DEM_INFO["site04"]["x0"], DEM_INFO["site04"]["y0"], 5.0, XX, YY)
    valid1 = np.isfinite(z1)
    valid4 = np.isfinite(z4)
    # Feather the overlap in x from -9.5 km to -8.5 km.
    w4 = np.clip((XX + 9_500.0) / 1_000.0, 0, 1)
    w4 = w4 * w4 * (3 - 2 * w4)
    z = np.where(valid1 & valid4, z1 * (1 - w4) + z4 * w4, np.where(valid4, z4, z1))
    z = np.where(np.isfinite(z), z, np.nanmedian(z))
    rgb = colorize_hillshade(z, -2_900, 1_900, dx=res, tint=(0.9, 0.99, 1.0))
    rgb = add_contours(rgb, z, interval=250.0, alpha=0.12)
    # subtle darkening toward the edges
    yy, xx = np.mgrid[0:H, 0:W]
    vign = 1.0 - 0.18 * (((xx / W - 0.5) ** 2 + (yy / H - 0.5) ** 2) ** 0.5 / 0.71)
    rgb = np.clip(rgb.astype(np.float32) * vign[..., None], 0, 255).astype(np.uint8)
    terrain = Image.fromarray(rgb).resize((W // 2, H // 2), Image.LANCZOS)

    # Background: a dark polar chart with a 2 km radial grid, visible where
    # the two DEM tiles do not cover the map.
    mw, mh = W // 2, H // 2
    bg = Image.new("RGB", (mw, mh), (5, 10, 18))
    d = ImageDraw.Draw(bg, "RGBA")
    px = (0.0 - xmin) / (res * 2)
    py = (ymax - 0.0) / (res * 2)
    for radius_km in range(2, 30, 2):
        rr = radius_km * 1000.0 / (res * 2)
        d.ellipse((px - rr, py - rr, px + rr, py + rr), outline=(55, 115, 140, 48), width=1)
    for ang in range(0, 360, 30):
        th = math.radians(ang)
        d.line((px, py, px + 2000 * math.sin(th), py - 2000 * math.cos(th)), fill=(55, 115, 140, 38), width=1)
    # little pole cross
    d.line((px - 5, py, px + 5, py), fill=(120, 220, 235, 180), width=1)
    d.line((px, py - 5, px, py + 5), fill=(120, 220, 235, 180), width=1)

    # Soft coverage mask so the tile edges look like a data footprint, not
    # a rendering error.
    mask = Image.fromarray(((valid1 | valid4).astype(np.uint8) * 255)).resize((mw, mh), Image.LANCZOS)
    mask = mask.filter(ImageFilter.GaussianBlur(6))
    bg.paste(terrain, (0, 0), mask)
    mosaic = bg
    mosaic.save(out / "img" / "map_mosaic.jpg", quality=90, optimize=True, progressive=True)
    print("mosaic saved", (out / "img" / "map_mosaic.jpg").stat().st_size, "bytes")

    # Hero crop: a wide, darker view for the landing hero.
    hero = mosaic.crop((0, 0, int(mosaic.width * 0.86), mosaic.height))
    hero = hero.resize((1800, int(1800 * hero.height / hero.width)), Image.LANCZOS)
    arr = np.asarray(hero).astype(np.float32)
    # deep-blue grade + vignette
    arr[..., 0] *= 0.62
    arr[..., 1] *= 0.82
    arr[..., 2] *= 1.02
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
    r = np.sqrt((xx / arr.shape[1] - 0.5) ** 2 + (yy / arr.shape[0] - 0.5) ** 2) / 0.71
    arr *= (1.0 - 0.55 * np.clip(r, 0, 1))[..., None]
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(
        out / "img" / "hero.jpg", quality=84, optimize=True, progressive=True
    )

    # Shackleton crop for the science page
    # x -3..9 km, y -11..1 km
    c0 = int((-3_000 - xmin) / res / 2)
    c1 = int((9_000 - xmin) / res / 2)
    r0 = int((ymax - 1_000) / res / 2)
    r1 = int((ymax + 11_000) / res / 2)
    shack = mosaic.crop((c0, r0, c1, r1)).resize((1200, int(1200 * (r1 - r0) / (c1 - c0))), Image.LANCZOS)
    shack.save(out / "img" / "shackleton_crop.jpg", quality=88, optimize=True)

    # ------------------------------------------------------------------
    # Site list with map positions
    # ------------------------------------------------------------------
    for s in sites_out:
        s["mapXPct"] = round(100.0 * (s["x"] - xmin) / (xmax - xmin), 3)
        s["mapYPct"] = round(100.0 * (ymax - s["y"]) / (ymax - ymin), 3)

    shack_lat, shack_lon = -89.67, 129.78
    sx, sy = latlon_to_xy(shack_lat, shack_lon)
    pole_x, pole_y = 0.0, 0.0
    sites_doc = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "epoch": "2026-11-01T00:00Z",
        "epochEnd": "2027-11-01T00:00Z",
        "stepHours": 1,
        "dem": dem_meta,
        "mosaic": {
            "file": "img/map_mosaic.jpg",
            "xmin": xmin,
            "xmax": xmax,
            "ymin": ymin,
            "ymax": ymax,
            "width": mosaic.width,
            "height": mosaic.height,
            "pixelM": res * 2,
        },
        "landmarks": [
            {
                "id": "shackleton",
                "nameAr": "فوهة شاكليتون",
                "nameEn": "Shackleton crater",
                "lat": shack_lat,
                "lon": shack_lon,
                "x": round(sx, 1),
                "y": round(sy, 1),
                "mapXPct": round(100.0 * (sx - xmin) / (xmax - xmin), 3),
                "mapYPct": round(100.0 * (ymax - sy) / (ymax - ymin), 3),
                "noteAr": "مركز الفوهة وفق USGS Gazetteer. القطب الجنوبي يقع على حافتها تقريبًا.",
            },
            {
                "id": "pole",
                "nameAr": "القطب الجنوبي القمري",
                "nameEn": "Lunar south pole",
                "lat": -90.0,
                "lon": None,
                "x": pole_x,
                "y": pole_y,
                "mapXPct": round(100.0 * (pole_x - xmin) / (xmax - xmin), 3),
                "mapYPct": round(100.0 * (ymax - pole_y) / (ymax - ymin), 3),
                "noteAr": "النقطة المرجعية للإحداثيات؛ خط الطول غير معرّف عندها.",
            },
        ],
        "sites": sites_out,
    }
    (out / "data" / "sites.json").write_text(json.dumps(sites_doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Manifest with checksums for provenance (manifest.json itself is excluded).
    manifest = write_manifest(out, args.generated or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"))
    print(f"manifest: {len(manifest['files'])} files, generated {manifest['generated']}")

    print("wrote", out / "data" / "sites.json")
    print("stats:", json.dumps(all_stats, ensure_ascii=False, indent=2))
    print("mosaic", mosaic.size, "hero", hero.size, "shackleton", shack.size)


if __name__ == "__main__":
    main()
