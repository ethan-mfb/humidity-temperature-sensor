# Custom Pi image

Builds a Raspberry Pi OS Lite (64-bit) image with the packages in
`packages.txt` already installed, for flashing with Raspberry Pi Imager
through a manifest that lets Imager customize it (see [Flashing](#flashing)).

- `build.sh`: runs the build in a privileged arm64 docker container. Start here.
- `build-image.sh`: the build itself. Needs root and loop devices.
- `VERSION`: the image's version. See [Versioning](#versioning).
- `base-image.env`: the pinned Raspberry Pi OS release the image starts from.
- `imager-manifest.sh`: writes the manifest Imager needs to offer OS
  customization for the image. The workflow publishes one with each release;
  run it yourself only for a local build. See [Flashing](#flashing).
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
   with a `.sha256` next to it, and a `.imager-info` holding the uncompressed
   size and sha256 that Imager verifies the write against.

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
runner and publishes the `pi-image-v<VERSION>` release with three assets: the
`.img.xz`, its `.sha256`, and `humidity-temp-sensor.rpi-imager-manifest`, whose
URL points at that release's `.img.xz`. The release is marked latest, so

```text
https://github.com/ethan-mfb/humidity-temperature-sensor/releases/latest/download/humidity-temp-sensor.rpi-imager-manifest
```

is always the newest image's manifest.

A release is the image of its `VERSION`. The workflow fails before building if
the release already exists: bump `VERSION`, or delete the release (and its
tag) to rebuild it. Releases do not expire, so delete old ones you no longer
need.

## Flashing

Imager 2 greys out OS customization for an image picked with **Use custom**:
it only customizes images it finds in an OS list, which says how (the
`init_format`). So the image is opened through a manifest instead, a one-entry
OS list that points at it.

### A release

1. download and install [imager](https://www.raspberrypi.com/software/)
1. open the manifest in Imager, either way:
   - once and for good: **App Options** > **Content Repository** > **Edit** >
     **Use custom URL**, set to the `releases/latest/download/...` URL from
     [On GitHub](#on-github), then **Apply & Restart**. Imager lists the newest
     release every time it starts.
   - for one flash: download `humidity-temp-sensor.rpi-imager-manifest` from
     the release and double-click it, or run `rpi-imager <the manifest>`.
1. choose the Raspberry Pi Zero 2 W and the **Humidity temperature sensor**
   OS. Imager downloads the image itself and checks the write against its
   sha256.
1. apply the same OS customization settings as in the root README's
   [Installing the OS](../README.md#installing-the-os). Imager keeps them for
   the next flash.

### A local build

The manifest has to point at the image by absolute path, because Imager takes
an image's URL as written rather than relative to the manifest. So write it
on the machine Imager runs on, with the `.img.xz` where it will stay:

```bash
image/imager-manifest.sh path/to/humidity-temp-sensor-v<VERSION>.img.xz
```

It writes `humidity-temp-sensor-v<VERSION>.img.xz.rpi-imager-manifest` next to
the image. Keep the build's `.imager-info` beside the image so the manifest
includes the checksums. Then open the manifest and carry on as for a release.

### Notes

The manifest takes the `init_format` from `BASE_IMAGE_INIT_FORMAT` in
`base-image.env`. trixie's is `cloudinit-rpi`. Imager 1.x applied
customization to any custom image without knowing the format; 2.0 stopped
because applying the wrong one breaks the first boot. To see the official OS
list again, set **Content Repository** back to the default.

## What is not in the image

The hts site, its certificate and its releases, and the web-api. nginx and
pi-status are in the image, but the rest is per pi: `scripts/setup-pi.sh`
sets it up after flashing; see "Setting up the pi" in the root README.

Node 20. `setup-pi.sh` installs it with nvm into `~alpha/.nvm`, and that user
does not exist until Imager's customization creates it at first boot. Its apt
step finds everything else already installed.

## Versioning

`VERSION` is a semantic version, bumped in the same commit as any change to
what ends up in the image:

| Change | Bump |
|---|---|
| Base image moves to a new Debian release (e.g. trixie to forky), or a change that means redoing the per-pi setup after flashing | major |
| Base image moves to a newer release of the same Debian release, a package is added or removed, or the image gains behaviour (e.g. a pi-status check) | minor |
| A fix to `build-image.sh` or `pi-status/` that changes the image without adding anything | patch |
| `README.md`, comments, `build.sh`, `Dockerfile`, `imager-manifest.sh`, or anything outside `image/` | none |

So a new release is due when `VERSION` is ahead of the latest
`pi-image-v<VERSION>` release, and the workflow will not publish a version
twice. To see what a pi is running, `cat /etc/humidity-temp-sensor-image` on
it.

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

1. Put both in `base-image.env`, along with the release's `init_format` from
   Imager's OS list:

   ```bash
   curl -fsSL https://downloads.raspberrypi.com/os_list_imagingutility_v4.json |
     jq -r --arg url "$url" '.. | objects | select(.url? == $url) | .init_format'
   ```

1. Bump `VERSION` (minor, or major for a new Debian release) and build.

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
