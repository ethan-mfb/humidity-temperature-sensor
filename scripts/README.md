# Sensor capture scripts

Pi-side tooling. These scripts are not part of the `web-api` package and are not
included in `npm run package`.

- `setup-pi.sh` — takes a freshly flashed image to a working capture setup.
- `capture-sensor.mjs` — drives the sensor and records the raw edge stream.
- `gpiod-capture.c` — the timing-critical helper `capture-sensor.mjs` spawns.

## `capture-sensor.mjs`

Drives the DHT22/AM2302 start signal and records every GPIO edge the sensor
produces, appending one JSON object per triggered read to a JSONL file.

It does **not** interpret the signal — it just gets real data off the hardware
so you have something to replay against the decoder in
`web-api/src/tempSensorService`.

### Why there is a C helper

`capture-sensor.mjs` owns sampling, output and analysis. The timing-critical
part lives in `gpiod-capture.c`, which captures exactly one frame per
invocation.

That split is not a preference, it is forced. A DHT22 frame has to be captured
by a single process that never lets go of the line: the host drives the start
pulse as an output, then releases to an input, and the sensor answers ~30us
later. libgpiod requests own their lines exclusively, so that handover has to
happen as one `gpiod_line_request_reconfigure_lines()` call on one request.
Three things are needed and no published Node binding exposes any of them:

| Requirement                                             | libgpiod v2 C API                              |
| ------------------------------------------------------- | ---------------------------------------------- |
| Switch direction without releasing the line             | `gpiod_line_request_reconfigure_lines()`       |
| Edge timestamps taken in the kernel, not the event loop | `gpiod_edge_event_get_timestamp_ns()`          |
| A buffer deep enough to hold a whole frame              | `gpiod_request_config_set_event_buffer_size()` |

For the record, the two candidates were checked rather than assumed:

- `node-libgpiod@0.6.0` hard-codes the v1 API in its `binding.gyp`
  (`-DGPIOD_VERSION_MAJOR=1`). Raspberry Pi OS trixie ships libgpiod 2.x, and
  v1/v2 are source-incompatible, so it does not build.
- `opengpio@2.0.2` does target v2, but its watch callback is typed
  `(value: boolean) => void` — the kernel timestamp is read and thrown away —
  and it drains edges through an `edge_event_buffer(1)` on a 1ms poll loop.
  A frame is 85 edges in ~5ms, so nearly all of them are lost.

### Wiring

Per the root README "Connecting the sensor" section, using **physical** header pins:

| Sensor pin | Physical pin | BCM GPIO |
| ---------- | ------------ | -------- |
| `+`        | 1 (3.3V)     | —        |
| `out`      | 3 (data)     | **2**    |
| `-`        | 6 (GND)      | —        |

Physical pin 3 is BCM 2, which is the script's default (`--pin 2`). That pin
also carries a 1.8k hardware pull-up, so the DHT22 does not need an added
resistor. The helper enables the internal pull-up as well, which matters only if
you move the data line to a pin without one.

> Character device line offsets **are** BCM numbers. The `+512` arithmetic in the
> root README's [GPIO numbering](../README.md#gpio-numbering) section is a sysfs
> artifact and does not apply to anything here.

### One-time setup on the Pi

`setup-pi.sh` does everything in this section, plus the access checks below and
the helper build, and is safe to re-run. On a freshly flashed image:

```bash
ssh alpha@rpi20w.local

sudo apt install -y git
git clone https://github.com/ethan-mfb/humidity-temperature-sensor.git
cd humidity-temperature-sensor/scripts
./setup-pi.sh
```

Cloning beats `scp` here because the dev container has no bind mount to the
host — `devcontainer.sh` runs with container-only storage, so the working tree
exists only inside the container and the host has nothing to copy from. Pass
`--skip-node` if you only want the capture tooling; node 16 is installed for the
`web-api`, and `capture-sensor.mjs` itself runs on any current node.

The manual equivalent, if you would rather not run the script:

```bash
ssh alpha@rpi20w.local

sudo apt update
sudo apt install -y build-essential libgpiod-dev pkg-config gpiod

mkdir -p ~/sensor-capture
```

`pigpio` is **not** used and is no longer installable — Raspberry Pi OS dropped
the package at trixie, because pigpio drives the peripherals through `/dev/mem`
and cannot support the Pi 5. libgpiod is the supported replacement.

