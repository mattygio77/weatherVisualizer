# AcuRite Iris (5-in-1) Weather Station & Self-Hosted Web Platform

A fast, self-hosted personal weather station platform designed for the **AcuRite Iris (Model 01544M / 5-in-1)** weather sensor. Features zero-cloud local ingestion, **3-hour RAM-batched disk writes** to allow NAS hard drives to hibernate undisturbed, an embedded **SQLite WAL** database with automatic downsampling rollups, and a responsive **Swiss Minimalist (Braun / Linear-inspired)** web dashboard with real-time Server-Sent Events (SSE).

---

## Key Features

- **Dual-Mode Local Ingestion (Zero Cloud Dependencies):**
  - **Mode 2 (Direct RTL-SDR Radio Decoding):** Plugs an RTL-SDR USB dongle directly into your host machine / Synology NAS to decode native `433.92 MHz` radio packets via `rtl_433` every 18 seconds.
  - **Mode 1 (Local Wi-Fi Display Intercept):** Uses the stock AcuRite 06101M Direct-to-Wi-Fi display and a local DNS override (`rtupdate.wunderground.com` $\rightarrow$ host IP) to capture telemetry 100% locally with zero extra hardware.
- **NAS Drive Hibernation Support (3-Hour RAM Batching):** Incoming telemetry is held in a RAM ring-buffer and committed to SQLite WAL only once every 3 hours (configurable via `FLUSH_INTERVAL_HOURS`). Browsing `Live`, `1H`, `6H`, and `24H` views reads directly from memory with **zero disk wakeups**.
- **Packet Deduplication & Frame Merging:** The ingestion relay filters out the 3x transmission burst repeats sent by the AcuRite 5-in-1 sensor and unifies alternating Message `49` (wind speed, wind direction, rain counter) and Message `56` (wind speed, temperature, humidity) frames into cohesive observations.
- **Derived Meteorological Math:** Real-time computation of:
  - **Feels Like**, NWS **Wind Chill** ($T \le 50^\circ\text{F}, V \ge 3\text{ mph}$), and Rothfusz **Heat Index** ($T \ge 80^\circ\text{F}$)
  - Magnus-Tetens **Dew Point** and Humidity Comfort Badges (*Crisp*, *Comfortable*, *Muggy*, *Oppressive*)
  - Rolling 2-minute sustained wind, 10-minute peak gust, and 10-minute lull
  - Rolling 15-minute rain rate ($\text{in/hr}$ or $\text{mm/h}$) and zero-spike protection against midnight resets and battery swaps
  - Today, Storm, 24-Hour, Monthly, and Yearly rainfall accumulation
- **Swiss Minimalist Instrument UI:**
  - **Tier 1:** Temperature hero card with 24h trend sparkline and Rainfall hero card with 4-cell accumulation grid.
  - **Tier 2:** Interactive multi-metric time-series workbench powered by Apache ECharts (Canvas) with magnetic crosshairs, touch zoom/scrubbing, and layer toggles.
  - **Tier 3:** 16-sector polar Wind Rose compass and System & Storage health card.
  - **Toggles:** Instant switching between Imperial (`°F`, `in`, `mph`, `inHg`) and Metric (`°C`, `mm`, `km/h`, `hPa`), and Swiss Light (`#F8FAFC`) / Slate Dark (`#090D16`) themes.
- **Built-in Security:** In-app numeric PIN lock screen (`/unlock`) with 5-attempt brute-force lockout and 90-day HMAC `HttpOnly` session cookies.

---

## Hardware Requirements

| Component | Required / Optional | Description |
| :--- | :--- | :--- |
| **Outdoor Sensor** | **Required** | **AcuRite Iris (5-in-1)** outdoor sensor (Model 01544, 06004RM, 06014RM, or VN1TX). Transmits temperature, humidity, wind speed, wind direction, and rainfall on 433.92 MHz. |
| **Host System** | **Required** | **Synology NAS** (e.g. DS224+, DS720+, DS920+, or any x86_64/ARM64 model running DSM 7 with Container Manager / Docker), Raspberry Pi (3B, 4, 5), or any standard Linux/Docker host. |
| **RTL-SDR USB Dongle** | **Required for Mode 2** | Any RTL2832U-based USB tuner (e.g., RTL-SDR Blog V3/V4, Nooelec NESDR, or generic DVB-T USB sticks). |
| **Indoor Display** | **Optional (Mode 1)** | AcuRite 01544M / 06101M Direct-to-Wi-Fi display (used if capturing via local Wi-Fi DNS intercept instead of RTL-SDR). |

