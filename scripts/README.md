# Sensor capture scripts

Pi-side tooling. These scripts are not part of the `web-api` package and are not
included in `npm run package`.

## `capture-sensor.mjs`

Drives the DHT22/AM2302 start signal, records every GPIO edge of the response
frame, decodes it, and appends one JSON object per attempt to a JSONL file. The
output is meant to be copied back to a dev machine and used as fixture data for
the `tempSensorService` decoder.

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

Copy the script over and run it:

```bash
# from the dev machine
scp scripts/capture-sensor.mjs alpha@rpi20w.local:~/sensor-capture/

# on the Pi
cd ~/sensor-capture
sudo node capture-sensor.mjs --samples 30 --out baseline.jsonl
```

Compare what `pigpio` sees against what the current `onoff`-based
`gpioPinPollingService` can see:

```bash
sudo node capture-sensor.mjs --method both --samples 20 --out comparison.jsonl
```

Options: `--pin <bcm>`, `--method pigpio|onoff|both`, `--samples <n>`,
`--interval <ms>`, `--out <file>`, `--help`.

### Bring the data back

```bash
# from the dev machine
scp alpha@rpi20w.local:~/sensor-capture/'*.jsonl' web-api/src/tempSensorService/__tests__/fixtures/
```

### Output format

One JSON object per line:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-09-04T18:22:31.004Z",
  "method": "pigpio",
  "bcmPin": 2,
  "physicalPin": 3,
  "attempt": 1,
  "edgeCount": 85,
  "edges": [
    { "level": 0, "tickUs": 0 },
    { "level": 1, "tickUs": 5002 }
  ],
  "decode": {
    "ok": true,
    "bits": "0000001010001100...",
    "bytes": [2, 140, 1, 15],
    "dataPulseWidthsUs": [27, 26, 70, 27],
    "checksumReceived": 158,
    "checksumComputed": 158,
    "temperatureC": 27.1,
    "temperatureF": 80.78,
    "relativeHumidityPercentage": 65.2,
    "humidityInRange": true
  }
}
```

`edges` is the fixture input for decoder tests; `decode` is the expected output.
Failed attempts are written too, with `decode.ok: false` and a `decode.reason`
of `too-few-edges`, `too-few-pulses`, or `checksum-mismatch` — the lossy and
corrupt frames are as useful for tests as the clean ones.

### Reusing the reference decoder in tests

The script exports its pure pieces, so a test can assert that
`tempSensorService` agrees with it on captured data:

```ts
import { decodeFrame, DHT22 } from "../../../../scripts/capture-sensor.mjs";
```

### End-of-run summary

The script prints a per-method summary. `zeroBitPulseUs` and `oneBitPulseUs`
give the measured separation between a 0 bit and a 1 bit on your hardware, which
is what the decoder's bit-width threshold constant should be derived from.
`edgeCount` versus `expectedEdgeCount` (85) shows how many edges a method loses.

### Sanity-checking the wiring without this script

If captures fail on every attempt, confirm the sensor is alive using the kernel
driver, which decodes DHT22 in kernel space:

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
