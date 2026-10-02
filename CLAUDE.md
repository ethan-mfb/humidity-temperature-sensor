# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

There are two projects: `web-api/` (the sensor API) and `hts/` (the PWA frontend). Run each
project's commands from its own directory.

### web-api

```bash
cd web-api

# Development
npm run dev              # Start development server with hot reload
npm run build           # Build production bundle
npm run start           # Start production server

# Testing & Quality
npm run test:once       # Run tests once (preferred over npm run test)
npm run test:watch      # Run tests in watch mode
npm run typecheck       # TypeScript type checking
npm run check-formatting # Check code formatting
npm run fix-formatting  # Fix code formatting issues

# Packaging
npm run package         # Build and create distributable package
```

### hts

```bash
cd hts

npm run dev              # Dev server (no service worker)
npm run build            # Type check and production build with the service worker
npm run test:once        # Unit tests once (preferred over npm run test:watch)
npm run test:e2e         # Playwright tests against real builds (install, offline, update)
npm run typecheck        # tsc over the app and the e2e tests
npm run lint             # ESLint, including the clean architecture dependency rule
npm run check-formatting # Check code formatting
```

hts is a React/TypeScript/Sass PWA built with clean architecture (`src/domain`, `src/application`,
`src/adapters`, `src/infrastructure`; dependencies point inward, lint enforces it), test first, with
BEM class names. See `hts/README.md`, `hts/BEM.md` and `hts/BACKLOG.md` (Scrum artifacts and
Definition of Done). The Scrum Guide is in `SCRUM_GUIDE.md`. hts needs Node 22.12+, unlike the
web-api's Node 16.

Deploying hts to the pi is manual on purpose: the developer copies a build with `scp` and runs the
steps on the pi over ssh ("Publishing the hts PWA" in `README.md`). Do not add scripts that connect
to the pi.

## Repository-Wide Standards

Clean architecture, functional style and test-driven development apply to **every** project here.
They are defined once in [LLM_INSTRUCTIONS.md](./LLM_INSTRUCTIONS.md): the four layers and the
inward dependency rule (`### Architecture`), factory functions over classes (`### Functional
style`), and red/green/refactor (`### Test-driven development`). Read those before adding code.

`hts/` is organised by layer and enforces the dependency rule with ESLint. `web-api/` predates the
standard and is organised by service folder; move it toward the layers as you touch it.

## Architecture Overview (web-api)

This is a **Raspberry Pi IoT sensor application** for reading DHT22/AM2302 temperature and humidity sensors via GPIO pins.

### Core Architecture Patterns

**Ports and adapters**: the temp sensor service declares the `SensorFrameSource` port it reads through; implementations live in `sensorFrameSource/`. `src/index.ts` is the composition root and the only module that names one.

**Process isolation**: the timing-critical GPIO work is a C helper, spawned per read, so a hardware stall cannot take the API server with it.

**Event-Driven Services**: All services follow event-driven patterns with subscription-based APIs. Services emit typed events and handle failures gracefully without blocking.

**Functional Programming**: No classes - services created through factory functions. State encapsulated in service closures with immutable data structures.

### Service Layer Architecture

1. **Sensor Frame Source** (`sensorFrameSource/`)
   - Implements the port the temp sensor service reads through
   - `libgpiod.ts` wraps the `dht22-capture` package, which spawns the C helper
   - Swapping the mechanism is a new module here plus a line in `src/index.ts`

2. **Temperature Sensor Service** (`tempSensorService/`)
   - Owns when to read and what the edges mean
   - Signal decoding per sensor datasheet with checksum validation
   - Reads schedule themselves so a slow read cannot overlap the next

3. **DHT22 Capture Package** (`dht22-capture/`, outside web-api)
   - The C helper and its node wrapper, shared with `scripts/`
   - Must be built where it runs: `npm run build` needs `libgpiod-dev`

### Data Flow
Hardware → gpiod-capture (C, spawned per read) → dht22-capture → Sensor Frame Source → Temperature Sensor Service → Controllers → HTTP API

### Key Technical Constraints

- **Node.js v20+**: `onoff` pinned this to v16; the GPIO work is now a spawned C helper, so the runtime is free
- **libgpiod v2**: `libgpiod-dev` and a compiler are needed wherever the helper is built
- **Express.js**: RESTful API with OpenAPI 3.1.0 specification
- **TypeScript**: Strict typing enforced throughout codebase
- **Hardware**: Raspberry Pi GPIO pins for sensor communication

### Error Handling Philosophy

From LLM_INSTRUCTIONS.md:
- Only throw errors when application should halt
- Return error objects that retain call stack data for non-fatal errors
- Use `unknown` type for error handling in try/catch blocks

### Repository Configuration

- Default branch: `main`
- PR format: Conventional commits (`feat:`, `fix:`, etc.)
- Reviewer: `lemke.ethan@gmail.com`
- Testing: Use `npm run test:once` not `npm run test` (watch mode blocks)