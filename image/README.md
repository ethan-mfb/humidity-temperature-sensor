# Custom Pi image

Builds a Raspberry Pi OS Lite (64-bit) image with the packages in
`packages.txt` already installed, for flashing with Raspberry Pi Imager's
**Use custom** option.

- `build.sh`: runs the build in a privileged arm64 docker container. Start here.
- `build-image.sh`: the build itself. Needs root and loop devices.
- `packages.txt`: what gets installed, one package per line.
- `Dockerfile`: the build environment `build.sh` uses.

## What the build does

1. Follows `https://downloads.raspberrypi.com/raspios_lite_arm64_latest` to the
   current release and downloads it. The download is checked against the
   published `.sha256` and cached, so a rebuild skips it.
1. Decompresses it, grows the root partition by 1GB (`--grow-mb`), and resizes
   the filesystem to fill the new space.
1. Mounts both partitions, chroots in and runs `apt-get install` on
   `packages.txt`.
1. Removes nginx's default site, which would take port 80 from the web-api.
   nginx starts on boot with no sites until the hts site is added; see
   "Publishing the hts PWA" in the root README.
1. Puts back everything that makes the first boot a first boot: an empty
   `machine-id`, no daemons started, and the image's original `resolv.conf`.
   It also writes `/etc/humidity-temp-sensor-image`, recording the base image
   and the package list.
1. Trims free space and writes `out/<base>-humidity-temp-sensor.img.xz` with a
   `.sha256` next to it.

The boot partition, `cmdline.txt` and the disk identifier are left alone. The
first boot still grows the root partition to fill the card, and Imager's OS
customization still applies.

## Building

### Locally

Run this on a machine with docker. It will not work in the dev container (see
[Why not the dev container](#why-not-the-dev-container)):

```bash
git clone https://github.com/ethan-mfb/humidity-temperature-sensor.git
cd humidity-temperature-sensor/image
./build.sh
```

The output lands in `image/out/`. Pin a specific release instead of the latest
with `./build.sh --url <...img.xz url>`.

The builder container is arm64. On Apple Silicon or another arm64 host it runs
natively. On an x86_64 host docker emulates it with qemu, which works but is
much slower. Docker Desktop sets up that emulation by itself; on plain Linux
docker, run this once first:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

### On GitHub

Run the **Build Pi Image** workflow from the Actions tab. It builds on an arm64
runner and attaches the `.img.xz` to the run as the `pi-image` artifact, which
is kept for 14 days.

## Flashing

1. download and install [imager](https://www.raspberrypi.com/software/)
1. choose the device, then for the OS scroll to **Use custom** and select the
   `.img.xz`. You don't need to decompress it first.
1. apply the same OS customization settings as in the root README's
   [Installing the OS](../README.md#installing-the-os)

> Imager reads `init_format` from its own OS list to decide how to apply OS
> customization. A local file has no list entry, so check that the hostname,
> user, WLAN and SSH settings actually take effect on the first flash. The base
> image is trixie, which applies them through cloud-init.

## What is not in the image

The hts site, its certificate and its releases. nginx is in the image, but
those are per pi and set up by hand after flashing; see "Publishing the hts
PWA" in the root README.

Node 16. The README installs it with nvm into `~alpha/.nvm`, and that user
does not exist until Imager's customization creates it at first boot. Run
`scripts/setup-pi.sh` after flashing as usual. Its apt step finds everything
already installed, so in practice it only installs node and builds the
capture helper.

## Adding packages

Add a line to `packages.txt` and rebuild. Packages are installed with apt's
defaults, recommends included, so the result is the same as running
`sudo apt install <package>` on the pi.

## Why not the dev container

The build has to edit the files inside the `.img`. An `.img` is a whole disk
(a partition table plus a FAT boot partition and an ext4 root partition), and
Linux only mounts filesystems that sit on a block device. A **loop device**
(`/dev/loopN`) is the kernel feature that makes a regular file look like a
block device so it can be mounted.

Setting one up is a privileged kernel operation. It needs `/dev/loop-control`
and the `CAP_SYS_ADMIN` capability. Docker drops both from containers by
default, and `devcontainer.sh` does not add them back, so
`losetup`/`mount` fail in there even under `sudo`. `build.sh` passes
`--privileged`, which restores them for the builder container only.

Adding `--privileged` to `devcontainer.sh` would also work, but it gives the
long-running dev container near-root access to the docker host, all the time,
for the sake of one occasional build.
