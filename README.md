# humidity-temperature-sensor

A raspberry pi 0 2 w humidity and temperature sensor

- Raspberry Pi 0 2 W
- HiLetgo DHT22/AM23 (ASAIR AM2302)
- [Raspberry Pi Tutorial: How to Use the DHT-22](https://www.instructables.com/Raspberry-Pi-Tutorial-How-to-Use-the-DHT-22/)
- [libgpiod](https://git.kernel.org/pub/scm/libs/libgpiod/libgpiod.git/about/)

## dev environment

1. install docker desktop
1. on windows, setup WSL 2, install ubuntu 22 LTS and integrate that with docker desktop
1. clone the repository (clone into the ubuntu 22 if on windows)
1. run `./devcontainer.sh "Your Name" "your@email.com"`

   > This will build a Docker container with your git configuration and start the development environment.

## pi setup

### Building the image

The pi runs a custom image: a pinned Raspberry Pi OS Lite (64-bit) release with git, the toolchain
and libgpiod already installed, versioned by `image/VERSION`. Run the **Build Pi Image** workflow in
GitHub Actions to publish it as a release, or build it on a machine with docker. See
[image/README.md](./image/README.md) for both, for the package list, and for when to bump the
version.

### Installing the OS

1. download and install [imager](https://www.raspberrypi.com/software/)
1. in Imager, set **App Options** > **Content Repository** > **Edit** > **Use custom URL** to
   `https://github.com/ethan-mfb/humidity-temperature-sensor/releases/latest/download/humidity-temp-sensor.rpi-imager-manifest`
   and click **Apply & Restart**. Once is enough; Imager keeps it. For a local build instead, see
   "Flashing" in `image/README.md`
1. choose `Raspberry Pi Zero 2 W` as the device and `Humidity temperature sensor` as the OS
1. customize the settings (Imager keeps them for the next flash)
   1. set hostname: `rpi20w`
   1. username: `alpha`
   1. password (check password manager)
   1. WLAN
   1. locale
   1. enable the SSH service: `rpi20w.local`
      1. use password authentication

> Imager applies these settings the way the manifest's `init_format` says (`cloudinit-rpi` for
> trixie). If `ssh alpha@rpi20w.local` does not connect after the first boot, check whether the
> settings were applied before you debug the network.

References

- <https://www.raspberrypi.com/documentation/computers/remote-access.html#ssh>
- <https://www.raspberrypi.com/documentation/computers/getting-started.html#raspberry-pi-imager>

### Setting up the pi

`setup-pi.sh` takes a freshly flashed pi to serving hts at <https://rpi20w.local/>. Copy the hts
certificate to the pi first, steps 1 to 3 of [One-time setup](#one-time-setup). Without it the
script still finishes, but nginx serves a status page until the certificate is there and the script
is re-run.

1. `ssh alpha@rpi20w.local`
1. clone the repository

   ```sh
   git clone https://github.com/ethan-mfb/humidity-temperature-sensor.git
   cd humidity-temperature-sensor/scripts
   ```

1. run `./setup-pi.sh`. It is safe to re-run. In order, it:
   1. installs node 20 through nvm, checks GPIO access, builds the capture helper and captures one
      frame as a smoke test
   1. builds the web-api from the clone and runs it as the `web-api` service
      ([Running the web-api as a service](#running-the-web-api-as-a-service))
   1. moves `~/hts.crt` and `~/hts.key` into `/etc/ssl/hts`, if they are there
   1. sets up nginx for hts with `hts/deploy/setup-pi-hosting.sh`
   1. installs the newest hts release, if none is live yet
      ([Publishing](#publishing))
1. open <https://rpi20w.local/>. If it does not load, <http://rpi20w.local/> lists what is missing
   ([When the pi shows a status page](#when-the-pi-shows-a-status-page))

> Clone on the pi rather than `scp`-ing from the dev container. `devcontainer.sh` runs the
> container with container-only storage and no bind mount, so the working tree exists only inside
> the container — there is nothing on the host to copy from, and the container cannot resolve
> `rpi20w.local` anyway.

> Node is the one dependency not baked into the image: nvm installs into the home directory of
> `alpha`, who does not exist until Imager's settings create the user at first boot.

> `setup-pi.sh` also runs `apt update` and `apt full-upgrade`, and its apt install finds every
> package already present. The image carries build-essential and libgpiod-dev because the capture
> helper, which the web-api reads the sensor through, is C compiled on the pi.

### Verifying GPIO access

Both the web-api and the capture tooling reach the pins through the gpiochip character device
(`/dev/gpiochip*`) with libgpiod v2, via the C helper in [`dht22-capture`](./dht22-capture/). The
legacy sysfs interface (`/sys/class/gpio`) is not used. Confirm the device is reachable before
publishing anything. `setup-pi.sh` runs the same checks.

1. `ssh alpha@rpi20w.local`
1. run `groups` and confirm `gpio` is listed, so the api does not need root
1. identify the header chip, with no `sudo`

   ```sh
   gpiodetect          # a chip labelled pinctrl-bcm2835 (54 lines)
   gpioinfo | head
   ```

> No `sudo` on purpose. The api runs unprivileged as `alpha` under systemd, so unprivileged access
> is the access that actually has to work.

> If the kernel `dht11` driver is loaded it holds the data line and the helper exits with `EBUSY`.
> Remove `dtoverlay=dht11` from `/boot/firmware/config.txt` and reboot.

> The `gpio` group membership comes from udev rules in `raspberrypi-sys-mods`, which Lite has. The
> service unit below runs as `User=alpha` and systemd grants supplementary groups by default, so
> the service inherits it. A dedicated system user would have to be added to the group explicitly.

See [scripts/README.md](./scripts/README.md#why-there-is-a-c-helper) for why the timing-critical
part is a C helper rather than a node GPIO library.

References

- <https://www.kernel.org/doc/html/latest/userspace-api/gpio/chardev.html>
- <https://git.kernel.org/pub/scm/libs/libgpiod/libgpiod.git/about/>

### Publishing the web-api

The pi runs the web-api from its clone, built by `setup-pi.sh`, so publishing a new version is a pull
and a re-run, on the pi:

```sh
cd ~/humidity-temperature-sensor
git pull
scripts/setup-pi.sh
```

It rebuilds the capture helper and the web-api, rewrites the service unit and restarts the service.
Then check <http://rpi20w.local:3000/>.

> The web-api depends on `dht22-capture` as `file:../dht22-capture`, and the helper in it has to be
> compiled on the pi. Running from the clone gives it both; a packaged copy on its own has neither.

### Publishing the capture tooling

`scripts/` holds the DHT22 signal capture tool, used to get raw edge data off the hardware and
replay it against the decoder. It ships separately from the api: it is deliberately excluded from
`npm run package` and is not needed for the service to run. The GPIO code it drives the sensor with
lives in the [`dht22-capture`](./dht22-capture/) package, which the `web-api` also depends on.

The clone from [Setting up the pi](#setting-up-the-pi) already has it, and `setup-pi.sh` built the
helper, so capturing needs nothing else:

```sh
cd ~/humidity-temperature-sensor/scripts
git pull
node capture-sensor.mjs --samples 30 --out baseline.jsonl
```

> No `sudo`, unlike the pigpio-based tool this replaced. `/dev/gpiochip*` is reachable through the
> `gpio` group. If you do reach for `sudo`, it resets `PATH` to its `secure_path` and will not find
> nvm's node, so it would have to be `sudo $(which node) …`.

> After a `git pull` that touches `dht22-capture/`, re-run `./setup-pi.sh` to rebuild the helper.

See [scripts/README.md](./scripts/README.md) for the output format, the end-of-run summary, copying
the files across by hand, and why the timing-critical part is a C helper rather than a node binding.

### Running the web-api as a service

The web-api serves HTTP on port 3000. Ports 80 and 443 belong to nginx, which serves the hts PWA
and proxies `/api/` and `/api-docs/` to the web-api, so the app reaches the API at
<https://rpi20w.local/api/> on its own origin (see [Publishing the hts PWA](#publishing-the-hts-pwa)).
Port 3000 still answers directly, which is handy for debugging. systemd keeps the web-api running across
reboots and restarts it if it crashes.

`setup-pi.sh` writes the unit, `/etc/systemd/system/web-api.service`, then enables and restarts the
service. The unit runs `dist/index.js` in `~/humidity-temperature-sensor/web-api` as `alpha`, with
`PORT=3000`, `NODE_ENV=production` and `NoNewPrivileges=true`. systemd does not load nvm, so the unit
names node by its absolute path. That path changes with every `nvm install`, so the script rewrites
the unit on every run; re-run it after changing node.

Verify by navigating to <http://rpi20w.local:3000/>, and, once hts is served, to
<https://rpi20w.local/api/temp-sensor/status> through nginx.

> Moving an existing pi off port 80: an older version of this unit had `Environment=PORT=80` and
> `AmbientCapabilities=CAP_NET_BIND_SERVICE`, and was written by hand at `~/web-api`. Re-running
> `setup-pi.sh` replaces it with the unit above. `~/web-api` can then be deleted.

Day to day

- `sudo systemctl status web-api` to check the service
- `sudo systemctl restart web-api` to restart it
- `journalctl -u web-api -f` to follow the logs

> The `start` and `stop` endpoints drive the GPIO pin and have no authentication, so keep the
> pi on a trusted network and do not port forward to it.

References

- <https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html>

### Publishing the hts PWA

`hts/` is the frontend, a PWA served by nginx on the pi at <https://rpi20w.local/>. The **hts
Release** workflow builds it when a release is tagged, and the pi downloads the build from the GitHub
release, so the pi needs no node for it. nginx also listens on port 80, only to redirect to https. It
also proxies `/api/` and `/api-docs/` to the web-api on port 3000, so the app and the API share one
https origin. [hts/README.md](./hts/README.md) covers the architecture and the npm scripts.

Every step that touches the pi is done by hand: `ssh alpha@rpi20w.local` and run the scripts there.
Nothing in the repo connects to the pi for you.

#### One-time setup

1. **Make a certificate.** Service workers only run over https, and only with a certificate the
   browser trusts, so without one the app can neither install nor update. On a machine with
   [mkcert](https://github.com/FiloSottile/mkcert) (it is not in the dev container):

   ```sh
   mkcert -install
   mkcert -cert-file hts.crt -key-file hts.key rpi20w.local
   ```

1. **Trust mkcert's CA on every phone and laptop that will use the app.** `mkcert -CAROOT` prints
   where `rootCA.pem` is. See [One-time setup](./hts/README.md#one-time-setup) in the hts README
   for Android and iOS. Never copy `rootCA-key.pem` anywhere.

1. **Copy the certificate to the pi**, from the machine that made it:

   ```sh
   scp hts.crt hts.key alpha@rpi20w.local:
   ```

1. **Run `setup-pi.sh` on the pi**, as in [Setting up the pi](#setting-up-the-pi). It moves the
   certificate into `/etc/ssl/hts`, installs the hts site into nginx, creates
   `/var/www/hts/releases` owned by `alpha`, and installs the newest release. Re-running it after a
   `git pull` that changes `hts/deploy/nginx-hts.conf` is how a changed site reaches the pi.

> Keep `hts.key` out of the pi image. The image is published as a public GitHub release, so a key
> baked into it would let anyone pose as `rpi20w.local` to the devices that trust mkcert's CA.

> mkcert's certificates last a little over two years, and the status page warns 30 days before
> expiry. To renew, make a new pair, copy it to the pi and re-run `setup-pi.sh`.

> On a pi flashed before nginx was added to the image, `setup-pi-hosting.sh` stops and says so.
> Reflash, or run `sudo apt-get install -y nginx && sudo rm -f /etc/nginx/sites-enabled/default`
> first.

#### Building

In the dev container, to try a build before releasing it:

```sh
cd hts
npm ci
npm run test:once
npm run test:e2e        # first time: npx playwright install --with-deps chromium
npm run build           # type checks, then writes dist/
npm run preview         # optional: try the build at http://localhost:4173
```

#### Releasing

Each release gets a new version. The version shows in the app's footer, which is how to tell what a
phone or laptop is running, and it names the release directory on the pi.

1. start from an up to date, clean `main`: `git pull`, then `git status` should show nothing
1. bump the version (`patch`, `minor` or `major`):

   ```sh
   cd hts
   npm version patch --no-git-tag-version
   ```

1. commit, tag and push:

   ```sh
   VERSION=$(node -p "require('./package.json').version")
   git commit -am "hts: hts/package.json, hts/package-lock.json: Release $VERSION."
   git tag "hts-v$VERSION"
   git push origin main "hts-v$VERSION"
   ```

1. wait for the **hts Release** workflow the tag starts. It checks the tag matches
   `hts/package.json`, runs the unit tests and lint, builds, and attaches `hts-$VERSION.tgz` to the
   `hts-v$VERSION` release. It does not mark the release latest; that stays the newest pi image,
   whose Imager manifest [Installing the OS](#installing-the-os) points at.

#### Publishing

1. **ssh into the pi** and install the newest release:

   ```sh
   ssh alpha@rpi20w.local
   cd ~/humidity-temperature-sensor
   hts/deploy/install-hts.sh
   ```

   It fetches the tags, downloads the build of the newest `hts-v*` one, and unpacks it into
   `/var/www/hts/releases/<version>`. It then moves the `current` symlink onto it in one step, so
   nginx never serves half of one release and half of another, and runs `sudo pi-status`, which
   should print `pi-status: serving hts.` Last, it removes old releases, keeping the live one and
   the two newest others to roll back to.

   `install-hts.sh 0.1.1` installs that version instead. `install-hts.sh ~/hts-0.1.1.tgz` installs a
   build already on the pi, such as one packaged in the dev container with
   `tar -czf "hts-$VERSION.tgz" -C dist .` and copied over with `scp`. If `rpi20w.local` does not
   resolve from the container, use the pi's address, such as `alpha@192.168.4.35:`.

   It refuses a version that is already installed. That is deliberate: bump the version instead of
   overwriting a release that may be live.

1. `exit` the pi, open <https://rpi20w.local/> and check the footer shows the new version. Copies of
   the app that are already installed or open show "A new version is available." within an hour,
   or the next time they are launched. **Update** switches to it.

#### Rolling back

ssh into the pi and point `current` at an older release:

```sh
ls /var/www/hts/releases
ln -sfn /var/www/hts/releases/<version> /var/www/hts/current.tmp
mv -T /var/www/hts/current.tmp /var/www/hts/current
sudo pi-status
```

Installed copies offer the older version as an update on their next check, the same as a new one.

#### When the pi shows a status page

If <https://rpi20w.local/> does not load, open <http://rpi20w.local/>. When hts cannot be served,
that shows a status page listing what is wrong and how to fix it: a missing, expired or mismatched
certificate, a missing site or release, or nginx rejecting the config (with its `nginx -t` output).
It also lists any failed systemd units.

The page comes from `pi-status`, which comes with the [pi image](./image/README.md) and runs at
every boot, before nginx. It enables the hts site only if every check passes; otherwise it enables
the status page on port 80 instead. Either way nginx starts, so a broken certificate never leaves
the pi serving nothing.

After fixing the problem, ssh into the pi and run `sudo pi-status`. It checks again and, if
everything passes, reloads nginx onto hts. The status page is also written when hts is being
served, at `/var/www/pi-status/index.html`, and lists warnings such as a certificate expiring
within 30 days.

Day to day, on the pi

- `sudo systemctl status nginx` to check the server
- `sudo tail -f /var/log/nginx/error.log` to follow its errors
- `ls -l /var/www/hts/current` to see which release is live
- `sudo pi-status` to re-check, and `journalctl -u pi-status -b` for what it decided at boot

### Connecting the sensor

1. connect the left pin (i.e. +) to pin 1 for 3,3V of power
1. connect the middle pin (i.e. out) to pin 3 for data
1. connect the right pin (i.e. -) to pin 6 for ground

## raspberry pi 0 2 spec

![rpi pin out](./assets/pinout.jpeg)

### GPIO numbering

On the gpiochip character device, line offsets **are** BCM numbers. The sensor's data wire is on
physical pin 3, which is BCM 2, which is line 2 of the header chip. The helper finds that chip by
its label rather than by `/dev/gpiochipN`, because chip numbering is not stable across kernels and
boards.

Measured on this device, a Pi Zero 2 W running Raspberry Pi OS Lite (64-bit):

|                  |                   |
| ---------------- | ----------------- |
| label            | `pinctrl-bcm2835` |
| lines            | 54                |
| physical pin 3   | BCM 2, line 2     |

> Only the legacy sysfs interface numbers differently. It numbers pins globally, as the chip's base
> plus the BCM number, and current kernels allocate that base dynamically from 512, so BCM 4 is
> sysfs 516. Nothing in this repo uses sysfs; that arithmetic matters only when poking
> `/sys/class/gpio` by hand.

## sensor spec

[Datasheet](https://www.makerguides.com/wp-content/uploads/2019/02/DHT22-AM2302-Datasheet.pdf)

![spec](./assets/AM2302-spec-2022-10-25_03.jpg)

![interface](./assets/AM2302-interface-2022-10-25_04.jpg)
