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
1. run `./devcontainer.sh`

## pi setup

### Installing the OS

1. install imager
1. select the Raspberry Pi OS (64-bit) image
1. click edit settings
   1. set hostname: `rpi20w`
   1. username: `alpha`
   1. password
   1. WLAN: asus 2G
   1. locale
   1. enable the SSH service: `rpi20w.local`

References

- <https://www.raspberrypi.com/documentation/computers/remote-access.html#ssh>
- <https://www.raspberrypi.com/documentation/computers/getting-started.html#raspberry-pi-imager>

### Setting up the web server

1. SSH into the pi
1. run `sudo apt update` and `sudo apt upgrade`
1. run `sudo apt install apache2 -y`
1. verify by navigating to <http://rpi20w.local/>
1. configure apache as a reverse proxy
   1. `sudo a2enmod proxy`
   1. `sudo a2enmod proxy_http`
   1. `sudo systemctl restart apache2`
1. add the site configuration file for web-api to `/etc/apache2/sites-available/000-default.conf`

   ```conf
   <VirtualHost *:80>
      # ...existing config...
      # use the port web-api is setup for
      ProxyPass / http://localhost:3000/
      ProxyPassReverse / http://localhost:3000/
   </VirtualHost>
   ```

1. `sudo systemctl restart apache2`

References

- <https://www.raspberrypi.com/documentation/computers/remote-access.html#set-up-an-apache-web-server>

### Installing Node.js

1. SSH into the pi
1. run `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`
1. run `nvm install 16`

> Using the LTS v16 here because onoff only supports v16.

### Publishing the web-api

1. `cd web-api`
1. `npm install`
1. `npm run package`
1. unzip the contents of the web api zip in the `publish/` directory
1. transfer it to `~/web-api/` on the pi
1. SSH into the alpha (i.e. `alpha@rpi20w.local`)
1. `cd ~/web-api/`
1. `npm install --omit=dev`
1. `node index.js`

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
