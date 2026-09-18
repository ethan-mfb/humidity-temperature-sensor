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

> Lite drops the desktop, browser and office suite, which takes the download from roughly 1.1 GB
> to 0.4 GB, the card from roughly 9 GB to 2.5 GB, and idle RAM from roughly 250-350 MB to
> 50-80 MB. The last one is what matters on a 512 MB Zero 2 W.

> Everything this project needs is still in Lite: systemd, NetworkManager for the WLAN settings
> above, the SSH server, and avahi so `rpi20w.local` resolves. The edit settings dialog behaves
> the same either way. GPIO is kernel level, so the desktop image would not help the sensor
> either.

References

- <https://www.raspberrypi.com/documentation/computers/remote-access.html#ssh>
- <https://www.raspberrypi.com/documentation/computers/getting-started.html#raspberry-pi-imager>

### Verifying GPIO access

onoff reaches the pins through the sysfs interface (`/sys/class/gpio`), which the kernel has
deprecated in favour of the gpiochip character device. Confirm it still exists on the image you
flashed before publishing anything, because onoff cannot work without it.

1. `ssh alpha@rpi20w.local`
1. run `groups` and confirm `gpio` is listed, so the api does not need root
1. run `ls /sys/class/gpio` and confirm `export` and `unexport` are present
1. run `echo 4 | sudo tee /sys/class/gpio/export`, then `ls /sys/class/gpio` and confirm `gpio4`
   appeared
1. run `echo 4 | sudo tee /sys/class/gpio/unexport` to clean up

> If `/sys/class/gpio` is missing then the kernel dropped sysfs GPIO and onoff is a dead end on
> that image, desktop or Lite. The replacement would be a libgpiod backed binding such as
> node-libgpiod or opengpio.

> The `gpio` group membership comes from udev rules in `raspberrypi-sys-mods`, which Lite has. The
> service unit below runs as `User=alpha` and systemd grants supplementary groups by default, so
> the service inherits it. A dedicated system user would have to be added to the group explicitly.

References

- <https://www.kernel.org/doc/html/latest/admin-guide/gpio/sysfs.html>
- <https://github.com/fivdi/onoff#allowing-access-to-gpio-without-root-privileges>

### Installing Node.js

1. `ssh alpha@rpi20w.local`
1. run `sudo apt update` and `sudo apt upgrade`
1. run `sudo apt install -y build-essential python3`
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

## sensor spec

[Datasheet](https://www.makerguides.com/wp-content/uploads/2019/02/DHT22-AM2302-Datasheet.pdf)

![spec](./assets/AM2302-spec-2022-10-25_03.jpg)

![interface](./assets/AM2302-interface-2022-10-25_04.jpg)
