import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
  beforeAll,
  Mock,
} from "vitest";
import { createGpioPollingService } from "../index.js";
import type { GpioPollingCommand } from "../types.js";

// Mock onoff's Gpio
vi.mock("onoff", () => ({
  Gpio: vi.fn().mockImplementation(() => ({
    watch: vi.fn(),
    unwatchAll: vi.fn(),
    unexport: vi.fn(),
  })),
}));

const originalProcess = global.process;

describe("createGpioPollingService", () => {
  let service: ReturnType<typeof createGpioPollingService>;
  let sendFn: Mock;

  beforeEach(() => {
    service = createGpioPollingService();
    sendFn = vi.fn();
    // TODO: WIP: this mock is not setup correctly
    // Fully mock process for each test
    // @ts-ignore
    global.process = {
      // @ts-ignore
      on: vi.fn(() => undefined),
      // @ts-ignore
      send: vi.fn(() => undefined),
    };
  });

  it("should send started status on start", () => {
    const cmd: GpioPollingCommand = { type: "start", pin: 4 };
    service.handleParentMessage(cmd, sendFn);
    expect(sendFn).toHaveBeenCalledWith({
      type: "status",
      status: "started",
      pin: 4,
    });
  });

  it("should send stopped status on stop", () => {
    service.handleParentMessage({ type: "start", pin: 4 }, sendFn);
    sendFn.mockClear();
    service.handleParentMessage({ type: "stop" }, sendFn);
    expect(sendFn).toHaveBeenCalledWith({
      type: "status",
      status: "stopped",
      pin: 4,
    });
  });

  it("should send error for malformed command", () => {
    // @ts-expect-error purposely malformed
    service.handleParentMessage({ type: "bad" }, sendFn);
    expect(sendFn).toHaveBeenCalledWith({
      type: "error",
      reason: "Malformed command",
    });
  });

  it("should cleanup resources on cleanup", () => {
    const cmd: GpioPollingCommand = { type: "start", pin: 4 };
    service.handleParentMessage(cmd, sendFn);
    expect(sendFn).toHaveBeenCalledWith({
      type: "status",
      status: "started",
      pin: 4,
    });
    service.cleanup();
    // No error should be thrown
  });
});
