#!/usr/bin/env python3
"""
AcuRite 01544M / 06101M Direct-to-Wi-Fi Display — Local DNS & HTTP Packet Sniffer PoC
Zero external dependencies (uses Python 3 standard library only).

Supported Endpoints:
1. Weather Underground (WU) Ingest:
   - Host: rtupdate.wunderground.com, weatherstation.wunderground.com
   - Path: /weatherstation/updateweatherstation.php
   - Response: 'success' (text/plain)
2. MyAcuRite Cloud APIs (Atlas / smartHUB):
   - Host: atlasapi.myacurite.com, hubapi.myacurite.com
   - Path: /messages, /checkversion, /hubapi/messages, /atlasapi/messages
   - Response: {"success": 1, "checkversion": "051"} (application/json)

Filters:
- Automatically ignores and drops non-weather traffic, browser favicon/icon requests,
  and background scanners so the inspector only shows clean weather station telemetry.
"""

import argparse
import datetime
import html
import json
import math
import socket
import struct
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Store the last 50 captured packets in memory for the browser status page
CAPTURED_PACKETS = []
MAX_PACKETS = 50

HIJACK_DOMAINS = {
    "rtupdate.wunderground.com",
    "weatherstation.wunderground.com",
    "atlasapi.myacurite.com",
    "hubapi.myacurite.com",
}


# ---------------------------------------------------------------------------
# Meteorological Helper Math (Feels Like & Dew Point Preview)
# ---------------------------------------------------------------------------
def calc_dew_point_f(temp_f: float, rh: float) -> float:
    if rh <= 0:
        return temp_f
    temp_c = (temp_f - 32.0) * 5.0 / 9.0
    a, b = 17.625, 243.04
    gamma = math.log(rh / 100.0) + (a * temp_c) / (b + temp_c)
    dew_c = (b * gamma) / (a - gamma)
    return round((dew_c * 9.0 / 5.0) + 32.0, 1)


def calc_feels_like_f(temp_f: float, rh: float, wind_mph: float) -> tuple[float, str]:
    # Wind Chill (NWS formula)
    if temp_f <= 50.0 and wind_mph >= 3.0:
        wc = (
            35.74
            + 0.6215 * temp_f
            - 35.75 * (wind_mph ** 0.16)
            + 0.4275 * temp_f * (wind_mph ** 0.16)
        )
        return round(wc, 1), "Wind Chill"
    # Heat Index (Rothfusz regression)
    if temp_f >= 80.0 and rh >= 40.0:
        hi = (
            -42.379
            + 2.04901523 * temp_f
            + 10.14333127 * rh
            - 0.22475541 * temp_f * rh
            - 0.00683783 * temp_f * temp_f
            - 0.05481717 * rh * rh
            + 0.00122874 * temp_f * temp_f * rh
            + 0.00085282 * temp_f * rh * rh
            - 0.00000199 * temp_f * temp_f * rh * rh
        )
        return round(hi, 1), "Heat Index"
    return round(temp_f, 1), "Actual Temp"


def deg_to_cardinal(deg: float) -> str:
    dirs = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ]
    ix = int(round(deg / 22.5)) % 16
    return dirs[ix]


# ---------------------------------------------------------------------------
# Lightweight UDP DNS Hijack Server (Optional, enabled via --dns-ip)
# ---------------------------------------------------------------------------
def parse_dns_qname(data: bytes, offset: int = 12) -> tuple[str, int]:
    labels = []
    while offset < len(data):
        length = data[offset]
        if length == 0:
            offset += 1
            break
        if (length & 0xC0) == 0xC0:
            pointer = struct.unpack("!H", data[offset : offset + 2])[0] & 0x3FFF
            sub_qname, _ = parse_dns_qname(data, pointer)
            labels.append(sub_qname)
            offset += 2
            break
        offset += 1
        labels.append(data[offset : offset + length].decode("utf-8", errors="ignore"))
        offset += length
    return ".".join(labels).lower(), offset


