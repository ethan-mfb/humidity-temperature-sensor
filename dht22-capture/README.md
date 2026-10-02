# dht22-capture

DHT22/AM2302 frame capture over libgpiod. One triggered read gives you the raw
edge stream the sensor produced; nothing here interprets the signal.

Two consumers depend on it, which is why it is a package rather than part of
either:

- [`scripts/capture-sensor.mjs`](../scripts/capture-sensor.mjs) — records
  captures to replay against the decoder.
- [`web-api`](../web-api/) — takes live readings from the sensor.

## Building

The helper is C, compiled against libgpiod v2. It is not prebuilt and not
checked in; build it wherever it runs.

```sh
sudo apt install -y build-essential libgpiod-dev pkg-config
npm run build        # -> bin/gpiod-capture
npm run test:once
```

On the pi, [`scripts/setup-pi.sh`](../scripts/setup-pi.sh) does this for you.

## Using it

```js
import { createLibgpiodSession, requireHelper } from "dht22-capture";

await requireHelper();

const session = createLibgpiodSession({ bcmPin: 2 });
const { edges, resolvedChip, error } = await session.readFrame();
```

`readFrame()` drives the start signal, listens for the sensor's answer and
resolves with every edge it saw:

```js
{ level: 1, tickUs: 73, tickNs: 73075 }
```

`tickUs` and `tickNs` are measured from the session's first edge, not from the
start of the read. The helper reports absolute `CLOCK_MONOTONIC` nanoseconds and
the clock keeps running between invocations, so a session spanning many reads
stays one continuous timeline with the idle gaps intact.

A read that captures nothing is **data, not a failure**: `edges` comes back
empty and `error` describes what went wrong, and the caller decides whether to
continue. Only a missing helper throws, from `requireHelper()`, because there is
then nothing to capture with.

## Why the timing-critical part is C

A DHT22 frame has to be captured by a single process that never lets go of the
line. The host drives the start pulse as an output, releases to an input, and
the sensor answers ~30us later. libgpiod requests own their lines exclusively,
so that handover has to happen as one
`gpiod_line_request_reconfigure_lines()` call on one request.

No published node binding exposes that call, the kernel's edge timestamps, or
the request's event buffer size, and all three are needed. Timing edges from the
node event loop does not work either: a 0 bit is a ~26us high pulse and a 1 bit
~70us, which is far below the resolution the event loop can resolve.

See the header comment in [`src/gpiod-capture.c`](./src/gpiod-capture.c) for the
wire format and the `-std=gnu17` pin.

## Each read spawns the helper

Spawn cost is a few milliseconds against a read interval measured in seconds —
the sensor supports one reading every 2s — and it leaves the line unowned
between reads, so nothing else on the pi is locked out.