Confirm the header chip is visible and you can reach it without root:

```bash
groups            # expect gpio to be listed
gpiodetect        # expect a chip labelled pinctrl-bcm2835
gpioinfo | head
```

### Capture

If you ran `setup-pi.sh` the helper is already built, so this is the whole step:

```bash
cd ~/humidity-temperature-sensor/scripts
node capture-sensor.mjs --samples 30 --out baseline.jsonl
```

Copying the two files across by hand instead, from a machine that can reach the
pi:

```bash
# from the dev machine
scp scripts/capture-sensor.mjs scripts/gpiod-capture.c alpha@rpi20w.local:~/sensor-capture/

# on the Pi
cd ~/sensor-capture
gcc -O2 -Wall -Wextra -std=gnu17 -o gpiod-capture gpiod-capture.c $(pkg-config --cflags --libs libgpiod)
node capture-sensor.mjs --samples 30 --out baseline.jsonl
```

**No `sudo`.** `/dev/gpiochip*` is reachable through the `gpio` group, unlike
pigpio's `/dev/mem`. If you do use `sudo`, note that it resets `PATH` to its
`secure_path` and will not find nvm's node — you would need
`sudo $(which node) …`.

Options: `--pin <bcm>`, `--samples <n>`, `--interval <ms>`, `--chip <path>`,
`--chip-label <s>`, `--out <file>`, `--help`.

The helper resolves the chip by label (`pinctrl-bcm2835`) rather than by number,
since chip numbering is not stable across kernels and boards. Override with
`--chip /dev/gpiochipN` if the label ever differs.

### Bring the data back

```bash
# from the dev machine
mkdir -p captures
scp alpha@rpi20w.local:~/humidity-temperature-sensor/scripts/'*.jsonl' captures/
```

Adjust the remote path to `~/sensor-capture/` if you copied the scripts over by
hand rather than cloning.

### Output format

One JSON object per triggered read:

```json
{
  "schemaVersion": 3,
  "capturedAt": "2026-09-18T18:22:31.004Z",
  "method": "libgpiod",
  "timestampSource": "kernel-monotonic",
  "bcmPin": 2,
  "physicalPin": 3,
  "chip": "/dev/gpiochip0",
  "attempt": 2,
  "startSignalLowUs": 5000,
  "frameWindowMs": 25,
  "edgeCount": 85,
  "error": null,
  "edges": [
    { "level": 0, "tickUs": 2505000, "tickNs": 2505000160 },
    { "level": 1, "tickUs": 2510002, "tickNs": 2510002080 },
    { "level": 0, "tickUs": 2510032, "tickNs": 2510032480 }
  ]
}
```

`level` is the logic level **after** the transition. `tickUs` is microseconds
since the first edge of the capture session — not since the start of this read —
and `tickNs` is the same instant at full resolution, kept because the kernel
hands it over and the decoder's margins are only a few microseconds wide.

Timestamps originate in the kernel's edge IRQ handler, so they stay accurate
even when Node is scheduled late. What late scheduling costs you is edges lost
to buffer overflow, not skewed timing — and the helper requests a 256-event
buffer against an 85-edge frame precisely so that does not happen.

That the timeline is continuous across reads matters: concatenating the `edges`
arrays of every record replays the whole session as a single stream, idle gaps
between frames included. It survives the per-read process spawn because
`CLOCK_MONOTONIC` keeps running between invocations.

A read that captured nothing is still written, with `edgeCount: 0`, an empty
`edges` array and a non-null `error`. Empty, short and noisy reads are worth
keeping alongside the clean ones, so a failed read never aborts the run.

### End-of-run summary

Printed to the console only, never written to the output file:

- `edgesPerRead` — a complete AM2302 frame is 85 edges (host low, release,
  the sensor's response pulse pair, then 2 edges per data bit). Consistently
  fewer means edges are being dropped.
- `edgeIntervalUs` — the spread of gaps between consecutive edges. On a good
  capture the short end clusters near 26-28us and 70us, the sensor's two
  pulse widths, with the 50us inter-bit low between them.
- `failedReads` — reads where the helper exited non-zero.

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
holds the pin, and the helper will exit with an `EBUSY` hint if it is still
loaded.
