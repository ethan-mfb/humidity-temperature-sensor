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

### Building the image

The pi runs a custom image: the latest Raspberry Pi OS Lite (64-bit) with git, the toolchain and
libgpiod already installed. Build it on a machine with docker, or with the **Build Pi Image**
workflow in GitHub Actions. See [image/README.md](./image/README.md) for both, and for the package
list.

### Installing the OS

1. download and install [imager](https://www.raspberrypi.com/software/)
1. choose `Raspberry Pi Zero 2 W` as the device
1. for the OS, scroll to `Use custom` and select the `.img.xz` from `image/out/`, or the one
   downloaded from the workflow run
1. click edit settings
   1. set hostname: `rpi20w`
   1. username: `alpha`
   1. password (check password manager)
   1. WLAN
   1. locale
   1. enable the SSH service: `rpi20w.local`
      1. use password authentication

> Imager normally decides how to apply these settings from its own OS list, which a `Use custom`
> file is not in. If `ssh alpha@rpi20w.local` does not connect after the first boot, check whether
> the settings were applied before you debug the network.

References

- <https://www.raspberrypi.com/documentation/computers/remote-access.html#ssh>
- <https://www.raspberrypi.com/documentation/computers/getting-started.html#raspberry-pi-imager>

### Setting up the pi

1. `ssh alpha@rpi20w.local`
1. clone the repository

   ```sh
   git clone https://github.com/ethan-mfb/humidity-temperature-sensor.git
   cd humidity-temperature-sensor/scripts
   ```

1. run `./setup-pi.sh`. It installs node 16 through nvm, checks GPIO access, builds the capture
   helper and captures one frame as a smoke test. It is safe to re-run.
1. open a new shell, run `which node` and note the path. The service unit below needs it.

> Clone on the pi rather than `scp`-ing from the dev container. `devcontainer.sh` runs the
> container with container-only storage and no bind mount, so the working tree exists only inside
> the container — there is nothing on the host to copy from, and the container cannot resolve
> `rpi20w.local` anyway.

> Node 16, because onoff only supports v16. It is the one dependency not baked into the image:
> nvm installs into the home directory of `alpha`, who does not exist until Imager's settings create
> the user at first boot.

> `setup-pi.sh` also runs `apt update` and `apt full-upgrade`, and its apt install finds every
> package already present. onoff depends on epoll, a native addon that node-gyp builds on the pi
> during `npm install`, which is why the image carries build-essential and python3.

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
> from the image. Node 16 headers against a current gcc is the usual reason this step fails.

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

The web-api serves HTTP on its own, on port 3000, so there is no apache or nginx in front of it.
Ports 80 and 443 belong to nginx, which serves the hts PWA (see
[Publishing the hts PWA](#publishing-the-hts-pwa)). systemd keeps the web-api running across
reboots and restarts it if it crashes.

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
   Environment=PORT=3000
   NoNewPrivileges=true
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

1. run `sudo systemctl daemon-reload`
1. run `sudo systemctl enable --now web-api`
1. verify by navigating to <http://rpi20w.local:3000/>

> Moving an existing pi off port 80: an older version of this unit had `Environment=PORT=80` and
> `AmbientCapabilities=CAP_NET_BIND_SERVICE`. Change the first to `PORT=3000`, delete the second,
> then run `sudo systemctl daemon-reload` and `sudo systemctl restart web-api`. Do this before
> enabling the hts site, or nginx cannot bind port 80 and will not start.

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

### Publishing the hts PWA

`hts/` is the frontend, a PWA served by nginx on the pi at <https://rpi20w.local/>. It is built in
the dev container; the pi only serves the built files, so it needs no node for this. nginx also
listens on port 80, only to redirect to https. The web-api is on port 3000. [hts/README.md](./hts/README.md) covers the
architecture and the npm scripts.

Every step that touches the pi is done by hand: copy files with `scp`, then `ssh alpha@rpi20w.local`
and run the commands there. Nothing in the repo connects to the pi for you.

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

1. **ssh into the pi** and do the rest there:

   ```sh
   ssh alpha@rpi20w.local
   ```

1. **Move the certificate into place:**

   ```sh
   sudo mkdir -p /etc/ssl/hts
   sudo mv ~/hts.crt ~/hts.key /etc/ssl/hts/
   sudo chmod 600 /etc/ssl/hts/hts.key
   ```

1. **Install the site**, from the clone made in [Setting up the pi](#setting-up-the-pi):

   ```sh
   cd ~/humidity-temperature-sensor
   git pull
   cd hts/deploy
   ./setup-pi-hosting.sh
   ```

   nginx comes with the [pi image](./image/README.md), already without its default site, which
   would clash with the hts site on port 80. The script adds the hts site, creates
   `/var/www/hts/releases` owned by `alpha`, and runs [`pi-status`](#when-the-pi-shows-a-status-page)
   to choose what nginx serves. Until the first release is deployed that is a status page saying
   so, at <http://rpi20w.local/>. It is safe to re-run.

   > On a pi flashed before nginx was added to the image, the script stops and says so. Reflash, or
   > run `sudo apt-get install -y nginx && sudo rm -f /etc/nginx/sites-enabled/default` first.

1. `exit` the pi

#### Building

In the dev container:

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

1. build it, as in [Building](#building), so `dist/` matches the release commit
1. package the build:

   ```sh
   tar -czf "hts-$VERSION.tgz" -C dist .
   ```

#### Publishing

1. **Copy the package to the pi**, from `hts/` in the dev container:

   ```sh
   scp "hts-$VERSION.tgz" alpha@rpi20w.local:
   ```

   If `rpi20w.local` does not resolve, use the pi's address instead, such as
   `alpha@192.168.4.35:`.

1. **ssh into the pi:**

   ```sh
   ssh alpha@rpi20w.local
   ```

1. **Unpack it as a new release.** Set `VERSION` to the version you just released:

   ```sh
   VERSION=0.1.1
   RELEASE=/var/www/hts/releases/$VERSION
   mkdir "$RELEASE"
   tar -xzf ~/hts-$VERSION.tgz -C "$RELEASE"
   rm ~/hts-$VERSION.tgz
   ```

   `mkdir` fails if that version is already on the pi. That is deliberate: bump the version
   instead of overwriting a release that may be live.

1. **Switch to it:**

   ```sh
   ln -sfn "$RELEASE" /var/www/hts/current.tmp
   mv -T /var/www/hts/current.tmp /var/www/hts/current
   ls -l /var/www/hts/current
   ```

   The `mv` replaces the `current` symlink in one step, so nginx never serves half of one release
   and half of another.

1. **Check it can be served:**

   ```sh
   sudo pi-status
   ```

   It should print `pi-status: serving hts.` On the first deploy this is what switches nginx from
   the status page to hts. After that it only re-checks, and the reload it does is harmless.

1. **Clear out old releases**, keeping the last two or three to roll back to:

   ```sh
   ls /var/www/hts/releases
   rm -rf /var/www/hts/releases/<old version>
   ```

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
> problem rather than fixing it. `dht22-capture/src/gpiod-capture.c` already works this way. Two further
> consequences worth weighing when that migration is scheduled: it would drop the `onoff` dependency,
> and onoff is the only reason this project is pinned to Node v16.

## sensor spec

[Datasheet](https://www.makerguides.com/wp-content/uploads/2019/02/DHT22-AM2302-Datasheet.pdf)

![spec](./assets/AM2302-spec-2022-10-25_03.jpg)

![interface](./assets/AM2302-interface-2022-10-25_04.jpg)
