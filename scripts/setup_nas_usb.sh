#!/bin/sh
# Synology DSM 7 Task Scheduler Boot Script for RTL-SDR USB Support
#
# Installation on Synology NAS:
# 1. Open DSM Control Panel -> Task Scheduler -> Create -> Triggered Task -> User-defined script
# 2. General Settings:
#    - Task: RTL-SDR USB Permissions
#    - User: root
#    - Event: Boot-up
# 3. Task Settings -> User-defined script:
#    chmod -R 666 /dev/bus/usb && rmmod dvb_usb_rtl28xxu rtl2832 2>/dev/null || true

chmod -R 666 /dev/bus/usb
rmmod dvb_usb_rtl28xxu rtl2832 2>/dev/null || true
echo "[$(date)] Configured /dev/bus/usb permissions and unloaded default DVB kernel drivers."
