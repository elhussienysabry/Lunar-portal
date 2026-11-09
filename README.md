# Lunar Landing Site Navigator

**Lunar Landing Site Navigator · NASA Space Apps Challenge 2026**

**Live site:** <https://elhussienysabry.github.io/Lunar-portal/>

[![Build and deploy to GitHub Pages](https://github.com/elhussienysabry/Lunar-portal/actions/workflows/pages.yml/badge.svg)](https://github.com/elhussienysabry/Lunar-portal/actions/workflows/pages.yml)

An Arabic static educational site explaining the **Lunar Landing Site Navigator** challenge and building a decision tool for landing-site selection in the lunar south polar region: science, real data, mathematics, power and communications engineering, user experience, and implementation. It includes an **integrated navigator** that combines mission simulation, delay impact, the 360° horizon, site comparison, and an operations timeline in a single workspace.

> **Disclaimer:** This is an independent educational project, not an official NASA product and not affiliated with NASA. It does not use the NASA logo and does not claim official endorsement. The three sites on this site are **derived analysis points** based on LOLA elevation models, not official or NASA-proposed landing sites.

---

## 1. What is here?

| Item | Count / status |
|---|---:|
| Built HTML pages | 21 |
| Interactive labs | 15 |
| Integrated navigator modules | 8 tabs (5 decision modules + 3 supporting) |
| Documented sources | 44 (S1–S44) |
| Glossary terms | 130 |
| Derived terrain sites | 3 |
| LOLA DEM windows | 2 (Site01 and Site04) |
| JPL Horizons Sun/Earth hours | 8,760 hours per site |
| Navigator engine tests | 15 automated tests |
| Data snapshot | 2026-11-04 |
| Challenge dates | November 14–15, 2026 |

The content covers the required sections A–P: understanding the challenge, CLPS, polar science, power and communications, coordinates, data, data engineering, models, UX, the competitive landscape, technologies, roadmap, MVP, validation, glossary, and the learning path. The **Labs** and **Sources** pages were added as supporting interfaces, followed by the **Navigator** (`navigator.html`) as a standalone decision workspace connecting the five modules.

---

## 2. Quick start

The site does not need an application server or a database. However, it **must be served over HTTP**, because the browser fetches JSON and DEM files via `fetch`, which does not work when opening `index.html` directly via `file://`.

The HTML files at the project root are **generated build output and are not tracked in Git**. After cloning the repository, build the site first:

```bash
cd lunar-portal
python3 -m pip install -r requirements.txt
python3 _src/build.py
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8765/
```

The integrated decision workspace:

```text
http://127.0.0.1:8765/navigator.html
```

For any other static server, deploy the build output: the project root after `_src/build.py`, or the `_site` directory produced by GitHub Actions. The home page is `index.html`.

---

## 3. Building the pages

### Requirements

- Python 3.10 or newer (tested on Python 3.14).
- Dependencies in `requirements.txt`.

```bash
python3 -m pip install -r requirements.txt
```

### Build command

```bash
python3 _src/build.py
```

What does the build do?

1. Reads `_src/pages/*.html` through the Jinja templates in `_src/templates/`.
2. Expands citations `[[S9]]` and `[[S2],[S3]]` into links to `sources.html`.
3. Converts claim tags `[!O]`, `[!D]`, `[!E]`, `[!S]`, and `[!H]` into visible badges.
4. Adds an automatic table of contents, wraps tables, and adjusts images.
5. Copies `_src/static/` to `assets/`, and copies the glossary to `assets/data/glossary.json`.
6. Builds the search index `assets/data/search.json`.
7. Checks internal links and anchors, and writes `robots.txt`.
8. Writes `sitemap.xml` **only** if `SITE_URL` is set; no fake domain is assumed.

```bash
# Optional: generate a sitemap with absolute URLs
SITE_URL="https://<your-host>/<path>" python3 _src/build.py
```

Without `SITE_URL`, `robots.txt` is written without a sitemap line, and `sitemap.xml` is not created.

### Build output

- 21 HTML pages at the project root.
- `assets/css/style.css`, `navigator.css`
- `assets/js/app.js`, `labs.js`, `labs-tools.js`, `labs-content.js`, `navigator-engine.js`, `navigator.js`
- `assets/data/*.json` and `*.bin`
- `assets/fonts/*.woff2`
- `assets/img/*.jpg`
- `assets/data/search.json`

---

## 4. Regenerating data (optional)

Generated data is **bundled** in `assets/data/`, so no internet connection is needed to run the site or build the pages. Regeneration is required only if you want to change the sites or the time period.

### Inputs that are not bundled

- Two LOLA 5 m/px models from PGDA:
  - `site01_surf.tif` — Connecting Ridge
  - `site04_surf.tif` — Shackleton rim
- JPL Horizons text files for the Sun and Earth, one-hour step, from 2026-11-01 to 2027-11-01:
  - `horizons_sun_D_year.txt` and `horizons_earth_D_year.txt` — Site01
  - `horizons_sun_B_year.txt` and `horizons_earth_B_year.txt` — Site04 peak
  - `horizons_sun_year.txt` and `horizons_earth_year.txt` — Site04 low

Links to the original products are in `sources.html` under S9, S10, S14, and S15. The original DEM files are large (about 41 MB per window) and are not shipped with the project.

### Command

```bash
python3 _src/build_data.py \
  --research /path/to/lola \
  --horizons /path/to/horizons \
  --out assets
```

It produces:

- `assets/data/sites.json` — the three sites, elevations, slope, Sun/Earth percentages, and horizon.
- `assets/data/ephemeris_<site>.json` — 8,760 hours.
- `assets/data/daily_<site>.json` — daily summary.
- `assets/data/dem_site01.bin` and `dem_site04.bin` — DEM downsampled to 20 m/px for browser display.
- `assets/data/dem_*.json` — metadata and bounds.
- `assets/data/manifest.json` — sizes and SHA-256 fingerprints of the eleven derived products. The file does not list itself (it cannot contain a final hash of itself), nor does it list the build outputs `search.json` and `glossary.json`.
- Derived images in `assets/img/`.

> **Important:** `build_data.py` does not download data automatically from NASA. You are responsible for downloading products from their official pages and verifying their version.

To refresh fingerprints after editing a derived data file, without regenerating DEM or Horizons:

```bash
python3 _src/build_data.py --out assets --manifest-only
```

---

## 5. Project structure

```text
lunar-portal/
├── index.html                  # Home page
├── challenge.html              # A · Understanding the challenge
├── clps.html                   # B · CLPS and missions
├── science.html                # C · South polar science
├── power-comms.html            # D · Power and communications
├── coordinates.html            # E · Coordinates and time
├── datasets.html               # F · Datasets
├── data-engineering.html       # G · Data engineering
├── models.html                 # H · Computational models
├── ux.html                     # I · User experience
├── landscape.html              # J · Competitive landscape
├── stack.html                  # K · Technologies and architecture
├── roadmap.html                # L · Roadmap
├── mvp.html                    # M · MVP vs. advanced
├── validation.html             # N · Validation and trust
├── glossary.html               # O · Interactive glossary
├── learn.html                  # P · Learning path
├── labs.html                   # Lab index + site explorer and comparison
├── sources.html                # Sources S1–S44
├── search.html                 # Site-wide search
├── navigator.html              # Integrated navigator (8 tabs)
├── 404.html
├── robots.txt
├── sitemap.xml                 # Optional when SITE_URL is set
├── requirements.txt
├── assets/
│   ├── css/style.css
│   ├── css/navigator.css       # Navigator workspace styling
│   ├── js/
│   │   ├── app.js              # Navigation, search, TOC, copy, tabs
│   │   ├── labs.js             # Missions, explorer, horizon, Sun, Earth
│   │   ├── labs-tools.js       # Coordinates, calendar, comparison, power, link
│   │   ├── labs-content.js     # Data, glossary, technologies, roadmap, quiz
│   │   ├── navigator-engine.js # Independent, testable calculation engine
│   │   └── navigator.js        # Navigator UI, charts, and export
│   ├── data/                   # JSON + DEM binaries + manifest + search index
│   ├── fonts/                  # IBM Plex Sans Arabic + IBM Plex Mono (local)
│   └── img/                    # Images derived from LOLA
└── _src/
    ├── build.py                # Static site builder
    ├── build_data.py           # Data and image generator
    ├── sources.py              # Source registry S1–S44
    ├── data/glossary.json      # 130 terms
    ├── pages/                  # 21 page templates
    ├── tests/
    │   └── navigator.test.cjs  # 15 navigator engine tests
    ├── templates/
    │   ├── base.html           # Shared layout
    │   └── 404.html
    └── static/                 # Original source for CSS/JS/fonts/img
```

Do not edit files in `assets/` or the root HTML pages directly if you use the build; they are generated outputs that get replaced. Edit `_src/` and rebuild.

> **Tracked in Git:** `_src/`, the LOLA-derived images in `assets/img/*.jpg`, the data in `assets/data/` except `search.json` and `glossary.json`, `requirements.txt`, `README.md`, and the deployment workflow. The root HTML pages, `assets/css/`, `assets/js/`, `assets/fonts/`, `robots.txt`, `sitemap.xml`, `assets/data/search.json`, and `assets/data/glossary.json` are build outputs produced by `_src/build.py` locally or by GitHub Actions.

---

## 6. Real data and the three sites

### 6.1 Sites

The sites were selected inside the two LOLA 5 m/px windows, then the following were computed for them:

- Elevation from the DEM.
- Local slope over 5 m and 50 m windows.
- 360° terrain horizon.
- Percentage of hours with the Sun above the terrain horizon.
- Percentage of hours with Earth visible above the terrain horizon.
- Longest illumination period, longest darkness period, and longest Earth outage.

| Site | Latitude | Longitude | Elevation | Slope | Sun | Earth | Longest darkness | Longest Earth outage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Site01 — Connecting Ridge summit | 89.4389°S | 222.8683°E | 1,959.5 m | 0.20° | 93.97% | 58.04% | 162 h | 279 h |
| Site04 — High point on Shackleton rim | 89.9026°S | 213.9591°E | 1,505.4 m | 2.56° | 74.95% | 54.05% | 176 h | 309 h |
| Site04 — Lower point on Shackleton rim | 89.9405°S | 213.6901°E | 1,423.4 m | 3.30° | 46.78% | 35.29% | 602 h | 436 h |

**Interpretation cautions:**

- These are **derived analysis points**, not official landing sites. Their names are descriptive and do not represent the center of Shackleton crater.
- NASA's statement about "three points on the rim collectively exceeding 90% illumination" refers to specific points in a NASA study and is not a guarantee for every point on the rim. Do not compare a single point's percentage directly with that statement.
- Percentages are computed over one sample year (2026-11-01 to 2027-11-01), not a long-term climate.
- "Longest darkness" means the longest continuous period below the terrain horizon in the sample year, not a statistical guarantee.

### 6.2 Primary data sources

- **LOLA 5 m/px DEM** from NASA GSFC/PGDA: S9, S10, S11, S12.
- **JPL Horizons** for topocentric Sun (10) and Earth (399) elevation and azimuth: S14, S15.
- **SPICE/NAIF** for terminology and frames: S16, S17.
- **USGS Gazetteer** for Shackleton crater center and diameter: S18.
- **Diviner** for scientific context only; the site does not display numerical temperatures derived from it: S13.
- **NASA SVS** for visual context, not for model input data: S33, S34.
- **TSIS-1** for the solar constant of 1,361.6 W/m² used in the calculator: S41.

All citations inside the pages become links to source cards. The full list, access dates, and limitations of each source are in `sources.html`.

---

## 7. The fifteen labs

| # | Lab | Page | Data type |
|---:|---|---|---|
| 01 | CLPS mission timeline | `clps.html` | Documented status through 2026-11-04 |
| 02 | Landing site explorer | `labs.html` | LOLA + derivatives |
| 03 | 360° horizon panorama | `science.html` | LOLA DEM |
| 04 | Sun profile down to the horizon | `power-comms.html` | LOLA + Horizons |
| 05 | Earth visibility over one year | `power-comms.html` | Horizons |
| 06 | Coordinate conversion and polar plot | `coordinates.html` | Geometry + DEM bounds |
| 07 | Illumination and communication calendar | `science.html` | Derived daily summary |
| 08 | Scenario comparison | `labs.html` | Editable educational weights |
| 09 | Power budget | `power-comms.html` | Educational calculator |
| 10 | Link budget | `power-comms.html` | Educational calculator |
| 11 | Dataset explorer | `datasets.html` | Descriptive catalog |
| 12 | Interactive glossary | `glossary.html` | 130 terms |
| 13 | Technology explorer | `stack.html` | Decision comparison |
| 14 | Interactive roadmap | `roadmap.html` | 22 tasks with local progress |
| 15 | Comprehension quiz | `learn.html` | 8 questions |

Labs 02–07 rely on pre-generated data. Labs 08–10 and 14–15 are calculators or educational tools driven by your input. There are no API calls at runtime.

---

## 8. The integrated navigator (`navigator.html`)

A single workspace where every module shares **one scenario state**: site (or custom coordinates), start date, start time, duration, and sampling interval, with the timezone displayed for documentation. Changing any input recomputes all affected modules, while internal calculations remain in UTC.

| Tab | Module | What it provides |
|---|---|---|
| Overview | Decision dashboard | Sun, Earth, and overlap KPIs, the visibility window, a mini timeline, and selected-timestamp details. |
| Simulator | Mission Decision Simulator | Lunar map, celestial direction indicators, polar horizontal chart, and geometric/terrain visibility states. |
| Horizon | 360° Lunar Horizon Intelligence | Sun/Earth azimuth and elevation, per-degree terrain horizon, obstruction distance, and clearance angle. |
| Timeline | Mission Operations Timeline | Synchronized power and communication tracks, zoom/pan, transition points, and an event table. |
| Delay | Mission Delay Impact Analyzer | Compare scenario A with B after a time shift or site change, with deltas and notes. |
| Compare | Landing Site Suitability & Trade-off Analyzer | Compare multiple sites under the same scenario, with editable mission weights and relative ranking. |
| Power & Link | Engineering estimates | Solar power calculator and simplified link-budget calculator with explicit assumptions. |
| Method | Method & validation | Data sources, equations, validation status, and model limitations. |

### 8.1 Data basis and transparency

- **The three predefined sites** use a precomputed horizon from the 5 m/px LOLA DEM, and topocentric Sun/Earth angles from JPL Horizons at a one-hour step, with temporal interpolation at intermediate times.
- **Custom coordinates** are allowed only within the southern range (−90° to −60°). Sun/Earth angles are constructed from a real JPL series at a reference site and then geometrically re-projected to the requested coordinate. This is a **declared approximation**, not an original Horizons series for the custom site.
- **Terrain** is available in the browser only inside the two shipped DEM windows. Outside those windows, the terrain horizon is shown as **unavailable**, and values are never filled with fabricated data.
- No synthetic data is used in production results. Any illustrative display or calculation assumption is explicitly labeled.
- Every card shows its source: stored horizon, browser-computed horizon, or geometric visibility only.

### 8.2 Core calculations

- Transform coordinates into the internal LMN south-polar frame, then compute celestial azimuth and elevation relative to a surface observer.
- Terrain horizon at 1° azimuth steps and 10 m distance steps up to 9 km, with spherical curvature correction `d²/(2R)` and no atmospheric refraction.
- Visibility states: geometrically visible, terrain-obstructed, below the horizon, and unavailable when terrain is missing.
- Visibility windows, blackouts, overlap, and transition boundaries, distinguishing simulation-edge-limited blackouts from internal blackouts.
- Optional solar power estimate with a `terrain` or `geometric` lighting basis, with an explicit fallback to geometric when terrain is unavailable.
- Simplified link budget using FSPL: `20log10(d_km) + 20log10(f_MHz) + 32.44778`, with fixed antenna and noise-temperature assumptions.

### 8.3 Verification and tests

- Automated tests: `node --test _src/tests/navigator.test.cjs` — **15/15 passing**.
- Tests cover coordinate transforms, time interpolation, horizon obstruction, visibility transitions, window computation, scenario comparison, power, and link budget.
- Independent validation by re-projecting one site's series onto other sites: maximum azimuth error **0.0918°** and maximum elevation error **0.00984°**.
- A one-year simulation at a 60-minute step reproduces the published Sun/Earth percentages for the first site within **0.3 percentage points**.
- Tests run in GitHub Actions before the site build, and deployment fails if they fail.

### 8.4 Export and usage

- Export the current visibility windows to CSV (six layers: sun terrain, sun geometric, Earth terrain, Earth geometric, overlap, and power) or JSON with scenario and provenance data.
- The page URL is shareable, but state is **not stored on a server** and is not sent anywhere.
- Numbers in the Arabic RTL interface are wrapped in LTR isolates to preserve the intended order of dates and units.

---

## 9. What is real, what is derived, and what is educational?

| Category | Examples | How to read it |
|---|---|---|
| **Original pre-generated data** | LOLA elevations; Sun/Earth azimuth and elevation from Horizons | Traceable to an official product, but a fixed snapshot rather than live data. |
| **Computational derivatives** | Horizon, illumination percentages, longest darkness, DEM bounds | Depends on the DEM, model resolution, and calculation method; see the validation section. |
| **Navigator outputs** | Visibility windows, blackouts, overlap, and site scores | Derived from the same data; terrain is unavailable outside the two DEM windows, and scores are relative rather than a mission recommendation. |
| **Educational calculators** | Power, link, comparison, coordinates | Their assumptions are explicit and editable; results are not flight design. |
| **Hypothetical/illustrative content** | Scenarios, comparisons, and examples | Tagged `[!H]` or `[!S]` where applicable. |
| **Mission information** | CLPS statuses and dates | Documented through 2026-11-04; future dates may change. |

### Calculator assumptions

- **Power:** constant solar irradiance of 1,361.6 W/m², panel efficiency, packing factor, incidence angle, losses, and constant load. No thermal modeling, annual degradation, or partial shading from structures. The navigator's lighting basis is selectable: terrain or geometric, with an explicit fallback to geometric when DEM is unavailable.
- **Link:** FSPL, ideal antenna, transmit power, gain, losses, data rate, and fixed noise temperature. No plasma, dust, pointing errors, or rain effects (there is no rain on the Moon, but the assumption remains simplified).
- **Comparison:** user-defined educational weights; the result is not a mission recommendation. When a criterion is missing for some sites, weights are renormalized instead of treating the value as zero.

---

## 10. Methodology and validation

### 10.1 Pipeline

```text
LOLA GeoTIFF (5 m/px)
  → read elevations within a defined window
  → select derived points
  → compute 360° horizon (interpolation at edges)
  → downsample to 20 m/px for display
  → merge Sun/Earth angles from Horizons
  → compute Sun/Earth hours and longest continuous periods
  → JSON + DEM binaries + manifest (SHA-256)
```

### 10.2 Build checks

- `python3 _src/build.py` checks every internal link and anchor, and fails when a target is missing.
- The build verifies sizes and SHA-256 fingerprints in `assets/data/manifest.json`, and fails if a data file changes without updated fingerprints.
- `python3 _src/build_data.py --out assets --manifest-only` recomputes fingerprints for derived data files and preserves the original generation date unless `--generated` is passed.
- Verifies that 44 sources exist and prints the glossary term count.
- Builds the search index from expanded text, and strips citation tags from snippets.
- `node --test _src/tests/navigator.test.cjs` runs 15 navigator engine tests and is invoked inside GitHub Actions before the build.
- The navigator interface was checked in Chromium at 1440px and 390px: loading all eight tabs, error logging, horizontal overflow, timeline/delay/comparison/power interactions, and CSV export. No JavaScript errors and no horizontal overflow.
- Separate development tests (outside the project) ran 52 checks in Chromium: loading site pages at two widths, content counts, navigation, search, quiz, map, site switching, and calculator updates. All passed in the last run.
- After deployment to GitHub Pages on 2026-11-06, the same suite was rerun against the public URL: **52/52**, verifying HTTPS, `sitemap.xml`, `robots.txt`, a nested-path 404 page, and the absence of broken images or JavaScript errors.
- Layout was checked at 1440px and 390px: no horizontal overflow, no broken images, no JavaScript errors, and no duplicate IDs on the tested pages.

### 10.3 External link verification

The 44 links were checked on 2026-11-04/05:

- **42 links** returned a direct 2xx response.
- **S1** (challenge page) returned 200 via `curl -k`, while the local certificate store rejected the SSL.com chain. Modern browsers usually have the chain; re-verify in your environment.
- **S42** (Blue Origin Blue Moon Mark 1) returned 429 from the verification address due to rate limiting, not because the page is missing. Retry later or open it in a browser.
- **S29** currently redirects to `quickmap.lroc.im-ldi.com`, which is site behavior and not a broken link.

External links may change. If a link breaks, search for the source title on the official site and record the change instead of silently replacing it.

---

## 11. Known limitations

1. **Not a mission-planning tool.** It does not calculate the descent trajectory, fuel consumption, debris risk, or precise landing terrain.
2. **One year only.** There is no multi-year climate study; the Sun and Earth are computed for one sample year.
3. **Only two DEM windows.** The map does not cover the entire polar region, and there are no ready-made PSR layers or thermal model.
4. **No runtime SPICE.** Horizons was used in advance; `spiceypy` was not installed in the build environment, so no independent verification through SPICE kernels was performed.
5. **Calculators are educational.** Power, link, and comparison are not a substitute for certified engineering analysis.
6. **Mission status is dated.** Any change after 2026-11-04 is not included.
7. **Official challenge resources were not published.** The challenge page stated that resources would be available on Friday, November 13, 2026. We did not invent unpublished requirements or evaluation criteria.
8. **No official evaluation criteria.** We found no evaluation criteria published by NASA for this challenge, so the site makes no claims about them.
9. **Accessibility.** There is a skip link, labels, strong contrast, and keyboard support; however, no full screen-reader review or formal WCAG audit has been performed.
10. **Search is local.** A simple static index, not semantic or vector search.
11. **Original DEM files are not bundled.** The project ships only a 20 m/px display version.
12. **No backend.** No server-side calculations, database, or authentication.
13. **Custom coordinates are approximate.** Sun/Earth angles are constructed from a JPL series at a reference site and then geometrically re-projected; they are not an original topocentric series for the custom coordinate.
14. **Terrain horizon is limited to the shipped windows.** Only inside the two LOLA windows; outside them, "unavailable" is shown and no values are inferred.
15. **The navigator is not a flight tool.** It does not calculate the descent trajectory, fuel, thermal behavior, dust, or debris risk, and it does not provide an official site recommendation.
16. **Communications are simplified.** FSPL and fixed antenna assumptions; no plasma, dust, or pointing-error modeling.

---

## 12. Security and privacy

- No API keys, secrets, or runtime external connections.
- No analytics, tracking cookies, or images from external domains.
- Fonts are local inside `assets/fonts/`.
- Local storage is used only to save roadmap progress (`localStorage`); it is not sent anywhere.
- The navigator scenario state remains in memory for the session, is not sent to a server, and is not saved in `localStorage`.
- Search runs in the browser from `assets/data/search.json`.

---

## 13. Deployment on GitHub Pages

- **Repository:** <https://github.com/elhussienysabry/Lunar-portal>
- **Public URL:** <https://elhussienysabry.github.io/Lunar-portal/>
- **Deployed navigator:** <https://elhussienysabry.github.io/Lunar-portal/navigator.html>
- **Hosting:** GitHub Pages for a public repository, with automatic HTTPS and deployment from GitHub Actions. No server, database, or keys are required.
- **Workflow:** `.github/workflows/pages.yml`, triggered on every `push` to the `main` branch or manually via `workflow_dispatch`.
- **Build:** Python 3.12 + `requirements.txt`, then `node --test _src/tests/navigator.test.cjs`, then `python _src/build.py` with `SITE_URL` set from the `actions/configure-pages` output. Test failure stops deployment.
- **Deployment output:** the `_site` directory produced by the build, containing HTML pages, `assets/`, `robots.txt`, `sitemap.xml`, and `.nojekyll`.
- **One-time setup:** Settings → Pages → Source = **GitHub Actions**. After that, the workflow handles building and deployment automatically.
- **Deployment monitoring:** Actions tab → latest "Build and deploy to GitHub Pages" run → `github-pages` environment.

The site is fully static; the `_site` output can also be deployed to Netlify, Cloudflare Pages, or any static file server. There are no secret environment variables and no database connection.

> GitHub Pages free-tier limits and usage policies may change; see <https://docs.github.com/pages/getting-started-with-github-pages/github-pages-limits> before relying on large sizes or a custom domain.

---

## 14. Usage and attribution

- The Arabic content and code were written for this educational project.
- LOLA, Horizons, and NASA products are subject to NASA usage terms; see S30. The NASA logo is not used to imply official endorsement.
- Derived images in `assets/img/` were built from LOLA data, and their source is cited on the pages. When reusing them, review the original source terms.
- Mission and provider names and trademarks belong to their owners.

---

## 15. Delivery status

- 21 built pages, 15 working labs, an integrated navigator with eight tabs, 130 glossary terms, and 44 sources.
- The navigator engine is covered by 15 automated tests that run during build and deployment.
- LOLA/Horizons data is pre-generated and bundled; no synthetic data is used in production results.
- No dead buttons, fake integrations, or keys.
- Content snapshot: **2026-11-04**. Challenge: **November 14–15, 2026**.

For any scientific correction or changed link, edit `_src/pages/` or `_src/sources.py` and rebuild; do not edit generated HTML manually.
