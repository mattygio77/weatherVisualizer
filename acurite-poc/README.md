# AcuRite 01544M / 06101M Wi-Fi Display Packet Sniffer — Proof of Concept (PoC)

This is a **zero-dependency** single-file Python proof-of-concept (`poc_sniffer.py`) that you can run on your **Synology DS224+** (via Container Manager / Docker) to verify that your **AcuRite 01544M / 06101M Direct-to-Wi-Fi Display** sends live weather packets over your local network without needing an RTL-SDR or a real Weather Underground account.

## What It Does
1. **Captures & Prints Packets in Real Time:** Listens for incoming HTTP `GET` and `POST` requests from the AcuRite display (such as `/weatherstation/updateweatherstation.php?...`), prints all raw query parameters, calculates **Feels Like** and **Dew Point** on the fly, and replies with `success` so the display's Wi-Fi icon stays solid.
2. **Built-In Live Web Inspector (`http://<YOUR_NAS_IP>:8080/`):** Open it in any browser to see an auto-refreshing feed of captured packets—including a **1-click "⚡ Simulate AcuRite Packet" button** so you can test the parser before even configuring your display.
3. **Built-In Optional DNS Hijacker (`--dns-ip <YOUR_NAS_IP>`):** Can answer UDP port `53` DNS queries for `rtupdate.wunderground.com`, `weatherstation.wunderground.com`, `atlasapi.myacurite.com`, and `hubapi.myacurite.com` with your NAS IP while forwarding all other DNS queries to `1.1.1.1`.

---

## Step-by-Step PoC Test on Your Synology DS224+

### Step 1: Start the PoC Listener in Synology Container Manager
1. Copy the `acurite-poc` folder into your NAS `/docker` shared folder (`/volume1/docker/acurite-poc`).
2. Open **Container Manager → Project → Create**:
   - **Project name:** `acurite-poc`
   - **Path:** Select `/docker/acurite-poc` and choose **Use existing docker-compose.yml**.
3. Once started, open `http://<YOUR_NAS_IP>:8080` in your browser and click **⚡ Simulate AcuRite Packet** to confirm you see the decoded weather card appear.

### Step 2: Forward Port 80 (`rtupdate.wunderground.com`) on Your NAS to Port 8080
Because Synology DSM reserves port `80` for its own system web server, use DSM's built-in Reverse Proxy to hand `rtupdate.wunderground.com` traffic on port `80` over to your PoC container on port `8080`:
1. In DSM, go to **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**.
2. **General Settings:**
   - **Reverse Proxy Name / Description:** `AcuRite PoC Intercept`
   - **Source:**
     - **Protocol:** `HTTP`
     - **Hostname:** `rtupdate.wunderground.com`
     - **Port:** `80`
   - **Destination:**
     - **Protocol:** `HTTP`
     - **Hostname:** `localhost`
     - **Port:** `8080`
3. Click **Save**.

### Step 3: Point `rtupdate.wunderground.com` to Your NAS IP in Local DNS
Pick **one** of the three DNS methods below (do **not** run both Synology DNS Server and the Docker container's port 53 at the same time, since both use UDP port 53):

#### Method A — Using Synology's "DNS Server" Package (Exact DSM 7 Steps)
1. Open **Package Center** in DSM, search for **DNS Server**, install it, and open it.
2. **Enable Forwarders (So normal internet domains still work):**
   - Click **Resolution** in the left sidebar.
   - Check **Enable resolution services**.
   - Check **Enable forwarders**, set **Forwarder 1** to `1.1.1.1` and **Forwarder 2** to `8.8.8.8`, and set **Forward policy** to `Forward first`.
   - Click **Apply**.
3. **Create a Primary Zone for `rtupdate.wunderground.com`:**
   - Click **Zones** in the left sidebar.
   - Click **Create → Primary zone** *(note: DSM 7 calls this "Primary zone", not "Master zone")*.
   - Fill in the dialog exactly like this:
     - **Domain type:** `Forward zone`
     - **Domain name:** `rtupdate.wunderground.com` *(Tip: Making the zone specifically for the subdomain `rtupdate.wunderground.com` means the main `www.wunderground.com` website still works normally if you ever visit it!)*
     - **Primary DNS server:** Enter your Synology NAS local LAN IP (e.g., `192.168.1.XXX`).
     - **Serial format:** `Integer` (or `Date`)
   - Click **Save**.
4. **Add the Blank Root `A` Record to the Zone:**
   - In the **Zones** list, **double-click** on your new `rtupdate.wunderground.com` zone (or select it and click **Edit → Resource record**).
   - You will see an automatically created `NS` record and `ns.rtupdate.wunderground.com` `A` record. We need a record for `rtupdate.wunderground.com` itself:
   - Click **Create → A Type**.
   - **Name:** Leave this **completely blank** (empty) so it applies to `rtupdate.wunderground.com` directly.
   - **TTL:** `60` (or leave default `86400`).
   - **IP address:** Enter your Synology NAS local LAN IP (e.g., `192.168.1.XXX`).
   - Click **Save**, then click **OK** to close the Resource record window.
5. **Verify It Works From Your Mac Terminal:**
   Run this on your Mac (replacing `192.168.1.XXX` with your NAS IP):
   ```bash
   nslookup rtupdate.wunderground.com 192.168.1.XXX
   ```
   It should immediately return your NAS IP (`192.168.1.XXX`)!
6. **Point Your Router (or Display) to Use Your NAS IP as DNS:**
   - In your home router's **DHCP / LAN DNS Settings**, set the **Primary DNS Server** to your Synology NAS IP (`192.168.1.XXX`).

#### Method B — Using the Built-In Docker DNS Server (No Synology DNS Package Needed)
If you don't want to configure Synology's DNS Server package at all:
1. Make sure Synology's **DNS Server** package is **stopped/uninstalled** so UDP port `53` is free.
2. In `acurite-poc/docker-compose.yml`:
   - Replace `192.168.1.XXX` in `command: ... --dns-ip 192.168.1.XXX` with your actual NAS IP.
   - Uncomment `- "53:53/udp"` under `ports:`.
3. Rebuild/restart the project in Container Manager, and set your router's DHCP Primary DNS Server to `<YOUR_NAS_IP>`.

#### Method C — Using Your Router, Pi-hole, or AdGuard Home
If your router (e.g., UniFi, Asuswrt-Merlin, Firewalla, pfSense) or Pi-hole/AdGuard Home supports Custom Local DNS Records, simply add `rtupdate.wunderground.com` $\rightarrow$ `<YOUR_NAS_IP>` there—then you don't need any DNS server running on the NAS at all.

---

### Step 4: Configure Your AcuRite 01544M / 06101M Display
1. Press the **Gear / SET** button on your AcuRite indoor display to activate its Wi-Fi setup mode (or unplug and plug back in the display; setup mode stays active for 30 minutes).
2. Connect your phone/laptop to the AcuRite display's temporary Wi-Fi network (`AcuRite-...`) and open `http://192.168.4.1` in your browser.
3. Select your **2.4 GHz home Wi-Fi**, enter your password, and type any dummy strings for Weather Underground (`Station ID: LOCAL1`, `Station Key: 12345`), then click **Save**.
4. Watch `http://<YOUR_NAS_IP>:8080/` (or your Container Manager logs)—within 30–60 seconds you will see the live packets from your AcuRite display printing out!
