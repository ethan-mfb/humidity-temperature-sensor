# humidity-temperature-sensor

A raspberry pi 0 2 w humidity and temperature sensor

- Raspberry Pi 0 2 W
- HiLetgo DHT22/AM23 (ASAIR AM2302)
- [Raspberry Pi Tutorial: How to Use the DHT-22](https://www.instructables.com/Raspberry-Pi-Tutorial-How-to-Use-the-DHT-22/)
- [onoff](https://github.com/fivdi/onoff)

## dev environment

1. install docker desktop
1. on windows, setup WSL 2, install ubuntu 22 LTS and integrate that with docker desktop
1. clone the repository (clone into the ubuntu 22 if on windows)
1. run `./devcontainer.sh "Your Name" "your@email.com"`

   > This will build a Docker container with your git configuration and start the development environment.

## pi setup

### Installing the OS

1. download and install [imager](https://www.raspberrypi.com/software/)
1. select the Raspberry Pi OS Lite (64-bit) image, found under `Raspberry Pi OS (other)`
1. click edit settings
   1. set hostname: `rpi20w`
   1. username: `alpha`
   1. password (check password manager)
   1. WLAN
   1. locale
   1. enable the SSH service: `rpi20w.local`
      1. use password authentication

References

- <https://www.raspberrypi.com/documentation/computers/remote-access.html#ssh>
- <https://www.raspberrypi.com/documentation/computers/getting-started.html#raspberry-pi-imager>

### Verifying GPIO access

onoff reaches the pins through the sysfs interface (`/sys/class/gpio`), which the kernel has
deprecated in favour of the gpiochip character device. Confirm it still exists on the image you
flashed before publishing anything, because onoff cannot work without it.

> **Unresolved on trixie.** Current imager builds are Raspberry Pi OS trixie, which is newer than
> the image these steps were written against. Two things changed there: `pigpio` was dropped from
> the archive entirely, and sysfs GPIO is a kernel config away from disappearing. Run the checks
> below on your own image before trusting any of it. If `/sys/class/gpio` is gone, onoff is a dead
> end and the `web-api` needs to move to the character device — `scripts/` has already made that
> move, see [scripts/README.md](./scripts/README.md#why-there-is-a-c-helper). That migration is
> deliberately not done yet; capture data first, then decide.

1. `ssh alpha@rpi20w.local`
1. run `groups` and confirm `gpio` is listed, so the api does not need root
1. run `ls /sys/class/gpio` and confirm `export` and `unexport` are present
1. identify the header chip and read its base

   ```sh
   ls /sys/class/gpio                      # chip0  export  gpiochip512  unexport
   cat /sys/class/gpio/gpiochip512/label   # pinctrl-bcm2835
   cat /sys/class/gpio/gpiochip512/base    # 512
   cat /sys/class/gpio/gpiochip512/ngpio   # 54
   ```

1. export a pin using its kernel number, base + BCM, with no `sudo`

   ```sh
   echo 516 > /sys/class/gpio/export
   cat /sys/class/gpio/gpio516/direction   # in
   echo 516 > /sys/class/gpio/unexport
   ```

> sysfs numbers are kernel global, not BCM numbers, so `echo 4` fails with `Invalid argument` here.
> See [GPIO numbering](#gpio-numbering) for the arithmetic and the values measured on this device.

> No `sudo` in that second block on purpose. The api runs unprivileged as `alpha` under systemd, so
> unprivileged export is the access that actually has to work.

> If `/sys/class/gpio` is missing then the kernel dropped sysfs GPIO and onoff is a dead end on
> that image, desktop or Lite. The replacement is libgpiod — but not, as this note used to claim,
> via node-libgpiod or opengpio. Both were checked against this sensor and neither can carry a DHT22
> frame: node-libgpiod builds against the v1 API that trixie no longer ships, and opengpio discards
> the kernel edge timestamp. See
> [scripts/README.md](./scripts/README.md#why-there-is-a-c-helper) for the details and the working
> approach.

> The `gpio` group membership comes from udev rules in `raspberrypi-sys-mods`, which Lite has. The
> service unit below runs as `User=alpha` and systemd grants supplementary groups by default, so
> the service inherits it. A dedicated system user would have to be added to the group explicitly.

References

- <https://www.kernel.org/doc/html/latest/admin-guide/gpio/sysfs.html>
- <https://github.com/fivdi/onoff#allowing-access-to-gpio-without-root-privileges>

### Installing Node.js

1. `ssh alpha@rpi20w.local`
1. run `sudo apt update` and `sudo apt upgrade`
1. run `sudo apt install -y build-essential python3 libgpiod-dev pkg-config gpiod`
1. run `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
1. run the following from the install:

   ```sh
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
   [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
   ```

1. run `nvm install 16`
1. run `which node` and note the path, the service unit below needs it

> Using the LTS v16 here because onoff only supports v16.

> Lite ships without a compiler toolchain, unlike the desktop image. onoff depends on epoll, a
> native addon that node-gyp builds on the pi during `npm install`, so build-essential and python3
> have to be in place first.

### Publishing the web-api

1. `cd web-api`
1. `npm install`
1. `npm run package`
1. unzip the contents of the web api zip in the `publish/` directory
1. transfer it to `~/web-api/` on the pi
1. `ssh alpha@rpi20w.local`
1. `cd ~/web-api/`
1. `npm install --omit=dev`
1. `node index.js` to smoke test it
1. navigate to `http://rpi20w.local:3000/`, then stop it with `ctrl+c`

> `npm install --omit=dev` compiles the epoll native addon on the pi, so it needs the build tools
> from the node install step. Node 16 headers against a current gcc is the usual reason this step
> fails.

### Publishing the capture tooling

`scripts/` holds the DHT22 signal capture tool, used to get raw edge data off the hardware and
replay it against the decoder. It ships separately from the api: it is deliberately excluded from
`npm run package`, nothing in `web-api` depends on it, and it is not needed for the service to run.
Publish it when you need to diagnose the sensor, not on every release.

`scripts/setup-pi.sh` covers this section, the apt and node steps above, and the GPIO access
checks, and is safe to re-run.

1. `ssh alpha@rpi20w.local`
1. clone the repository on the pi

   ```sh
   sudo apt install -y git
   git clone https://github.com/ethan-mfb/humidity-temperature-sensor.git
   cd humidity-temperature-sensor/scripts
   ```

1. run `./setup-pi.sh`, which installs the toolchain and node, verifies GPIO access, builds the
   helper and captures one frame as a smoke test
1. run `node capture-sensor.mjs --samples 30 --out baseline.jsonl` to capture, with no `sudo`

> Clone on the pi rather than `scp`-ing from the dev container. `devcontainer.sh` runs the
> container with container-only storage and no bind mount, so the working tree exists only inside
> the container — there is nothing on the host to copy from, and the container cannot resolve
> `rpi20w.local` anyway.

Copying the two files across by hand instead, from a machine that can reach the pi:

1. run `mkdir -p ~/sensor-capture` on the pi, then from the dev machine:

   ```sh
   scp scripts/capture-sensor.mjs scripts/gpiod-capture.c alpha@rpi20w.local:~/sensor-capture/
   ```

1. `cd ~/sensor-capture`
1. build the capture helper

   ```sh
   gcc -O2 -Wall -Wextra -std=gnu17 -o gpiod-capture gpiod-capture.c \
     $(pkg-config --cflags --libs libgpiod)
   ```

> `-std=gnu17` pins the language standard instead of taking the compiler's default. It is a no-op
> for trixie's gcc 14, which already defaults to gnu17, and it is there for the case where the helper
> gets built somewhere newer: gcc 15 defaults to C23, which remaps `strtoul` to `__isoc23_strtoul`
> and raises the binary's glibc floor from 2.34 to 2.38. Trixie ships 2.41 so either clears it today,
> but the floor moves silently as libc calls are added, and this keeps it still.

> Build on the pi. The helper is ~400 lines against one library and compiles in about a second even
> on a Zero 2 W, which removes any question of architecture or library version. If you do build it
> in the dev container, check `uname -m` matches the pi first — `Dockerfile` is `FROM ubuntu:latest`,
> so the container inherits the host's architecture, and an x86_64 host produces a binary the pi
> cannot run. `-static` with `pkg-config --static` is the portable escape hatch if you need one.

> No `sudo`, unlike the pigpio-based tool this replaced. `/dev/gpiochip*` is reachable through the
> `gpio` group. If you do reach for `sudo`, it resets `PATH` to its `secure_path` and will not find
> nvm's node, so it would have to be `sudo $(which node) …`.

See [scripts/README.md](./scripts/README.md) for the output format, the end-of-run summary and why
the timing-critical part is a C helper rather than a node binding.

### Running the web-api as a service

The web-api serves HTTP on its own, so there is no apache or nginx in front of it. systemd keeps
it running across reboots and restarts it if it crashes, and `CAP_NET_BIND_SERVICE` lets it bind
port 80 without running as root.

1. `ssh alpha@rpi20w.local`
1. create `/etc/systemd/system/web-api.service`

   ```ini
   [Unit]
   Description=humidity-temperature-sensor web-api
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=alpha
   WorkingDirectory=/home/alpha/web-api
   # absolute path, systemd does not load nvm; use the output of `which node`
   ExecStart=/home/alpha/.nvm/versions/node/v16.20.2/bin/node index.js
   Environment=NODE_ENV=production
   Environment=PORT=80
   AmbientCapabilities=CAP_NET_BIND_SERVICE
   NoNewPrivileges=true
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

1. run `sudo systemctl daemon-reload`
1. run `sudo systemctl enable --now web-api`
1. verify by navigating to <http://rpi20w.local/>

Day to day

- `sudo systemctl status web-api` to check the service
- `sudo systemctl restart web-api` after publishing a new build
- `journalctl -u web-api -f` to follow the logs

> The nvm path changes with every `nvm install`. If that gets annoying, install node 16 from
> NodeSource so it lands at `/usr/bin/node` and keep nvm for the dev container only.

> The `start` and `stop` endpoints drive the GPIO pin and have no authentication, so keep the
> pi on a trusted network and do not port forward to it.

References

- <https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html>

### Connecting the sensor

1. connect the left pin (i.e. +) to pin 1 for 3,3V of power
1. connect the middle pin (i.e. out) to pin 3 for data
1. connect the right pin (i.e. -) to pin 6 for ground

## raspberry pi 0 2 spec

![rpi pin out](./assets/pinout.jpeg)

### GPIO numbering

The sysfs interface numbers pins globally across every gpiochip in the kernel, not by BCM number.
Older kernels gave the pi's pinctrl chip a fixed base of 0, which made the two numbering schemes
line up by accident. Current kernels allocate chip bases dynamically from `GPIO_DYNAMIC_BASE`
(512), so they no longer match.

```text
kernel gpio number = chip base + BCM number
516                = 512       + 4
```

Measured on this device, a Pi Zero 2 W running Raspberry Pi OS Lite (64-bit):

|       |                               |
| ----- | ----------------------------- |
| chip  | `/sys/class/gpio/gpiochip512` |
| label | `pinctrl-bcm2835`             |
| base  | 512                           |
| ngpio | 54                            |
| BCM 4 | sysfs 516                     |

> Do not treat 512 as a constant. The base is dynamically allocated and can move across a kernel
> update or a different board, so read it back from `/sys/class/gpio/gpiochip*/base`. The directory
> is named after its own base, so `ls /sys/class/gpio` already shows it.

> `ls /sys/class/gpio` also lists a `chip0` entry. It does not follow the `gpiochip<base>` naming
> the sysfs interface documents, and nothing here depends on it.

> Known gap: onoff passes its pin argument straight through to sysfs, so `new Gpio(4, ...)` in
> `gpioPinPollingService` fails with `EINVAL` on this kernel. The base offset is not applied
> anywhere in the code yet.

> This whole section is sysfs-only arithmetic. On the gpiochip character device, line offsets **are**
> BCM numbers — `--pin 2` means BCM 2 — so moving `gpioPinPollingService` to libgpiod deletes the
> problem rather than fixing it. `scripts/gpiod-capture.c` already works this way. Two further
> consequences worth weighing when that migration is scheduled: it would drop the `onoff` dependency,
> and onoff is the only reason this project is pinned to Node v16.

## sensor spec

[Datasheet](https://www.makerguides.com/wp-content/uploads/2019/02/DHT22-AM2302-Datasheet.pdf)

![spec](./assets/AM2302-spec-2022-10-25_03.jpg)

![interface](./assets/AM2302-interface-2022-10-25_04.jpg)
