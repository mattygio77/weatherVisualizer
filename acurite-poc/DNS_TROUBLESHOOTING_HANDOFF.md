# Handoff & Troubleshooting Guide: AcuRite 01544M/06101M Local DNS Intercept on Synology NAS (`<YOUR_NAS_IP>`)

## 1. Context & Goal
We run a Proof of Concept (PoC) to capture weather packets sent over Wi-Fi by an **AcuRite Iris (5-in-1) Direct-to-Wi-Fi Display (Model `01544M` / `06101M`)** without needing a real Weather Underground account.

- **Synology NAS Local LAN IP:** `<YOUR_NAS_IP>` (e.g. `192.168.1.XXX`)
- **PoC Sniffer Container (`acurite-poc`):** Located at `acurite-poc/poc_sniffer.py` (copied to `/volume1/docker/acurite-poc` on the NAS), listening on HTTP port `8080`.
- **Synology DSM Reverse Proxy:** Configured to forward incoming HTTP port `80` requests for `Host: rtupdate.wunderground.com` to `http://localhost:8080`.
- **Symptom:** Running `nslookup rtupdate.wunderground.com` returns Weather Underground's real public AWS IP instead of `<YOUR_NAS_IP>`, meaning the AcuRite display will send its packets to the public internet rather than to the NAS.

---

## 2. Step-by-Step Diagnostic & Fix Sequence

### Step 1: Isolate Whether the Issue is Synology DNS Server vs. Router DHCP DNS
When you run `nslookup rtupdate.wunderground.com` without a second argument, your computer queries **your router's default DNS server**, *not* the Synology NAS.

Run these two commands in your terminal to see what the Synology NAS (`<YOUR_NAS_IP>`) itself is answering:

```bash
# Test 1: Ask the Synology NAS directly on port 53
nslookup rtupdate.wunderground.com <YOUR_NAS_IP>

# Test 2: Ask your default LAN DNS server
nslookup rtupdate.wunderground.com
```

