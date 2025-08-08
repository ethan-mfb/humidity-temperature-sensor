import { vi } from "vitest";
import { dependencies, initializeTempSensorController } from "../injection.js";

export function mockInitializeTempSensorController(
  overrides?: Partial<typeof dependencies>,
): void {
  initializeTempSensorController({
    tempSensorService: {
      status: "stopped",
      lastError: undefined,
      getLatestReading: vi.fn(),
      subscribe: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      ...overrides?.tempSensorService,
    },
  });
}