---

## How It Works

### Architecture Diagram (Mode 2 — RTL-SDR on NAS)

```text
[ AcuRite 5-in-1 Outdoor Sensor ]
       │ (433.92 MHz RF — 18-second broadcast interval)
       ▼
[ RTL-SDR USB Dongle ] (/dev/bus/usb)
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Docker / Container Manager Host (e.g., Synology NAS)             │
│                                                                  │
│  ├─ rtl_433 container (hertzg/rtl_433)                          │
│  │   └─ Listens on 433.92 MHz, protocol -R 40                   │
│  │   └─ Outputs JSON stream over syslog UDP :1514                │
│  │                                                               │
│  ├─ pi-relay container (Node.js relay service)                  │
│  │   ├─ Deduplicates 3x burst repeats                            │
│  │   ├─ Merges alternating msg 49 (wind/rain) & 56 (temp/hum)    │
│  │   ├─ Spools 6 hours of observations in RAM (/dev/shm)         │
│  │   └─ POSTs unified JSON payload to http://weather-web:3000   │
│  │                                                               │
│  └─ weather-web container (SvelteKit + TypeScript + Node.js)     │
│      ├─ POST /api/ingest (RTL-SDR Ingest Handler)                │
│      ├─ GET /weatherstation/updateweatherstation.php (Mode 1)    │
│      ├─ Meteorology Engine (Dew Point, Feels Like, Rain Rates)   │
│      ├─ Real-Time SSE Broadcaster (GET /api/stream)              │
│      ├─ 3-Hour RAM Ring-Buffer (Zero Disk Wakeups)               │
│      ├─ Auto-Decimated Historical Queries (GET /api/history)     │
│      └─ SQLite WAL Database (/app/data/weather.db)               │
│          ├─ readings_raw (30-day retention)                      │
│          ├─ readings_5m  (1-year retention)                      │
│          └─ readings_1h  (indefinite retention)                  │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼ (Server-Sent Events + HTTP Port 3000)
[ Swiss Minimalist Web Dashboard ] (Browser / Phone / Tablet)
```

### Ingestion & Data Flow

1. **Radio Reception:** The outdoor sensor transmits RF bursts every 18 seconds. Each transmission consists of 3 repeat packets for error resistance.
2. **Deduplication & State Merge (`pi-ingest/relay.js`):** The relay service inspects packet sequence numbers and drops redundant repeats within a 4-second sliding window. It merges alternating message types:
   - **Message 49:** Wind speed, wind direction, rain counter, battery status.
   - **Message 56:** Wind speed, outdoor temperature, outdoor humidity, battery status.
3. **RAM Buffer & Zero-Wakeup Queries (`nas-webapp/src/lib/server/buffer.ts`):** Readings are pushed to an in-memory queue. Requests for `Live`, `1H`, `6H`, and `24H` views are generated entirely from the 24-hour in-memory cache, keeping mechanical hard drives in sleep mode.
4. **Batch Flush to Disk:** Every 3 hours (or upon graceful container shutdown `SIGTERM`), the queue is committed in a single transaction to SQLite WAL mode, and 5-minute and 1-hour rollup tables are updated.

---

## Repository Structure