def build_dns_a_response(query: bytes, qname_end: int, ip_str: str) -> bytes:
    tx_id = query[:2]
    flags = b"\x81\x80"  # Standard query response, No error
    counts = struct.pack("!HHHH", 1, 1, 0, 0)
    question = query[12 : qname_end + 4]
    # Answer pointer to offset 12 (0xC00C), Type A (1), Class IN (1), TTL 60s, Len 4, IPv4
    answer = (
        b"\xc0\x0c"
        + struct.pack("!HHIH", 1, 1, 60, 4)
        + socket.inet_aton(ip_str)
    )
    return tx_id + flags + counts + question + answer


def run_dns_server(nas_ip: str, dns_port: int = 53, upstream_dns: str = "1.1.1.1"):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", dns_port))
    except Exception as e:
        print(f"[DNS-WARN] Could not bind UDP port {dns_port} ({e}).")
        print("           (If DSM DNS Server or Router DNS is handling redirects, this is fine!)")
        return

    print(f"[DNS] Listening on UDP 0.0.0.0:{dns_port} -> Hijacking {HIJACK_DOMAINS} to {nas_ip}")
    while True:
        try:
            data, addr = sock.recvfrom(512)
            if len(data) < 12:
                continue
            qname, qname_end = parse_dns_qname(data)
            qtype = struct.unpack("!H", data[qname_end : qname_end + 2])[0]

            if qname in HIJACK_DOMAINS and qtype == 1:  # Type A (IPv4)
                now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                print(f"[{now}] [DNS HIJACK] {addr[0]} asked for '{qname}' -> Answered {nas_ip}")
                resp = build_dns_a_response(data, qname_end, nas_ip)
                sock.sendto(resp, addr)
            else:
                # Forward to upstream DNS
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as up_sock:
                    up_sock.settimeout(2.0)
                    up_sock.sendto(data, (upstream_dns, 53))
                    up_resp, _ = up_sock.recvfrom(512)
                    sock.sendto(up_resp, addr)
        except Exception as e:
            print(f"[DNS-ERR] {e}")


