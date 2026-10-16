# humidity-temperature-sensor

A raspberry pi 0 2 w humidity and temperature sensor

- Raspberry Pi 0 2 W
- HiLetgo DHT22/AM23 (ASAIR AM2302)
- [Raspberry Pi Tutorial: How to Use the DHT-22](https://www.instructables.com/Raspberry-Pi-Tutorial-How-to-Use-the-DHT-22/)
- [libgpiod](https://git.kernel.org/pub/scm/libs/libgpiod/libgpiod.git/about/)

The pi runs the web-api (`web-api/`), which reads the sensor, and serves the hts PWA (`hts/`) with
nginx at <https://rpi20w.local/>. The pi's OS is a custom image built from `image/`.

## dev environment

1. install docker desktop
1. on windows, setup WSL 2, install ubuntu 22 LTS and integrate that with docker desktop
1. clone the repository (clone into the ubuntu 22 if on windows)
1. run `./devcontainer.sh "Your Name" "your@email.com"`

   > This will build a Docker container with your git configuration and start the development environment.

The dev container cannot resolve `rpi20w.local`. Run the `scp` and `ssh` steps below from your own
machine.

## pi setup

### Installing the OS

1. install [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
1. in Imager, set **App Options** > **Content Repository** > **Edit** > **Use custom URL** to
   `https://github.com/ethan-mfb/humidity-temperature-sensor/releases/latest/download/humidity-temp-sensor.rpi-imager-manifest`
   and click **Apply & Restart** (once; Imager keeps it)
1. choose `Raspberry Pi Zero 2 W` and `Humidity temperature sensor`
1. customize the settings (Imager keeps them for the next flash):
   - hostname: `rpi20w`
   - username: `alpha`, password from the password manager
   - WLAN and locale
   - SSH enabled, with password authentication
1. flash, put the card in the pi and power it on

Building and publishing the image itself is in [image/README.md](./image/README.md).

### One-time setup

Done once, not per pi.

1. **Release hts at least once**, so there is a build for the pi to download. See
   [Publishing the hts PWA](#publishing-the-hts-pwa).
1. **Make the certificate**, on your machine with [mkcert](https://github.com/FiloSottile/mkcert).
   The app only installs and updates over https with a trusted certificate.

   ```sh
   mkcert -install
   mkcert -cert-file hts.crt -key-file hts.key rpi20w.local
   ```

1. **Trust mkcert's CA on every phone and laptop** that will use the app. `mkcert -CAROOT` shows
   where `rootCA.pem` is; [hts/README.md](./hts/README.md#one-time-setup) covers Android and iOS.
   Never copy `rootCA-key.pem` anywhere.

Keep `hts.key` out of the image, which is public. The certificate lasts about two years; to renew,
make a new pair and repeat steps 1 and 2 of [Setting up the pi](#setting-up-the-pi).

### Setting up the pi

1. copy the certificate over

   ```sh
   scp hts.crt hts.key alpha@rpi20w.local:
   ```

1. ssh in, clone and run the setup script

   ```sh
   ssh alpha@rpi20w.local
   git clone https://github.com/ethan-mfb/humidity-temperature-sensor.git
   cd humidity-temperature-sensor/scripts
   ./setup-pi.sh
   ```

   It installs node, builds the sensor helper and the web-api, runs the web-api as a service,
   installs the certificate, sets up nginx and installs the newest hts release. It is safe to
   re-run, and takes a while on a Zero 2 W.

1. open <https://rpi20w.local/> and install the app
1. [connect the sensor](#connecting-the-sensor)

### Publishing the hts PWA

1. in the dev container, bump the version, then commit, tag and push

   ```sh
   cd hts
   npm version patch --no-git-tag-version
   VERSION=$(node -p "require('./package.json').version")
   git commit -am "hts: hts/package.json, hts/package-lock.json: Release $VERSION."
   git tag "hts-v$VERSION"
   git push origin main "hts-v$VERSION"
   ```

1. wait for the **hts Release** workflow in GitHub Actions to build it
1. on the pi, install it

   ```sh
   ssh alpha@rpi20w.local
   cd ~/humidity-temperature-sensor
   git pull
   hts/deploy/install-hts.sh
   ```

1. open <https://rpi20w.local/> and check the footer shows the new version. Installed copies offer
   the update within an hour.

To roll back, the pi keeps the two previous releases in `/var/www/hts/releases`. Point the
`current` symlink at one (`ln -sfn /var/www/hts/releases/<version> /var/www/hts/current`) and run
`sudo pi-status`.

### Publishing the web-api

On the pi:

```sh
cd ~/humidity-temperature-sensor
git pull
scripts/setup-pi.sh
```

### Troubleshooting

- **The app does not load:** open <http://rpi20w.local/>. When hts cannot be served it shows what
  is wrong (certificate, release, nginx config, failed services). Fix it, then `sudo pi-status`.
- **`rpi20w.local` does not resolve:** check from your machine, not the dev container. If another
  device had the name, the pi may be `rpi20w-2.local`; `sudo systemctl restart avahi-daemon` on the
  pi gets the name back once the other device is gone. The certificate only matches `rpi20w.local`.
- **ssh does not connect after flashing:** check Imager's settings were applied before debugging the
  network.
- **The sensor reads nothing:** `setup-pi.sh` captures one frame and says what it saw. If the
  helper exits with `EBUSY`, remove `dtoverlay=dht11` from `/boot/firmware/config.txt` and reboot.
- **Logs:** `journalctl -u web-api -f`, `sudo tail -f /var/log/nginx/error.log`,
  `journalctl -u pi-status -b`.

The web-api's `start` and `stop` endpoints have no authentication, so keep the pi on a trusted
network. Raw sensor captures are in [scripts/README.md](./scripts/README.md).

## hardware

### Connecting the sensor

1. connect the left pin (i.e. +) to pin 1 for 3,3V of power
1. connect the middle pin (i.e. out) to pin 3 for data
1. connect the right pin (i.e. -) to pin 6 for ground

### raspberry pi 0 2 spec

![rpi pin out](./assets/pinout.jpeg)

### GPIO numbering

On the gpiochip character device, line offsets **are** BCM numbers. The data wire is on physical
pin 3, which is BCM 2, line 2 of the chip labelled `pinctrl-bcm2835` (54 lines). The helper finds
the chip by label because `/dev/gpiochipN` numbering is not stable across kernels.

> Only the legacy sysfs interface numbers differently: chip base plus BCM number, with the base
> allocated from 512, so BCM 4 is sysfs 516. Nothing here uses sysfs.

### sensor spec

[Datasheet](https://www.makerguides.com/wp-content/uploads/2019/02/DHT22-AM2302-Datasheet.pdf)

![spec](./assets/AM2302-spec-2022-10-25_03.jpg)

![interface](./assets/AM2302-interface-2022-10-25_04.jpg)