```text
weatherVisualizer/
├── docker-compose.all-on-nas.yml # Mode 2: RTL-SDR + pi-relay + weather-web
├── docker-compose.yml            # Mode 1: Hardware-free Wi-Fi intercept single container
├── .env.example                  # Environment configuration template
├── .gitignore                    # Public git ignore rules
├── pi-ingest/                    # RTL-SDR Ingestion Relay
│   ├── Dockerfile
│   ├── package.json
│   └── relay.js                  # Deduplication, frame merger & /dev/shm spooler
├── nas-webapp/                   # SvelteKit + TypeScript Web Application
│   ├── Dockerfile                # Multi-stage production container build
│   ├── package.json
│   ├── svelte.config.js
│   ├── tailwind.config.cjs
│   └── src/
│       ├── lib/
│       │   ├── types.ts          # Shared weather interfaces & unit formatters
│       │   ├── server/
│       │   │   ├── db.ts          # SQLite WAL schema, rollups & decimation
│       │   │   ├── buffer.ts      # 3-hour RAM buffer & 24h in-memory cache
│       │   │   ├── meteorology.ts # Meteorological calculations & rain logic
│       │   │   ├── sse.ts         # Server-Sent Events live broadcaster
│       │   │   └── auth.ts        # PIN authentication & HMAC session cookies
│       │   └── components/
│       │       ├── Header.svelte
│       │       ├── TempHeroCard.svelte
│       │       ├── RainHeroCard.svelte
│       │       ├── TelemetryChart.svelte
│       │       ├── WindRoseCard.svelte
│       │       └── SystemHealthCard.svelte
│       └── routes/
│           ├── +page.svelte       # Swiss Minimalist Dashboard
│           ├── unlock/            # PIN Keypad Screen
│           ├── weatherstation/    # Mode 1 Wi-Fi Display Intercept
│           └── api/               # Ingest, Stream, History, and Flush APIs
└── scripts/
    ├── setup_nas_usb.sh          # DSM 7 Task Scheduler USB permissions script
    ├── simulate_telemetry.js     # Pipeline test suite & mock packet generator
    └── deploy_to_nas.sh          # Automated deployment script for NAS
```

---

## Getting Started

### 1. Environment Configuration

Copy the example environment file and set your desired PIN and secrets:

```bash
cp .env.example .env
```

Key environment variables:
- `DASHBOARD_PIN`: 4–8 digit numeric PIN used to unlock the web dashboard (default: `123456`).
- `SESSION_SECRET`: Random 32+ character string used to sign session cookies.
- `INGEST_API_KEY`: Secret key shared between `pi-relay` and `weather-web`.
- `FLUSH_INTERVAL_HOURS`: Disk flush interval in hours (default: `3`).
- `TZ`: Local timezone (e.g., `America/New_York`).

---

### 2. Synology DSM 7 USB Permission Setup (Mode 2)

By default, Synology DSM 7 restricts non-root container access to USB devices and may load default DVB-T TV tuner drivers that lock the RTL-SDR.

Add a **Boot-up Task** in DSM:
1. Open **Control Panel → Task Scheduler → Create → Triggered Task → User-defined script**.
2. Set **User:** `root`, **Event:** `Boot-up`.
3. Enter the following script:
   ```bash
   chmod -R 666 /dev/bus/usb && rmmod dvb_usb_rtl28xxu rtl2832 2>/dev/null || true
   ```
4. Click **OK**, then select the task and click **Run** (or execute [`scripts/setup_nas_usb.sh`](scripts/setup_nas_usb.sh)).

---

### 3. Deploying with Docker Compose

#### Option A: Automated Script
Deploy directly from your machine to your NAS:
```bash
./scripts/deploy_to_nas.sh <NAS_IP> <NAS_USER> [PATH_TO_SSH_KEY]
```

#### Option B: Manual Docker Compose
Copy the repository to your host (e.g., `/volume1/docker/weather-station/`) and run:

```bash
# Mode 2 (All-on-NAS RTL-SDR):
docker compose -f docker-compose.all-on-nas.yml up -d --build

# Mode 1 (Wi-Fi Intercept Only):
docker compose up -d --build
```

Access the dashboard at `http://<YOUR_NAS_IP>:3000`.

---

### 4. Testing & Verification

Run the end-to-end pipeline test suite to verify packet ingestion, meteorological calculations, and RAM buffer accumulation:

```bash
node scripts/simulate_telemetry.js
```

---

## License

MIT License. Free for personal and open-source weather observation.