# ---------------------------------------------------------------------------
# HTTP Request Interceptor & Pretty Printer
# ---------------------------------------------------------------------------
class AcuRitePoCHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default noisy BaseHTTPRequestHandler one-liner; we print a rich block instead
        pass

    @staticmethod
    def _is_weather_request(path: str, query_params: dict, host: str, raw_body: str) -> bool:
        """Filter out non-weather noise so only WU and AcuRite packets are logged."""
        # Standard Weather Underground paths
        if path.startswith(("/weatherstation/", "/updateweatherstation")):
            return True

        # AcuRite / MyAcuRite direct cloud API paths
        if path.startswith(("/messages", "/hubapi", "/atlasapi", "/checkversion", "/acurite")):
            return True

        # AcuRite / WU host header match
        host_lower = host.lower()
        if any(h in host_lower for h in ("atlasapi", "hubapi", "myacurite", "wunderground")):
            return True

        # Recognized telemetry parameters (WU and AcuRite format)
        weather_keys = {
            "tempf", "temperature", "temp", "humidity", "windspeedmph", "wind_speed",
            "winddir", "wind_direction", "rainin", "dailyrainin", "baromin", "barometer",
            "action", "indoortempf", "indoorhumidity", "ID", "sensor", "sensortype",
            "hub", "checkversion"
        }
        if any(k in query_params for k in weather_keys):
            return True

        # JSON body check for AcuRite API posts
        if raw_body and any(k in raw_body.lower() for k in ("temp", "humidity", "sensor", "checkversion")):
            return True

        return False

    def _handle_capture(self, method: str):
        parsed_url = urllib.parse.urlparse(self.path)

        # 1. Silently ignore noisy browser asset & metadata requests
        if parsed_url.path in (
            "/favicon.ico",
            "/apple-touch-icon.png",
            "/apple-touch-icon-precomposed.png",
            "/robots.txt",
        ) or parsed_url.path.endswith((".ico", ".png")):
            self.send_response(204)
            self.end_headers()
            return

        query_params = {k: v[0] if len(v) == 1 else v for k, v in urllib.parse.parse_qs(parsed_url.query).items()}

        # Read POST body if present
        content_len = int(self.headers.get("Content-Length", 0) or 0)
        raw_body = self.rfile.read(content_len).decode("utf-8", errors="replace") if content_len > 0 else ""

        # Parse JSON body if applicable
        json_payload = {}
        if raw_body:
            try:
                json_payload = json.loads(raw_body)
                if isinstance(json_payload, dict) and not query_params:
                    query_params = json_payload
            except Exception:
                pass

        if raw_body and not query_params:
            query_params = {k: v[0] if len(v) == 1 else v for k, v in urllib.parse.parse_qs(raw_body).items()}

        # 2. Status Page Inspector & Clear History endpoints
        if parsed_url.path == "/" and not query_params and method == "GET":
            self._serve_status_page()
            return

        if parsed_url.path == "/clear" and method == "GET":
            CAPTURED_PACKETS.clear()
            self.send_response(302)
            self.send_header("Location", "/")
            self.end_headers()
            return

        host_hdr = self.headers.get("Host", "unknown")
        ua_hdr = self.headers.get("User-Agent", "unknown")

        # 3. Filter out non-weather requests
        if not self._is_weather_request(parsed_url.path, query_params, host_hdr, raw_body):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not a weather station endpoint.\n")
            return

        # 4. Classify endpoint type
        is_acurite_endpoint = (
            "atlas" in host_hdr.lower()
            or "myacurite" in host_hdr.lower()
            or "hubapi" in host_hdr.lower()
            or ua_hdr.startswith("Atlas")
            or parsed_url.path.startswith(("/messages", "/hubapi", "/atlasapi", "/checkversion"))
            or "sensortype" in query_params
            or "sensor" in query_params
        )
        endpoint_name = "MyAcuRite API (Atlas / Hub)" if is_acurite_endpoint else "Weather Underground (WU)"

        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Combine parsed parameters for decoding
        combined = {**query_params, **(json_payload if isinstance(json_payload, dict) else {})}

        # Extract Outdoor Weather Metrics
        decoded_metrics = {"Endpoint Type": endpoint_name}
        try:
            # Temperature
            temp_val = combined.get("tempf") or combined.get("temperature") or combined.get("temp")
            rh_val = combined.get("humidity")
            wind_val = combined.get("windspeedmph") or combined.get("wind_speed")
            wind_dir_val = combined.get("winddir") or combined.get("wind_direction")

            if temp_val is not None:
                temp_f = float(temp_val)
                rh = float(rh_val) if rh_val is not None else 50.0
                wind_mph = float(wind_val) if wind_val is not None else 0.0
                feels_f, feels_type = calc_feels_like_f(temp_f, rh, wind_mph)
                dew_f = calc_dew_point_f(temp_f, rh)
                decoded_metrics["Outdoor Temp"] = f"{temp_f:.1f} °F"
                decoded_metrics["Feels Like"] = f"{feels_f:.1f} °F ({feels_type})"
                decoded_metrics["Dew Point"] = f"{dew_f:.1f} °F"
                decoded_metrics["Outdoor Humidity"] = f"{int(rh)} %"

            if combined.get("rainin") is not None or combined.get("dailyrainin") is not None:
                decoded_metrics["Rain Rate"] = f"{float(combined.get('rainin', 0.0)):.2f} in/hr"
                decoded_metrics["Rain Today"] = f"{float(combined.get('dailyrainin', 0.0)):.2f} in"

            if wind_val is not None:
                w_spd = float(wind_val)
                w_dir = float(wind_dir_val or 0)
                decoded_metrics["Wind"] = f"{w_spd:.1f} mph @ {int(w_dir)}° ({deg_to_cardinal(w_dir)})"

            if combined.get("baromin") is not None or combined.get("barometer") is not None:
                b_val = float(combined.get("baromin") or combined.get("barometer"))
                decoded_metrics["Barometer"] = f"{b_val:.2f} inHg"

            if combined.get("battery") is not None:
                decoded_metrics["Battery Status"] = str(combined.get("battery"))

            if combined.get("sensor") is not None or combined.get("sensortype") is not None:
                decoded_metrics["Sensor Model"] = f"{combined.get('sensortype', 'AcuRite')} (ID: {combined.get('sensor', 'N/A')})"
        except Exception as e:
            decoded_metrics["Parse Note"] = str(e)

        record = {
            "timestamp": now_str,
            "client_ip": self.client_address[0],
            "method": method,
            "host": host_hdr,
            "path": parsed_url.path,
            "user_agent": ua_hdr,
            "endpoint_type": endpoint_name,
            "query_params": query_params,
            "raw_body": raw_body,
            "decoded_metrics": decoded_metrics,
        }
        CAPTURED_PACKETS.insert(0, record)
        del CAPTURED_PACKETS[MAX_PACKETS:]

        # Print rich console output
        print("\n" + "=" * 78)
        print(f"📡 CAPTURED WEATHER PACKET [{endpoint_name}] at {now_str} from {self.client_address[0]}")
        print("=" * 78)
        print(f"  Method & Path : {method} {self.path}")
        print(f"  Host Header   : {host_hdr}")
        print(f"  User-Agent    : {ua_hdr}")
        print("-" * 78)
        print("  🌤️  DECODED TELEMETRY (+ DERIVED METRICS):")
        for k, v in decoded_metrics.items():
            print(f"     • {k:<20}: {v}")
        print("-" * 78)
        print("  📦 RAW PARAMETERS:")
        print("     " + json.dumps(query_params, indent=2).replace("\n", "\n     "))
        if raw_body:
            print(f"  📄 RAW BODY: {raw_body}")
        print("=" * 78, flush=True)

        # Reply with the exact response the station/display expects
        if is_acurite_endpoint:
            resp_bytes = b'{"success": 1, "checkversion": "051"}\n'
            content_type = "application/json"
        else:
            # Standard Weather Underground rtupdate.wunderground.com response
            resp_bytes = b"success\n"
            content_type = "text/plain"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(resp_bytes)))
        self.end_headers()
        self.wfile.write(resp_bytes)

    def _serve_status_page(self):
        rows_html = ""
        for pkt in CAPTURED_PACKETS:
            metrics_badges = "".join(
                f"<span class='badge'><b>{html.escape(k)}:</b> {html.escape(v)}</span>"
                for k, v in pkt["decoded_metrics"].items()
            )
            params_json = html.escape(json.dumps(pkt["query_params"], indent=2))
            tag_class = "tag-acurite" if "AcuRite" in pkt.get("endpoint_type", "") else "tag-wu"
            rows_html += f"""
            <div class="card">
              <div class="meta">
                <span class="tag {tag_class}">{html.escape(pkt.get('endpoint_type', 'Weather'))}</span>
                <b>{pkt['timestamp']}</b> · Client IP: <code>{pkt['client_ip']}</code> ·
                Host: <code>{html.escape(pkt['host'])}</code> ·
                Path: <code>{html.escape(pkt['path'])}</code>
              </div>
              <div class="badges">{metrics_badges}</div>
              <pre>{params_json}</pre>
            </div>
            """

        if not rows_html:
            rows_html = """
            <div class="empty">
              <h3>Waiting for live weather packets...</h3>
              <p>Non-weather requests are automatically filtered. Test either protocol using the simulation buttons above!</p>
            </div>
            """

        sim_wu_url = (
            "/weatherstation/updateweatherstation.php"
            "?ID=LOCAL1&PASSWORD=12345&dateutc=now&winddir=292&windspeedmph=9.4"
            "&humidity=58&tempf=67.8&rainin=0.08&dailyrainin=0.34&baromin=29.96"
            "&indoortempf=71.5&indoorhumidity=44&softwaretype=AcuRite&action=updateraw"
        )
        sim_acurite_url = (
            "/messages"
            "?hub=00:1E:C0:12:34:56&sensor=00001234&sensortype=5N1"
            "&tempf=68.2&humidity=56&windspeedmph=8.0&winddir=190&baromin=29.94"
            "&battery=normal&checkversion=051"
        )

        page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="5">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌤️</text></svg>">
  <title>AcuRite &amp; WU Packet Sniffer PoC</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; background: #090D16; color: #F8FAFC; margin: 0; padding: 24px; }}
    .container {{ max-width: 980px; margin: 0 auto; }}
    header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1E293B; padding-bottom: 16px; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }}
    h1 {{ font-size: 20px; margin: 0; }}
    .sub {{ color: #94A3B8; font-size: 13px; margin-top: 4px; }}
    .actions {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    .btn {{ background: #2563EB; color: white; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; }}
    .btn:hover {{ background: #1D4ED8; }}
    .btn-secondary {{ background: #1E293B; border: 1px solid #334155; color: #E2E8F0; }}
    .btn-secondary:hover {{ background: #334155; }}
    .endpoints-box {{ background: #0F172A; border: 1px solid #1E293B; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 12px; color: #94A3B8; }}
    .endpoints-box b {{ color: #F8FAFC; }}
    .card {{ background: #111827; border: 1px solid #1E293B; border-radius: 8px; padding: 16px; margin-bottom: 16px; }}
    .meta {{ font-size: 13px; color: #94A3B8; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }}
    .tag {{ padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }}
    .tag-wu {{ background: #0369A1; color: #E0F2FE; }}
    .tag-acurite {{ background: #7C3AED; color: #EDE9FE; }}
    code {{ background: #1E293B; padding: 2px 6px; border-radius: 4px; color: #38BDF8; font-size: 12px; }}
    .badges {{ display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }}
    .badge {{ background: #0F172A; border: 1px solid #334155; padding: 6px 10px; border-radius: 6px; font-size: 13px; font-family: monospace; }}
    pre {{ background: #090D16; border: 1px solid #1E293B; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #A7F3D0; margin: 0; }}
    .empty {{ text-align: center; padding: 48px; border: 1px dashed #334155; border-radius: 8px; color: #94A3B8; }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>📡 AcuRite &amp; Weather Underground Packet Sniffer</h1>
        <div class="sub">Auto-refreshes every 5s · Filtering active (non-weather requests ignored)</div>
      </div>
      <div class="actions">
        <a class="btn btn-secondary" href="/clear">🗑️ Clear History</a>
        <a class="btn" href="{sim_wu_url}" target="_blank">⚡ Test WU Endpoint</a>
        <a class="btn" href="{sim_acurite_url}" target="_blank">⚡ Test AcuRite Endpoint</a>
      </div>
    </header>

    <div class="endpoints-box">
      <b>Supported Ingest Endpoints:</b><br>
      • <b>Weather Underground:</b> <code>http://rtupdate.wunderground.com/weatherstation/updateweatherstation.php</code><br>
      • <b>MyAcuRite Atlas / Hub:</b> <code>http://atlasapi.myacurite.com/messages</code> or <code>http://hubapi.myacurite.com/messages</code>
    </div>

    {rows_html}
  </div>
</body>
</html>"""
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._handle_capture("GET")

    def do_POST(self):
        self._handle_capture("POST")


def main():
    parser = argparse.ArgumentParser(description="AcuRite Wi-Fi Display DNS & HTTP Packet Sniffer PoC")
    parser.add_argument("--http-port", type=int, default=8080, help="HTTP port to listen on (default: 8080)")
    parser.add_argument("--dns-ip", type=str, default="", help="Optional: Start UDP port 53 DNS responder returning this NAS LAN IP")
    parser.add_argument("--dns-port", type=int, default=53, help="UDP port for DNS server (default: 53)")
    args = parser.parse_args()

    if args.dns_ip:
        dns_thread = threading.Thread(
            target=run_dns_server, args=(args.dns_ip, args.dns_port), daemon=True
        )
        dns_thread.start()

    server = ThreadingHTTPServer(("0.0.0.0", args.http_port), AcuRitePoCHandler)
    print("==============================================================================")
    print(f"🚀 AcuRite & WU Packet Sniffer PoC listening on HTTP 0.0.0.0:{args.http_port}")
    print(f"🌐 Live Web Inspector : http://<YOUR_NAS_IP>:{args.http_port}/")
    print(f"🎯 WU Ingest Path     : http://rtupdate.wunderground.com/weatherstation/updateweatherstation.php")
    print(f"🎯 AcuRite Cloud Path : http://atlasapi.myacurite.com/messages")
    print("==============================================================================", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down PoC sniffer...")


if __name__ == "__main__":
    main()
