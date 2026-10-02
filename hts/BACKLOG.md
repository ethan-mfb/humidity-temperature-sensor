# hts backlog

hts is built in Sprints, per [the Scrum Guide](../SCRUM_GUIDE.md). This file holds the Scrum
artifacts: the Product Goal, the ordered Product Backlog, the current Sprint Backlog and the
Definition of Done. The Product Owner orders the Product Backlog; the Developers own the Sprint
Backlog.

## Product Goal

A PWA, installed from the pi on any device on the network, that shows the sensor's current and
recent humidity and temperature, and stays current with every deploy without a reinstall.

## Definition of Done

A Product Backlog item is Done, and part of the Increment, only when all of these hold:

1. It was built test first: a failing test came before the code that passes it.
1. `npm run test:once` and `npm run test:e2e` pass.
1. `npm run typecheck`, `npm run lint` and `npm run check-formatting` pass.
1. It follows the clean architecture dependency rule (lint enforces it) and the functional style in
   [LLM_INSTRUCTIONS.md](../LLM_INSTRUCTIONS.md): no classes, no enums, returned errors over thrown
   ones.
1. Its styles follow [BEM](./BEM.md), with colours as `rgba()` tokens.
1. `npm run build` succeeds, and the build installs and updates (the e2e suite covers this).
1. The README describes any new command, configuration or deploy step.
1. It is committed and pushed to `main`.

## Sprint 1 (complete)

**Sprint Goal:** a hello world PWA that can be installed from the pi and picks up new versions.

| #   | Item                                                                    | Status |
| --- | ----------------------------------------------------------------------- | ------ |
| 1   | Scaffold React, TypeScript and Sass with Vite, Vitest and lint          | Done   |
| 2   | Hello world page                                                        | Done   |
| 3   | Web app manifest and icons, so the browser offers an install            | Done   |
| 4   | Precache the app so it loads with the pi offline                        | Done   |
| 5   | Offer a new version when one is deployed, and switch only when accepted | Done   |
| 6   | Install button, shown when the browser allows an install                | Done   |
| 7   | e2e tests for install criteria, offline loading and updates             | Done   |
| 8   | nginx config and manual deploy steps for the pi                         | Done   |
| 9   | CI running the Definition of Done checks on pushes touching `hts/`      | Done   |
| 10  | nginx in the pi image, without its default site                         | Done   |

Found and fixed during the Sprint, by the e2e suite: the manifest was precached twice, which emptied
the precache, and a tab opened before the app was cached never reloaded onto an accepted update.

## Product Backlog

In order. Refine items before pulling them into a Sprint.

1. **Run hosting on the real pi.** Build and flash the image (it now includes nginx), issue the
   certificate, run `setup-pi-hosting.sh`, deploy, and install the app on a phone and a laptop.
   Nothing in Sprint 1 has run on the pi yet.
1. **Decide how hts and the web-api share the pi.** Today the web-api owns port 80 and hts is
   on 443 only, so they are different origins. Either nginx takes 80 and 443 and proxies `/api`
   to the web-api on a local port (one origin, https for both, no CORS), or the web-api allows
   CORS from hts. Needed before the next item.
1. **Show the current reading.** Fetch the latest humidity and temperature from the web-api and
   display them.
1. **Handle the sensor being unreachable.** Show the last reading and its age when the API fails.
1. **Recent history.** A chart of the last 24 hours.
1. **Install on iOS.** Safari never fires `beforeinstallprompt`; show "Add to Home Screen"
   instructions there instead of the install button.
