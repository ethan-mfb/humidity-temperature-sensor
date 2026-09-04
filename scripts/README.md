# Sensor capture scripts

Pi-side tooling. These scripts are not part of the `web-api` package and are not
included in `npm run package`.

## `capture-sensor.mjs`

Drives the DHT22/AM2302 start signal and records every GPIO edge the sensor
produces, appending one JSON object per triggered read to a JSONL file.

It does **not** interpret the signal — it just gets real data off the hardware
so you have something to work with.

### Wiring

Per the root README "Connecting the sensor" section, using **physical** header pins:

| Sensor pin | Physical pin | BCM GPIO |
| ---------- | ------------ | -------- |
| `+`        | 1 (3.3V)     | —        |
| `out`      | 3 (data)     | **2**    |
| `-`        | 6 (GND)      | —        |

`onoff` and `pigpio` both address pins by **BCM** number, so physical pin 3 is
`--pin 2`. That is the script's default.

### One-time setup on the Pi

```bash
ssh alpha@rpi20w.local

sudo apt update && sudo apt install -y pigpio

mkdir -p ~/sensor-capture && cd ~/sensor-capture
npm init -y
npm install pigpio onoff
```

`pigpio` needs direct access to the SoC peripherals, so the script must run
under `sudo`.

### Capture

```bash
# from the dev machine
scp scripts/capture-sensor.mjs alpha@rpi20w.local:~/sensor-capture/

# on the Pi
cd ~/sensor-capture
sudo node capture-sensor.mjs --samples 30 --out baseline.jsonl
```

Capture the same signal through both libraries, to compare what each one sees:

```bash
sudo node capture-sensor.mjs --method both --samples 20 --out comparison.jsonl
```

Options: `--pin <bcm>`, `--method pigpio|onoff|both`, `--samples <n>`,
`--interval <ms>`, `--out <file>`, `--help`.

### Bring the data back

```bash
# from the dev machine
mkdir -p captures
scp alpha@rpi20w.local:~/sensor-capture/'*.jsonl' captures/
```

### Output format

One JSON object per triggered read:

```json
{
  "schemaVersion": 2,
  "capturedAt": "2026-09-04T18:22:31.004Z",
  "method": "pigpio",
  "bcmPin": 2,
  "physicalPin": 3,
  "attempt": 2,
  "startSignalLowUs": 5000,
  "frameWindowMs": 25,
  "edgeCount": 85,
  "edges": [
    { "level": 0, "tickUs": 2505000 },
    { "level": 1, "tickUs": 2510002 },
    { "level": 0, "tickUs": 2510032 }
  ]
}
```

`level` is the logic level **after** the transition; `tickUs` is microseconds
since the first edge of the capture session — not since the start of this read.

That matters: the timeline is continuous across every read in a session, so
concatenating the `edges` arrays of all records for one method replays the whole
session as a single stream, idle gaps between frames included.

A read that captured nothing is still written, with `edgeCount: 0` and an empty
`edges` array. Empty, short and noisy reads are worth keeping alongside the
clean ones.

### End-of-run summary

Printed to the console only, never written to the output file:

- `edgesPerRead` — a complete AM2302 frame is 85 edges (host low, release,
  the sensor's response pulse pair, then 2 edges per data bit). Consistently
  fewer means edges are being dropped.
- `edgeIntervalUs` — the spread of gaps between consecutive edges. On a good
  capture the short end clusters near 26-28us and 70us, the sensor's two
  pulse widths.

### Sanity-checking the wiring without this script

If every read comes back empty, confirm the sensor is alive and wired
correctly using the kernel driver, which talks to the DHT22 in kernel space:

```bash
# add to /boot/firmware/config.txt, then reboot
dtoverlay=dht11,gpiopin=2
```

```bash
cat /sys/bus/iio/devices/iio:device0/in_temp_input     # milli-degrees C
cat /sys/bus/iio/devices/iio:device0/in_humidityrelative_input
```

Remove the overlay line and reboot before capturing again — the kernel driver
holds the pin.
