# AcuRite Iris (01544M / 5-in-1) Weather Station & Web Platform — Architecture & Implementation Plan

## 1. Project Overview & Goals
Build a fast, self-hosted, professional personal weather station platform that captures live telemetry from an **AcuRite Iris 5-in-1 Weather Station ([Model 01544M / 06101M Direct-to-Wi-Fi Display](https://device.report/acurite/01544))**, stores historical telemetry in a lightweight local **SQLite (WAL mode)** database on a **Synology DS224+ NAS** with **3-hour RAM-batched disk writes**, and displays live and historical metrics in a **Swiss Minimalist (Braun / Linear-inspired)** responsive web app.

### Key Priorities
1. **Hardware-Free Primary Ingestion (Zero RTL-SDR or Raspberry Pi Required):**
   - **Mode 1 — Local Wi-Fi Display DNS Intercept (Primary, Zero Extra Hardware):** The included **[AcuRite 06101M Direct-to-Wi-Fi Display](https://www.acurite.com/products/acurite-iris-direct-to-wi-fi-display)** already receives the `433.92 MHz` signal from the outdoor 5-in-1 sensor and transmits HTTP GET updates formatted for `rtupdate.wunderground.com` over home Wi-Fi. By pointing `rtupdate.wunderground.com` to the **Synology DS224+ local LAN IP** via local DNS (using dummy station credentials entered in the display's `192.168.4.1` setup page—no Weather Underground account required), the NAS web app captures every update 100% locally.
   - **Mode 2 & 3 — Built-In RTL-SDR Fallback Support (All-on-NAS or Pi Split):** The web app also exposes `POST /api/ingest` so an RTL-SDR dongle (`rtl_433`) plugged into either the Synology DS224+ or the Raspberry Pi 3 Model B v1.2 can be used at any time without changing a single line of application code.
2. **Outdoor Telemetry Focus + Derived Metrics:** Focus on outdoor metrics transmitted by the AcuRite 5-in-1 (`Temperature`, `Humidity`, `Rainfall`, `Wind Speed`, `Wind Direction`—plus optional `Barometric Pressure` provided for free by the 06101M display during Wi-Fi intercept) alongside rich server-computed derived metrics (`Feels Like`, `Heat Index`, `Wind Chill`, `Dew Point`, `Comfort Level`, `Rain Rate (in/hr)`, `Storm/Daily/Monthly/Yearly Rain`, `Wind Gust`, `Wind Lull`).
3. **Visual Hierarchy:** **Temperature** and **Rainfall** cards and synchronized time-series graphs take primary visual prominence. **Wind** (including a real-time **Wind Rose & Compass** polar chart) and station health occupy the secondary tier.
4. **Zero-Wakeup 3-Hour RAM Batching:** The **SvelteKit (TypeScript + Node.js)** container on the Synology DS224+ holds incoming readings in RAM and flushes to the **SQLite WAL** database only once every **3 hours** (configurable via `FLUSH_INTERVAL_HOURS=3`) so NAS hard drives can hibernate uninterrupted.
5. **External Access & Security:** Hosted behind the Synology DS224+ built-in **DDNS + Reverse Proxy (HTTPS Port 443)** and protected by an in-app **numeric PIN lock screen** with 90-day `HttpOnly` session cookies.

## 2. System Architecture & Ingestion Modes

### Mode 1 (Primary & Recommended): Hardware-Free Local Wi-Fi Display DNS Intercept
*Requires **zero extra hardware**—no RTL-SDR dongle, no Raspberry Pi, and no Weather Underground account.*

```text
[ AcuRite 5-in-1 Outdoor Sensor ]
       │ (433.92 MHz RF — received natively by indoor display)
       ▼
[ AcuRite 01544M / 06101M Direct-to-Wi-Fi Indoor Display ]
       │ Configured via http://192.168.4.1 with home 2.4 GHz Wi-Fi
       │ + Dummy WU ID ("LOCAL1") & Key ("12345")
       │ Sends HTTP GET /weatherstation/updateweatherstation.php?...
       ▼
[ Local DNS Override (Router DNS, Pi-hole, or Synology DNS Server) ]
       │ Resolves rtupdate.wunderground.com ──► Synology DS224+ LAN IP
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Synology DS224+ NAS (Container Manager — Single Container!)      │
│  ├─ External Access: DSM Reverse Proxy (HTTPS :443 -> HTTP :3000)│
│  ├─ Display Intercept: Port 80 (or DSM Reverse Proxy) -> :3000   │
│  └─ weather-web container (SvelteKit + TypeScript + Node.js)     │
│      ├─ GET /weatherstation/updateweatherstation.php (WU Parser) │
│      ├─ POST /api/ingest (RTL-SDR JSON Parser — ready anytime)   │
│      ├─ PIN Auth Gate (/unlock -> 90d HttpOnly Cookie)           │
│      ├─ SSE Real-Time Broadcaster (GET /api/stream)              │
│      ├─ 3-Hour In-Memory Ring Buffer (Zero Disk Wakeups)         │
│      ├─ Batch Flusher (Every 3h + on SIGTERM/SIGINT)             │
│      └─ SQLite WAL Database (/app/data/weather.db)               │
│          ├─ readings_raw (raw resolution)                        │
│          ├─ readings_5m  (5-minute rollups)                      │
│          └─ readings_1h  (1-hour rollups)                        │
└──────────────────────────────────────────────────────────────────┘
```

### Mode 2 & Mode 3 (Optional RTL-SDR Alternatives): All-on-NAS or Split Pi 3B
If you ever prefer raw 18-second `433.92 MHz` radio decoding via an RTL-SDR USB dongle instead of the Wi-Fi display intercept:
- **Mode 2 (All-on-NAS RTL-SDR):** Plug the RTL-SDR into the Synology DS224+ USB port, add the 1-line DSM Task Scheduler boot script (`chmod -R 666 /dev/bus/usb`), and run `docker-compose.all-on-nas.yml`.
- **Mode 3 (Split Pi 3B + NAS):** Plug the RTL-SDR into the Raspberry Pi 3 Model B v1.2 (`pi-ingest/docker-compose.yml`), which deduplicates packets, caches a 6-hour backup spool in `/dev/shm` RAM disk, and POSTs JSON to `weather-web` on the DS224+.

## 3. Dual Ingestion Protocol Specification

The `weather-web` backend implements **both** ingestion routes out of the box and normalizes them into the exact same internal `RawWeatherReading` structure before running derived meteorological math.

### 3.1 Route A: Local Wi-Fi Display Intercept (`GET` & `POST /weatherstation/updateweatherstation.php`)
When the AcuRite `01544M` / `06101M` display is pointed at the NAS via DNS override for `rtupdate.wunderground.com`, it sends standard query parameters:
- **Example Request from Display:**
  ```http
  GET /weatherstation/updateweatherstation.php?ID=LOCAL1&PASSWORD=12345&dateutc=now&winddir=225&windspeedmph=8.5&humidity=61&tempf=68.4&rainin=0.12&dailyrainin=0.42&baromin=29.92&indoortempf=71.2&indoorhumidity=45&softwaretype=AcuRite&action=updateraw&realtime=1&rtfreq=36 HTTP/1.1
  Host: rtupdate.wunderground.com
  ```
- **Parser & Response Rules:**
  1. Extract `tempf` ($\rightarrow$ `temp_f`), `humidity` ($\rightarrow$ `humidity`), `windspeedmph` ($\rightarrow$ `wind_speed_mph`), `winddir` ($\rightarrow$ `wind_dir_deg`), `dailyrainin` / `rainin`, and `baromin` (optional barometric pressure in $\text{inHg}$).
  2. Ignore indoor fields (`indoortempf`, `indoorhumidity`) to keep the dashboard strictly focused on outdoor weather.
  3. Always use the **NAS server's current Unix timestamp** (`Math.floor(Date.now() / 1000)`) rather than trusting `dateutc` from the display.
  4. Immediately return HTTP `200 OK` with body `success\n` (`Content-Type: text/plain`) so the AcuRite display's Wi-Fi status indicator stays solid.

### 3.2 Route B: RTL-SDR `rtl_433` Ingestion (`POST /api/ingest`)
- Authenticates via `X-Ingest-Key: <INGEST_API_KEY>` header.
- If using an RTL-SDR with `pi-relay`, `pi-relay` deduplicates the 3x burst repeats from `rtl_433` (protocol `-R 40`) within a 3-second window, merges alternating `message_type: 49` (Wind Speed, Wind Direction, Cumulative Rain Counter) and `message_type: 56` (Wind Speed, Outdoor Temp, Outdoor Humidity) frames, spools the last 6 hours in `/dev/shm/weather_spool.json`, and POSTs unified JSON to `/api/ingest`.

## 4. Meteorological & Derived Metric Formulas (`/nas-webapp`)

All derived metrics are calculated server-side inside `nas-webapp/src/lib/server/meteorology.ts` upon ingestion before entering the RAM ring buffer:

### 4.1 Temperature & Comfort (Primary Priority)
- **Raw Outdoor Temperature ($T$ in $^\circ\text{F}$):** Direct from display `tempf` or `rtl_433` `temperature_F`.
- **Temperature Trend ($\Delta^\circ\text{F}/\text{hr}$):** Difference between current $T$ and the reading closest to 60 minutes prior in the 24-hour RAM cache.
- **Wind Chill ($^\circ\text{F}$):** Applied when $T \le 50^\circ\text{F}$ and sustained wind speed $V \ge 3\text{ mph}$:
  $$\text{WC} = 35.74 + 0.6215T - 35.75(V^{0.16}) + 0.4275T(V^{0.16})$$
- **Heat Index ($^\circ\text{F}$):** Applied when $T \ge 80^\circ\text{F}$ using the NWS Rothfusz regression with standard low/high relative humidity ($RH$) adjustments.
- **Feels Like ($^\circ\text{F}$):**
  - If $T \le 50^\circ\text{F}$ and $V \ge 3\text{ mph}$ $\rightarrow \text{Wind Chill}$
  - Else if $T \ge 80^\circ\text{F}$ $\rightarrow \text{Heat Index}$
  - Else $\rightarrow T$
- **Dew Point ($^\circ\text{F}$):** Calculated via Magnus-Tetens formula ($a = 17.625, b = 243.04^\circ\text{C}$):
  $$\gamma(T_C, RH) = \ln\left(\frac{RH}{100}\right) + \frac{a \cdot T_C}{b + T_C}, \quad T_{\text{dew},C} = \frac{b \cdot \gamma(T_C, RH)}{a - \gamma(T_C, RH)}$$
- **Humidity Comfort Badge:** Based on Dew Point ($<50^\circ\text{F}$: `Crisp`, $50\text{–}59^\circ\text{F}$: `Comfortable`, $60\text{–}64^\circ\text{F}$: `Slightly Humid`, $65\text{–}69^\circ\text{F}$: `Muggy`, $\ge 70^\circ\text{F}$: `Oppressive`).

### 4.2 Rainfall & Rate (Primary Priority)
- **Delta Calculation (`rain_delta_in`):**
  - Tracks incremental tips (`0.01 in` per bucket tip) from either `dailyrainin` (Wi-Fi display counter, which resets at midnight) or `rain_in` (`rtl_433` cumulative counter).
  - If the incoming counter is greater than or equal to the previous counter and the delta is $< 2.0\text{ in}$: `rain_delta_in = current_counter - last_counter`.
  - If `current_counter < last_counter` (midnight reset on the Wi-Fi display or battery replacement on the sensor): set `rain_delta_in = current_counter` (if $0 < \text{current\_counter} \le 0.05$) or `0`, and update `last_counter = current_counter` so negative rain spikes never occur.
- **Instant & Rolling Rain Rate ($\text{in/hr}$):**
  - Maintain a sliding 15-minute window of tip timestamps in RAM.
  - $\text{Rain Rate} = (\text{Sum of } \text{rain\_delta\_in} \text{ in last 15 min}) \times 4$ (or direct `rainin` from the Wi-Fi display if higher during an active downpour), decaying smoothly to `0.00 in/hr` after 15 minutes without a tip.
- **Accumulation Totals:**
  - **Today:** Midnight local time to present.
  - **Last 24h:** Rolling 24-hour sum.
  - **Storm Total:** Continuous rain event sum; resets after 12 consecutive hours with `0.00 in` of rain.
  - **Monthly & Yearly Totals:** Aggregated from `readings_1h` + current RAM buffer.

### 4.3 Wind & Polar Wind Rose (Secondary Priority)
- **Wind Speed (`wind_speed_mph`):** Latest reading.
- **Sustained Wind (`wind_sustained_mph`):** Rolling 2-minute average.
- **Wind Gust (`wind_gust_mph`):** Peak reading in the last 10 minutes.
- **Wind Lull (`wind_lull_mph`):** Minimum reading in the last 10 minutes.
- **Wind Direction (`wind_dir_deg` & Cardinal):** Mapped to 16 compass sectors (`N`, `NNE`, `NE`, `ENE`, `E`, `ESE`, `SE`, `SSE`, `S`, `SSW`, `SW`, `WSW`, `W`, `WNW`, `NW`, `NNW`) and aggregated into speed-tier frequency buckets (`<5 mph`, `5–10 mph`, `10–20 mph`, `20+ mph`) for the polar Wind Rose chart.

## 5. Database Design, 3-Hour Batching & Smart Decimation

### 5.1 3-Hour RAM Ring-Buffer & Batch Flush Lifecycle
- **Why:** Prevents continuous hard drive writes so Synology DS224+ drives can enter deep hibernation for 2.5+ hours at a stretch.
- **In-Memory Store:**
  - `unflushedQueue`: Array of raw readings collected since the last SQLite flush (~300–600 objects per 3 hours, $<100\text{ KB}$ RAM).
  - `recentCache24h`: Sliding 24-hour cache in RAM (populated once from SQLite at container startup and updated live) so opening the web dashboard for `Live`, `1H`, `6H`, or `24H` views serves **100% from RAM with zero disk reads**.
- **Flush Triggers:**
  1. **Timer Trigger:** Every `FLUSH_INTERVAL_HOURS` (default `3` hours).
  2. **Manual Trigger:** Clicking **"Flush Buffer Now"** in the UI status bar (`POST /api/admin/flush`).
  3. **Graceful Shutdown Trigger:** Process listeners on `SIGTERM`, `SIGINT`, and `SIGHUP` immediately execute a synchronous `better-sqlite3` batch transaction before the container exits.

### 5.2 SQLite Schema (`/app/data/weather.db`)
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;

-- 1. Raw readings (retained for 30 days by default, configurable)
CREATE TABLE IF NOT EXISTS readings_raw (
  timestamp INTEGER PRIMARY KEY, -- Unix epoch seconds
  temp_f REAL NOT NULL,
  feels_like_f REAL NOT NULL,
  dew_point_f REAL NOT NULL,
  humidity INTEGER NOT NULL,
  rain_delta_in REAL NOT NULL DEFAULT 0,
  rain_rate_in_hr REAL NOT NULL DEFAULT 0,
  wind_speed_mph REAL NOT NULL,
  wind_dir_deg REAL,
  barom_in_hg REAL,              -- Populated automatically when using Wi-Fi Display Intercept
  battery_ok INTEGER DEFAULT 1,
  source TEXT DEFAULT 'wifi_intercept'
);

-- 2. 5-Minute Rollups (retained for 1 year)
CREATE TABLE IF NOT EXISTS readings_5m (
  bucket_ts INTEGER PRIMARY KEY, -- Start of 5-min window (unix epoch)
  temp_avg REAL,
  temp_min REAL,
  temp_max REAL,
  feels_avg REAL,
  feels_min REAL,
  feels_max REAL,
  dew_avg REAL,
  humidity_avg REAL,
  rain_sum_in REAL,
  rain_rate_max_in_hr REAL,
  wind_avg_mph REAL,
  wind_gust_mph REAL,
  wind_lull_mph REAL,
  wind_dir_deg_dominant REAL,
  barom_avg_in_hg REAL,
  sample_count INTEGER
);

-- 3. 1-Hour Rollups (retained indefinitely)
CREATE TABLE IF NOT EXISTS readings_1h (
  bucket_ts INTEGER PRIMARY KEY, -- Start of 1-hour window (unix epoch)
  temp_avg REAL,
  temp_min REAL,
  temp_max REAL,
  feels_avg REAL,
  feels_min REAL,
  feels_max REAL,
  dew_avg REAL,
  humidity_avg REAL,
  rain_sum_in REAL,
  rain_rate_max_in_hr REAL,
  wind_avg_mph REAL,
  wind_gust_mph REAL,
  wind_lull_mph REAL,
  wind_dir_deg_dominant REAL,
  barom_avg_in_hg REAL,
  sample_count INTEGER
);
```

### 5.3 Automatic Timeframe Decimation Routing (`GET /api/history`)
Every graph query automatically selects the optimal data source and resolution so the browser never renders more than ~300–1,200 points:

| Selected Timeframe | Resolution / Bucket | Data Source | Typical Point Count |
| :--- | :--- | :--- | :--- |
| **`1H` (Live)** | Raw (`18s–36s`) | `recentCache24h` (RAM only) | 100–200 pts |
| **`6H`** | `1m` avg (or Raw) | `recentCache24h` (RAM only) | ~360 pts |
| **`24H`** | `5m` rollup | `recentCache24h` (RAM only) | 288 pts |
| **`7D`** | `15m` (from `readings_5m`) | SQLite `readings_5m` + RAM buffer | 672 pts |
| **`30D`** | `1h` rollup | SQLite `readings_1h` + RAM buffer | 720 pts |
| **`1Y`** | `6h` or `1d` rollup | SQLite `readings_1h` + RAM buffer | 365–1,460 pts |
| **`Custom Range`** | Auto-scaled ($\le 48\text{h} \rightarrow 5\text{m}$; $\le 60\text{d} \rightarrow 1\text{h}$; $>60\text{d} \rightarrow 1\text{d}$) | SQLite + RAM buffer | 300–1,000 pts |

## 6. UI/UX Specification — Swiss Minimalist Instrument (Vibe 2)

### 6.1 Design System & Typography
- **Framework:** SvelteKit + Tailwind CSS + Apache ECharts (Canvas renderer for 60fps mobile zoom/pan and polar wind rose).
- **Typography:**
  - UI Labels & Headers: `Inter` or `Plus Jakarta Sans` (clean geometric sans-serif, uppercase tracking for micro-labels).
  - Numeric Telemetry: `JetBrains Mono` with `font-variant-numeric: tabular-nums` so live-ticking numbers never shift layout width.
- **Themes:** Crisp **Swiss Light Mode** (`#F8FAFC` background, `#FFFFFF` cards, `#E2E8F0` hairline `1px` borders, `#0F172A` ink) and **Slate Dark Mode** (`#090D16` background, `#111827` cards, `#1E293B` hairline borders, `#F8FAFC` ink), persisted in `localStorage`.
- **Unit Switcher:** Instant toggle in the header between **Imperial (`°F`, `in`, `in/hr`, `mph`, `inHg`)** and **Metric (`°C`, `mm`, `mm/hr`, `km/h`, `hPa`)**.

### 6.2 Layout & Visual Hierarchy (Desktop Bento Grid & Mobile Stack)

#### Header Bar
- Station Title + Live Pulse Indicator (`● LIVE · Updated 12s ago`).
- Buffer Status Pill (`RAM Buffer: 64 pts · Next DB flush in 2h 14m` + manual flush icon).
- Unit Toggle (`°F / °C`) & Theme Toggle (`Light / Dark`).

#### Tier 1: Hero Cards — Temperature & Rainfall (Top Priority, 12-Column Grid)
1. **Temperature & Comfort Hero Card (7 Columns Desktop / Full Width Mobile):**
   - Giant `JetBrains Mono` primary readout for **Outdoor Temp** (e.g., `68.4°F`) with 1-hour trend pill (`↑ +1.4°/hr`) and Today's High/Low (`H: 72.1° at 2:15 PM · L: 51.8° at 6:05 AM`).
   - Three prominent sub-blocks inside the card:
     - **Feels Like:** `66.9°F` (dynamically labeled *Wind Chill*, *Heat Index*, or *Actual*).
     - **Dew Point:** `54.2°F` with comfort badge (`Comfortable`).
     - **Outdoor Humidity:** `61%` with relative progress bar.
   - Subtle 24-hour background sparkline along the bottom edge of the card.
2. **Rainfall & Accumulation Hero Card (5 Columns Desktop / Full Width Mobile):**
   - Giant primary readout for **Today's Rain** (`0.42 in`) alongside live **Rain Rate** (`0.12 in/hr`) with an active rain-intensity badge (*Dry*, *Light Rain*, *Moderate*, *Heavy Downpour*).
   - 4-cell mini grid at the bottom of the card:
     - **Storm Total:** `0.68 in`
     - **Last 24 Hours:** `0.55 in`
     - **Month-to-Date:** `3.14 in`
     - **Year-to-Date:** `28.90 in`

#### Tier 2: Interactive Multi-Metric Time-Series Workbench (Full 12 Columns)
- **Top Control Bar:**
  - **Timeframe Pills:** `1H` · `6H` · `24H` · `7D` · `30D` · `1Y` · `Custom Date Range`
  - **Resolution Badge:** Automatically displays active decimation (e.g., `Resolution: 5m Avg`).
  - **Metric Layer Checkboxes:**
    - Primary Chart (Top/Main pane): `[x] Temperature` `[x] Feels Like` `[ ] Dew Point` `[ ] Humidity` (with shaded Min/Max range band when viewing `24H` or longer).
    - Secondary Synchronized Chart (Directly below main pane, locked to same X-axis crosshair): `[x] Rain Accumulation (Bars)` `[x] Rain Rate (Line)` or `[ ] Wind Speed & Gusts`.
- **Interactive Features:**
  - Synchronized magnetic crosshair tooltip showing exact values across all visible layers.
  - Touch pinch-to-zoom on mobile and a bottom timeline brush scrubber on desktop.

#### Tier 3: Wind Rose, Compass & Hardware Health (Secondary Priority, 12-Column Grid)
1. **Real-Time Wind Rose & Compass Card (6 Columns Desktop / Full Width Mobile):**
   - Dual-mode polar visualization:
     - **Outer Ring:** Live rotating compass needle pointing to the latest `wind_dir_deg`.
     - **Inner Polar Plot:** 16-sector Wind Rose showing directional frequency petals stacked by speed tiers over the currently selected timeframe.
   - Compact side stats: **Current Speed (`8.5 mph NNE`)**, **2m Sustained (`7.2 mph`)**, **10m Gust (`16.4 mph`)**, and **10m Lull (`3.1 mph`)**.
2. **Sensor & System Telemetry Card (6 Columns Desktop / Full Width Mobile):**
   - **Ingestion Source Status:** Active mode badge (`Wi-Fi Display Direct Intercept` or `RTL-SDR 433.92 MHz`), Barometric Pressure (`29.92 inHg` if present), and Last Packet Timestamp.
   - **Storage & Batch Engine:** Total rows in SQLite, database file size (`MB`), current RAM queue count, last flush timestamp, and a **"Flush to Disk Now"** action button.

## 7. Step-by-Step Setup Guides (Wi-Fi Display Intercept, Security & Synology)

### 7.1 Mode 1 Setup: Redirecting Your AcuRite 01544M / 06101M Wi-Fi Display to the DS224+ (No RTL-SDR Needed)
1. **Point the Display to Your Home Wi-Fi with Dummy WU Credentials:**
   - Press the **Gear / SET** button on your AcuRite `06101M` indoor display to activate its temporary Wi-Fi setup network (or power-cycle the display; the setup AP stays open for 30 minutes).
   - On your phone or laptop, connect to the Wi-Fi network named after your AcuRite display and open `http://192.168.4.1` in your browser.
   - Select your **2.4 GHz home Wi-Fi SSID**, enter your Wi-Fi password, and enter any dummy strings for **Weather Underground Station ID** (e.g., `LOCAL1`) and **Station Key** (e.g., `12345`), then click **Save**.
2. **Point `rtupdate.wunderground.com` to Your Synology DS224+ Local IP:**
   - **Option 1A (Via Router / Pi-hole / AdGuard Home):** If your router or local DNS blocker supports Custom DNS Hostnames, map `rtupdate.wunderground.com` $\rightarrow$ `192.168.1.XXX` (your DS224+ LAN IP).
   - **Option 1B (Using Synology's "DNS Server" Package on DSM 7):**
     1. In **DNS Server → Resolution**, check **Enable resolution services** and **Enable forwarders** (`1.1.1.1` and `8.8.8.8`, policy: `Forward first`) and click **Apply**.
     2. In **DNS Server → Zones**, click **Create → Primary zone** *(DSM 7 calls this "Primary zone", not "Master zone")*:
        - **Domain type:** `Forward zone`
        - **Domain name:** `rtupdate.wunderground.com`
        - **Primary DNS server:** `<YOUR_NAS_LAN_IP>`
     3. Double-click the new `rtupdate.wunderground.com` zone (or click **Edit → Resource record**), click **Create → A Type**, leave **Name** completely blank, and set **IP address** to `<YOUR_NAS_LAN_IP>`.
     4. Point your router's DHCP Primary DNS to `<YOUR_NAS_LAN_IP>`.
3. **Route Port 80 from the Display to Port 3000 on the NAS:**
   - In DSM **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:
     - **Description:** `AcuRite Local Intercept`
     - **Source:** Protocol: `HTTP`, Hostname: `rtupdate.wunderground.com`, Port: `80`.
     - **Destination:** Protocol: `HTTP`, Hostname: `localhost`, Port: `3000`.
   - Now every update from the display hits `http://rtupdate.wunderground.com/weatherstation/updateweatherstation.php` on your DS224+ and flows straight into `weather-web`!

### 7.2 PIN Lock Screen (`/unlock`) & Public API Exemption
- **Browser Routes Protected by PIN:** Any request to `/`, `/api/history`, `/api/stream`, or `/api/admin/*` without a valid signed session cookie is redirected to `/unlock` (4–8 digit numeric keypad verified against `DASHBOARD_PIN` with 5-attempt/15-min IP rate limiting and a 90-day `HttpOnly; Secure; SameSite=Strict` cookie).
- **Local Display Route Exempt from Browser Cookie:** Requests to `/weatherstation/updateweatherstation.php` validate that the query parameter `PASSWORD` matches `WU_INTERCEPT_KEY` (default `12345`) or originates from your local `192.168.x.x` / `10.x.x.x` subnet so the display can push updates unattended 24/7.

### 7.3 Synology DS224+ External HTTPS Reverse Proxy & DDNS Setup
1. **Enable Synology DDNS:**
   - Open DSM **Control Panel → External Access → DDNS → Add**.
   - Select **Synology**, choose your hostname (e.g., `myweather.synology.me`), and check **Get a certificate from Let's Encrypt and set it as default**.
2. **Configure External HTTPS Reverse Proxy:**
   - Open **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:
     - **Description:** `Weather Station External HTTPS`
     - **Source:** Protocol: `HTTPS`, Hostname: `myweather.synology.me`, Port: `443`, Check **Enable HSTS**.
     - **Destination:** Protocol: `HTTP`, Hostname: `localhost`, Port: `3000`.
     - **Custom Header Tab:** Click **Create → WebSocket** so live SSE/WebSocket updates stream cleanly.
3. **Router Port Forwarding:**
   - Forward external TCP port `443` on your router to the internal LAN IP of your Synology DS224+.

### 7.4 Optional: Synology DSM 7 USB Permission Setup (Only If Using an RTL-SDR on the NAS)
If you ever plug an RTL-SDR USB dongle directly into the DS224+, add this 1-line **Boot-up Triggered Task** in DSM (**Control Panel → Task Scheduler → Create → Triggered Task → User-defined script**, User: `root`, Event: `Boot-up`):
```bash
chmod -R 666 /dev/bus/usb && rmmod dvb_usb_rtl28xxu rtl2832 2>/dev/null || true
```

## 8. Repository Structure & Deployment Configurations

```text
weather-station/
├── docker-compose.yml            # Mode 1 (Primary): Hardware-Free Single Container on DS224+
├── docker-compose.all-on-nas.yml # Mode 2 (Optional): RTL-SDR plugged into DS224+
├── pi-ingest/                    # Mode 3 (Optional): RTL-SDR on Raspberry Pi 3 Model B v1.2
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── relay.js                  # Packet deduplicator, merger, /dev/shm spooler & HTTP forwarder
└── nas-webapp/                   # Main SvelteKit + TypeScript + SQLite WAL Application
    ├── Dockerfile
    ├── package.json
    ├── svelte.config.js
    ├── tailwind.config.js
    └── src/
        ├── lib/
        │   ├── server/
        │   │   ├── db.ts           # SQLite WAL schema, rollup queries & decimation router
        │   │   ├── buffer.ts       # 3-hour RAM ring buffer, 24h RAM cache & SIGTERM flusher
        │   │   ├── meteorology.ts  # Feels Like, Wind Chill, Heat Index, Dew Point, Rain Rate
        │   │   ├── sse.ts          # Server-Sent Events live broadcaster
        │   │   └── auth.ts         # PIN verification, HMAC session cookies & rate limiter
        │   └── components/
        │       ├── TempHeroCard.svelte
        │       ├── RainHeroCard.svelte
        │       ├── TelemetryChart.svelte
        │       ├── WindRoseCard.svelte
        │       └── SystemHealthCard.svelte
        └── routes/
            ├── +page.svelte        # Main Swiss Minimalist dashboard
            ├── unlock/+page.svelte # PIN keypad screen
            ├── weatherstation/
            │   └── updateweatherstation.php/
            │       └── +server.ts  # Mode 1: Direct AcuRite 01544M/06101M Wi-Fi Display Intercept
            └── api/
                ├── ingest/+server.ts      # Mode 2/3: RTL-SDR JSON ingest endpoint
                ├── stream/+server.ts      # Real-time SSE stream for browser clients
                ├── history/+server.ts     # Auto-decimated historical query endpoint
                └── admin/flush/+server.ts # Manual RAM-to-SQLite flush trigger
```

### 8.1 Mode 1 (Primary — Hardware-Free Wi-Fi Display Intercept): `docker-compose.yml` on Synology DS224+
```yaml
services:
  weather-web:
    build: ./nas-webapp
    container_name: weather-web
    restart: unless-stopped
    stop_grace_period: 30s
    ports:
      - "3000:3000"
    volumes:
      - /volume1/docker/weather-station/data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DB_PATH=/app/data/weather.db
      - DASHBOARD_PIN=123456
      - SESSION_SECRET=replace_with_32_char_random_hex
      - WU_INTERCEPT_KEY=12345
      - INGEST_API_KEY=replace_with_long_random_secret
      - FLUSH_INTERVAL_HOURS=3
      - TZ=America/New_York
```

### 8.2 Mode 2 (Optional — RTL-SDR Plugged Directly Into DS224+): `docker-compose.all-on-nas.yml`
```yaml
services:
  rtl_433:
    image: hertzg/rtl_433:latest
    container_name: rtl_433
    restart: unless-stopped
    privileged: true
    devices:
      - /dev/bus/usb:/dev/bus/usb
    command: >
      -f 433.92M
      -R 40
      -F syslog:pi-relay:1514
      -M time:unix:usec:utc
      -M level

  pi-relay:
    build: ./pi-ingest
    container_name: pi-relay
    restart: unless-stopped
    depends_on:
      - rtl_433
    volumes:
      - /dev/shm:/dev/shm
    environment:
      - NAS_INGEST_URL=http://weather-web:3000/api/ingest
      - INGEST_API_KEY=replace_with_long_random_secret
      - SPOOL_FILE=/dev/shm/weather_spool.json
      - SPOOL_MAX_HOURS=6

  weather-web:
    build: ./nas-webapp
    container_name: weather-web
    restart: unless-stopped
    stop_grace_period: 30s
    depends_on:
      - pi-relay
    ports:
      - "3000:3000"
    volumes:
      - /volume1/docker/weather-station/data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DB_PATH=/app/data/weather.db
      - DASHBOARD_PIN=123456
      - SESSION_SECRET=replace_with_32_char_random_hex
      - WU_INTERCEPT_KEY=12345
      - INGEST_API_KEY=replace_with_long_random_secret
      - FLUSH_INTERVAL_HOURS=3
      - PI_BACKFILL_URL=http://pi-relay:3001/spool
      - TZ=America/New_York
```

## 9. Acceptance Criteria Checklist for Implementation Worker
- [ ] **Hardware-Free Wi-Fi Display Intercept (`/weatherstation/updateweatherstation.php`):** Parses `GET` and `POST` query strings from the AcuRite `01544M`/`06101M` display (`tempf`, `humidity`, `windspeedmph`, `winddir`, `rainin`, `dailyrainin`, `baromin`), ignores indoor temp/humidity, and responds with `200 OK` (`success\n`).
- [ ] **RTL-SDR Fallback Support (`/api/ingest` + `pi-relay`):** Retains full support for `rtl_433` packet deduplication, alternating `msg_type 49`/`56` merging, and `/dev/shm` spooling if an RTL-SDR is ever used.
- [ ] **Zero-Spike Rain Counter:** Rain delta logic handles both midnight resets (`dailyrainin` from the Wi-Fi display) and battery replacements (`rain_in` from `rtl_433`) without creating negative rain spikes.
- [ ] **3-Hour RAM Batching & Zero Disk Wakeups:** Viewing the live dashboard (`Live`, `1H`, `6H`, `24H`) reads strictly from the DS224+ in-memory cache without touching SQLite; disk writes happen only once every `FLUSH_INTERVAL_HOURS` (default `3`) or on graceful container shutdown (`SIGTERM`).
- [ ] **Meteorological Accuracy:** Server computes accurate NWS Wind Chill, Rothfusz Heat Index, Magnus-Tetens Dew Point, and 15-minute rolling Rain Rate (`in/hr`).
- [ ] **Swiss Minimalist UI Hierarchy:** Temperature and Rainfall hero cards and synchronized graphs dominate Tiers 1 and 2; Wind Rose/Compass and hardware status sit cleanly in Tier 3.
- [ ] **60fps Responsive Graphs:** Timeframe selector (`1H`, `6H`, `24H`, `7D`, `30D`, `1Y`, `Custom`) automatically queries the matching rollup table (`raw`, `5m`, `1h`) and displays the active decimation badge.
- [ ] **PIN Security:** Unauthenticated browser users are routed to `/unlock` with brute-force rate limiting and 90-day `HttpOnly` session cookies upon unlock, while `/weatherstation/updateweatherstation.php` remains accessible to the display on the LAN.
