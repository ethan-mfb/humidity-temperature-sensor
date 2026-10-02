# hts

The humidity and temperature sensor's frontend: a progressive web app (PWA), hosted on the pi,
installable on any device on the network, and updated in place whenever a new version is deployed.

The MVP is a hello world that installs, works offline and updates. Sensor readings come next; see
[BACKLOG.md](./BACKLOG.md).

- React 19, TypeScript, Sass, built with Vite 8
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Workbox) for the manifest, icons and service
  worker
- Vitest and Testing Library for unit tests, Playwright for end-to-end tests
- Clean architecture, functional style, test-driven, [BEM](./BEM.md) class names
- Run in Sprints per [the Scrum Guide](../SCRUM_GUIDE.md)

## Getting started

Requires Node 22.12 or newer (Vite 8's minimum). This is separate from the web-api, which stays on
Node 16 for `onoff`; the pi never runs Node for hts, only nginx.

```bash
cd hts
npm install
npm run dev
```

The service worker is only built into production builds. To try installing and updating, use
`npm run build && npm run preview` and open <http://localhost:4173>. Browsers treat `localhost` as
secure, so no certificate is needed there.

## Commands

All run from `hts/`.

| Command                    | What it does                                                               |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`              | Dev server with hot reload. No service worker.                             |
| `npm run build`            | Type check, then a production build with the service worker, to `dist/`    |
| `npm run preview`          | Serves `dist/` on <http://localhost:4173>                                  |
| `npm run test:once`        | Unit tests, once. Use this one, not `test:watch`, from scripts and agents. |
| `npm run test:watch`       | Unit tests in watch mode, for the red/green loop                           |
| `npm run test:e2e`         | Playwright tests against real production builds                            |
| `npm run typecheck`        | `tsc` over the app, then over the e2e tests and configs                    |
| `npm run lint`             | ESLint, including the architecture rules below                             |
| `npm run check-formatting` | Prettier check                                                             |
| `npm run fix-formatting`   | Prettier write                                                             |

`test:e2e` needs Playwright's Chromium once: `npx playwright install --with-deps chromium`. In the dev
container, `--with-deps` uses apt, so it needs sudo, and has to be re-run after the container is
rebuilt.

CI runs all of these on every push touching `hts/`: [hts-tests.yml](../.github/workflows/hts-tests.yml).

## Architecture

hts follows the repo's [clean architecture, functional style and
TDD](../LLM_INSTRUCTIONS.md#architecture). This is how the four layers land here:

| Layer                | Directory             | Holds                                                                                    | May import          |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------- | ------------------- |
| Domain               | `src/domain/`         | Entities and rules as pure functions: `greeting`, the `pwaLifecycle` reducer, `appError` | nothing             |
| Application          | `src/application/`    | Use cases (`pwaService`), the ports they need, the `store`                               | domain              |
| Interface adapters   | `src/adapters/`       | React components and hooks, `bem()`                                                      | application, domain |
| Frameworks & drivers | `src/infrastructure/` | Port implementations over browser and Workbox APIs                                       | application, domain |

`src/main.tsx` is the composition root. ESLint enforces the dependency rule, and also bans React
imports from the domain and application: run `npm run lint`.

### Data flow

1. The browser or service worker reports something (a new version is waiting, the app is cached, an
   install is offered) through a port.
1. `pwaService` turns it into a domain event, such as `{ type: "updateFound" }`, and dispatches it.
1. The `store` reduces it with `pwaReducer` into a new, immutable `PwaState`.
1. React reads the state with `useSyncExternalStore` and renders.
1. User actions go back through `pwaService` (`applyUpdate`, `install`), which calls the ports.

Components follow the React rules in [LLM_INSTRUCTIONS.md](../LLM_INSTRUCTIONS.md): `function`
declarations, props typed inline and never destructured, display text in a `text` object.

## Tests

Written test-first, per [LLM_INSTRUCTIONS.md](../LLM_INSTRUCTIONS.md#test-driven-development).
Vitest and Testing Library cover the layers; `e2e/` builds the app twice with different versions and
drives real Chromium through install criteria, offline loading and updating.

## Installing and updating

- **Install:** when the browser offers an install, an **Install app** button appears in the header.
  Chromium browsers offer one; Safari does not, so on iOS use Share → Add to Home Screen.
- **Offline:** the first visit precaches the whole app and shows "Ready to work offline." After
  that, it loads with the pi unreachable.
- **Updates:** open copies check the pi for a new version every hour and on every launch. When one
  is found they show "A new version is available." **Update** switches to it and reloads; **Later**
  keeps the current version until the next check. Nothing switches without the user choosing it.
- The running version is in the footer. It comes from `version` in `package.json`, so bump it with
  each release.

## Hosting on the pi

nginx on the pi serves the built files over https. Service workers only run in a secure context, so
over plain http the app loads but can neither install nor update. `deploy/` has everything:

- `nginx-hts.conf`: the site, on port 443 only. It never lets an http cache hold `sw.js`,
  `index.html` or the manifest, and caches the hashed files in `/assets/` for a year.
- `setup-pi-hosting.sh`: one-time setup on the pi.
- `deploy.sh`: builds and deploys from the dev container.

The app is at <https://rpi20w.local/>. Port 80 stays with the web-api's systemd service (see
[Running the web-api as a service](../README.md#running-the-web-api-as-a-service)), so
<http://rpi20w.local/> is still the API. Putting both behind nginx is in the backlog.

> Sprint 1 tested the nginx config in the dev container but has not run it on the pi yet. That is
> the top item in [BACKLOG.md](./BACKLOG.md).

### One-time setup

1. **Make a certificate.** The browser has to trust the certificate, or it will not run the service
   worker. [mkcert](https://github.com/FiloSottile/mkcert) makes a local certificate authority and
   certificates it signs. On your workstation:

   ```bash
   mkcert -install
   mkcert -cert-file hts.crt -key-file hts.key rpi20w.local
   ```

1. **Trust the CA on every device that will use the app.** `mkcert -CAROOT` prints where
   `rootCA.pem` is. Install it as a trusted CA on each device: on most Android versions, under Settings → Security →
   Encryption & credentials → Install a certificate → CA certificate. On iOS, install the profile,
   then turn it on under Settings → General → About → Certificate Trust Settings. Never share
   `rootCA-key.pem`.

1. **Copy the certificate to the pi:**

   ```bash
   scp hts.crt hts.key alpha@rpi20w.local:
   ssh alpha@rpi20w.local 'sudo mkdir -p /etc/ssl/hts \
     && sudo mv hts.crt hts.key /etc/ssl/hts/ \
     && sudo chmod 600 /etc/ssl/hts/hts.key'
   ```

1. **Set up nginx on the pi**, from the repository clone there:

   ```bash
   cd humidity-temperature-sensor/hts/deploy
   ./setup-pi-hosting.sh
   ```

### Deploying

From `hts/` in the dev container:

```bash
./deploy/deploy.sh            # alpha@rpi20w.local
./deploy/deploy.sh user@host  # anywhere else
```

It builds, uploads the build to `/var/www/hts/releases/<timestamp>`, and moves the
`/var/www/hts/current` symlink onto it in one step. The three newest releases are kept. To roll
back, point `current` at an older one:

```bash
ssh alpha@rpi20w.local 'ls /var/www/hts/releases'
ssh alpha@rpi20w.local 'ln -sfn /var/www/hts/releases/<timestamp> /var/www/hts/current'
```

Open copies of the app see the new version on their next hourly check or launch.

## Project files

| Path                 | What                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/`               | The app, by layer (see [Architecture](#architecture))                                                          |
| `src/styles/`        | `_tokens.scss` (colours as `rgba()`, spacing, fonts) and `global.scss`                                         |
| `public/favicon.svg` | The icon source. The PNG icons and `favicon.ico` are generated from it at build time (`pwa-assets.config.ts`). |
| `e2e/`               | Playwright tests, with a static server that can switch builds or go down                                       |
| `deploy/`            | nginx config and the pi scripts                                                                                |
| `vite.config.ts`     | Build, PWA manifest, Workbox and Vitest config                                                                 |
| `eslint.config.js`   | Lint rules, including the architecture and functional style rules                                              |
| `BEM.md`             | The CSS naming reference                                                                                       |
| `BACKLOG.md`         | Product Goal, backlog, Sprint and Definition of Done                                                           |
