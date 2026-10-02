# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

All commands should be run from the `/web-api` directory:

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

## Architecture Overview

This is a **Raspberry Pi IoT sensor application** for reading DHT22/AM2302 temperature and humidity sensors via GPIO pins.

### Core Architecture Patterns

**Process Isolation Design**: GPIO operations run in isolated child processes to prevent hardware issues from crashing the main API server. Communication uses strongly-typed Node.js IPC.

**Event-Driven Services**: All services follow event-driven patterns with subscription-based APIs. Services emit typed events and handle failures gracefully without blocking.

**Functional Programming**: No classes - services created through factory functions. State encapsulated in service closures with immutable data structures.

### Service Layer Architecture

1. **GPIO Pin Polling Service** (`gpioPinPollingService/`)
   - Low-level hardware interface running in child process
   - Direct GPIO access using `onoff` library
   - Real-time polling with IPC communication via `GpioPollingCommand` ↔ `GpioPollingMessage` types

2. **Temperature Sensor Service** (`tempSensorService/`)
   - High-level DHT22/AM2302 sensor data processing
   - Transforms GPIO signals into temperature/humidity readings
   - Signal decoding per sensor datasheet with checksum validation

3. **Child Process Service** (`childProcessService/`)
   - Process lifecycle management abstraction
   - Handles start/stop of child processes with typed interfaces
   - IPC message routing and error handling

### Data Flow
Hardware → GPIO Polling Service (child process) → Temperature Sensor Service → Controllers → HTTP API

### Key Technical Constraints

- **Node.js v16**: Required for `onoff` library compatibility
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