# Custom Pi image

Builds a Raspberry Pi OS Lite (64-bit) image with the packages in
`packages.txt` already installed, for flashing with Raspberry Pi Imager's
**Use custom** option.

- `build.sh`: runs the build in a privileged arm64 docker container. Start here.
- `build-image.sh`: the build itself. Needs root and loop devices.
- `VERSION`: the image's version. See [Versioning](#versioning).
- `base-image.env`: the pinned Raspberry Pi OS release the image starts from.
- `packages.txt`: what gets installed, one package per line.
- `Dockerfile`: the build environment `build.sh` uses.
- `pi-status/`: the boot check that picks what nginx serves, and its installer.

## What the build does

1. Downloads the release pinned in `base-image.env`. The download is checked
   against the sha256 pinned with it and cached, so a rebuild skips it.
1. Decompresses it, grows the root partition by 1GB (`--grow-mb`), and resizes
   the filesystem to fill the new space.
1. Mounts both partitions, chroots in and runs `apt-get install` on
   `packages.txt`.
1. Removes nginx's default site, which would clash with the hts site on port 80.
1. Installs `pi-status` from `pi-status/`: a boot service that runs before
   nginx and enables either the hts site, if its certificate, release and
   config all check out, or a status page on port 80 saying what is wrong.
   So nginx always starts, and a freshly flashed pi shows what still needs
   setting up at `http://rpi20w.local/`. See "When the pi shows a status page"
   in the root README.
1. Puts back everything that makes the first boot a first boot: an empty
   `machine-id`, no daemons started, and the image's original `resolv.conf`.
   It also writes `/etc/humidity-temp-sensor-image`, recording the version,
   the base image and the package list.
1. Trims free space and writes `out/humidity-temp-sensor-v<VERSION>.img.xz`
   with a `.sha256` next to it.

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

The output lands in `image/out/`. To try a different Raspberry Pi OS release
without changing the pin, run `./build.sh --url <...img.xz url>`. That image is
versioned `<VERSION>-unpinned`, so it is never mistaken for a release.

The builder container is arm64. On Apple Silicon or another arm64 host it runs
natively. On an x86_64 host docker emulates it with qemu, which works but is
much slower. Docker Desktop sets up that emulation by itself; on plain Linux
docker, run this once first:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

### On GitHub

Run the **Build Pi Image** workflow from the Actions tab. It builds on an arm64
runner and attaches the `.img.xz` to the run as the `pi-image-v<VERSION>`
artifact, which is kept for 14 days. The run's summary shows the version and
the image's sha256.

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

The hts site, its certificate and its releases. nginx and pi-status are in
the image, but those are per pi and set up by hand after flashing; see
"Publishing the hts PWA" in the root README.

Node 20. The README installs it with nvm into `~alpha/.nvm`, and that user
does not exist until Imager's customization creates it at first boot. Run
`scripts/setup-pi.sh` after flashing as usual. Its apt step finds everything
already installed, so in practice it only installs node and builds the
capture helper.

## Versioning

`VERSION` is a semantic version, bumped in the same commit as any change to
what ends up in the image:

| Change | Bump |
|---|---|
| Base image moves to a new Debian release (e.g. trixie to forky), or a change that means redoing the per-pi setup after flashing | major |
| Base image moves to a newer release of the same Debian release, a package is added or removed, or the image gains behaviour (e.g. a pi-status check) | minor |
| A fix to `build-image.sh` or `pi-status/` that changes the image without adding anything | patch |
| `README.md`, comments, `build.sh`, `Dockerfile`, or anything outside `image/` | none |

So a rebuild is due when `VERSION` is ahead of the image you last built. To see
what a pi is running, `cat /etc/humidity-temp-sensor-image` on it.

Pinning the base image pins the starting point, not every package: `apt-get
install` still takes the newest versions in the archive on the day of the
build, so two builds of the same `VERSION` can differ in package patch levels.

### Updating the base image

1. Find the current release and its checksum:

   ```bash
   url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
     https://downloads.raspberrypi.com/raspios_lite_arm64_latest)
   echo "$url"; curl -fsSL "$url.sha256"
   ```

1. Put both in `base-image.env`, bump `VERSION` (minor, or major for a new
   Debian release) and build.

## Adding packages

Add a line to `packages.txt`, bump `VERSION` (minor) and rebuild. Packages are
installed with apt's defaults, recommends included, so the result is the same
as running `sudo apt install <package>` on the pi.

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