- **Outcome A:** If **Test 1** returns `<YOUR_NAS_IP>` (and says `Authoritative answers can be found from...`), then **Synology DNS Server is working**, and you only need **Step 3** (pointing your router's DHCP DNS to `<YOUR_NAS_IP>`).
- **Outcome B:** If **Test 1** returns Weather Underground's public IP (e.g., `52.22.134.226` or `34.232.x.x`) or times out, then **Synology DNS Server's Zone configuration needs the fix in Step 2**.

---

### Step 2: Fix Synology DSM 7 "DNS Server" Zone Configuration
Synology's BIND DNS engine often ignores blank root (`@`) records on third-level subdomain zones (like `rtupdate.wunderground.com`) and forwards the query upstream instead. The reliable way to force Synology DNS Server to answer authoritatively is to create the zone for **`wunderground.com`** and add **`rtupdate`** as an explicit host `A` record:

1. Open **DNS Server** in Synology DSM (`http://<YOUR_NAS_IP>:5000`).
2. Go to **Zones**:
   - Delete any previous `rtupdate.wunderground.com` zone.
   - Click **Create → Primary zone**:
     - **Domain type:** `Forward zone`
     - **Domain name:** `wunderground.com`
     - **Primary DNS server:** `<YOUR_NAS_IP>`
     - **Serial format:** `Integer`
     - Leave *Limit zone transfer* and *Limit source IP service* **unchecked**.
     - Click **Save**.
3. **Add the `rtupdate` `A` Record:**
   - Double-click the new `wunderground.com` zone (or select it and click **Edit → Resource record**).
   - Click **Create → A Type**:
     - **Name:** `rtupdate` *(this creates `rtupdate.wunderground.com`)*
     - **TTL:** `60`
     - **IP address:** `<YOUR_NAS_IP>`
     - Click **Save**.
   - *(Optional)* Click **Create → A Type** again and add `www` pointing to `23.45.203.105` if you browse `www.wunderground.com` from home.
   - Click **OK** to close the Resource record window.
4. **Verify Views / Resolution Settings:**
   - Click **Views** in the left sidebar of DNS Server — make sure there are no Views restricting which zone applies to your LAN.
   - Click **Resolution** in the left sidebar — ensure **Enable resolution services** is checked, **Enable forwarders** is checked (`1.1.1.1` and `8.8.8.8`), and **Forward policy** is set to `Forward first`.
5. **Re-Test from Terminal:**
   ```bash
   nslookup rtupdate.wunderground.com <YOUR_NAS_IP>
   ```
   This **must** now return:
   ```text
   Server:     <YOUR_NAS_IP>
   Address:    <YOUR_NAS_IP>#53

   Name:   rtupdate.wunderground.com
   Address: <YOUR_NAS_IP>
   ```

---

### Step 3: Make Your Home Network Use `<YOUR_NAS_IP>` for DNS
Once `nslookup rtupdate.wunderground.com <YOUR_NAS_IP>` returns `<YOUR_NAS_IP>`, your router needs to hand out `<YOUR_NAS_IP>` as the DNS server to devices on your Wi-Fi:

1. Log into your home Wi-Fi router's admin page.
2. Go to **LAN / DHCP Settings** (not WAN/Internet DNS).
3. Set **Primary DNS Server** to `<YOUR_NAS_IP>`.
4. **Important:** Leave **Secondary DNS Server** **blank** (or set to `<YOUR_NAS_IP>`). If you put `8.8.8.8` or `1.1.1.1` in Secondary DNS, devices will randomly ask `8.8.8.8` and bypass your NAS!
5. Save your router settings, then reconnect Wi-Fi on your client (or power-cycle the AcuRite display for 10 seconds).
6. Test plain `nslookup` (with no IP at the end):
   ```bash
   nslookup rtupdate.wunderground.com
   ```
   It should now return `<YOUR_NAS_IP>`.

---

### Step 4: Verify Reverse Proxy & End-to-End Packet Capture
Once DNS resolves to `<YOUR_NAS_IP>`, test the full path:

```bash
curl -v "http://rtupdate.wunderground.com/weatherstation/updateweatherstation.php?ID=LOCAL1&PASSWORD=12345&tempf=68.4&humidity=61&windspeedmph=8.5&winddir=180&rainin=0.05&dailyrainin=0.25&baromin=29.92&action=updateraw"
```

- **Expected Response:** `HTTP/1.1 200 OK` with body `success`.
- **Expected UI Result:** Open `http://<YOUR_NAS_IP>:8080/` in your browser and confirm the captured packet appears.

---

### Step 5: AcuRite Edge Cases & RTL-SDR Alternative
If `curl` from your Mac hits `http://<YOUR_NAS_IP>:8080/` cleanly, but the physical **AcuRite 01544M / 06101M** display never appears in the logs:

1. **Edge Case A — Display Uses Hardcoded DNS (`8.8.8.8`) or HTTPS (`:443`):**
   - Check the **Query Log** inside DNS Server when you power-cycle the AcuRite display.
   - If you see queries for `atlasapi.myacurite.com` instead of `rtupdate.wunderground.com`, add a Primary Zone for `myacurite.com` (`atlasapi` and `hubapi` $\rightarrow$ `<YOUR_NAS_IP>`), and add a Reverse Proxy rule for `atlasapi.myacurite.com` (`HTTP :80` $\rightarrow$ `localhost:8080`).
2. **Edge Case B — Why Mode 2 (RTL-SDR) is the Reliable Alternative:**
   - If your router does not allow custom LAN DHCP DNS, or if you prefer not to redirect DNS for your entire house, Mode 2 (RTL-SDR USB dongle on the NAS) completely bypasses Wi-Fi, DNS, and HTTP intercepts—capturing raw `433.92 MHz` radio packets directly out of the air every 18 seconds.
