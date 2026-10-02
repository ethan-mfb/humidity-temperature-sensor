import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startChildProcess,
  stopChildProcess,
  onChildProcessEvent,
  ChildProcessOptions,
  ChildProcessHandle,
} from "../index";

vi.mock("child_process", () => {
  const EventEmitter = require("events");
  return {
    fork: vi.fn(() => {
      const proc = new EventEmitter();
      proc.pid = 1234;
      proc.send = vi.fn();
      proc.kill = vi.fn();
      return proc;
    }),
  };
});

describe("childProcessService", () => {
  let handle: ChildProcessHandle;
  let options: ChildProcessOptions;

  beforeEach(() => {
    options = { command: "dummy.js", args: ["foo"] };
    handle = startChildProcess(options);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should start a child process and emit started event", async () => {
    await new Promise<void>((resolve) => {
      onChildProcessEvent(handle, "started", (evt) => {
        if (evt.type === "started") {
          expect(evt.pid).toBe(1234);
          resolve();
        }
      });
      handle._proc.emit("spawn");
    });
  });

  it("should emit stopped event on exit", async () => {
    await new Promise<void>((resolve) => {
      onChildProcessEvent(handle, "stopped", (evt) => {
        if (evt.type === "stopped") {
          expect(evt.code).toBe(0);
          expect(evt.signal).toBe(null);
          resolve();
        }
      });
      handle._proc.emit("exit", 0, null);
    });
  });

  it("should emit error event on error", async () => {
    const error = new Error("fail");
    await new Promise<void>((resolve) => {
      onChildProcessEvent(handle, "error", (evt) => {
        if (evt.type === "error") {
          expect(evt.error).toBe(error);
          resolve();
        }
      });
      handle._proc.emit("error", error);
    });
  });

  it("should emit message event on message", async () => {
    await new Promise<void>((resolve) => {
      onChildProcessEvent(handle, "message", (evt) => {
        if (evt.type === "message") {
          expect(evt.data).toEqual({ foo: "bar" });
          resolve();
        }
      });
      handle._proc.emit("message", { foo: "bar" });
    });
  });

  it("should send messages to the child process", () => {
    handle.send({ hello: "world" });
    expect(handle._proc.send).toHaveBeenCalledWith({ hello: "world" });
  });

  it("should stop the child process", () => {
    stopChildProcess(handle);
    expect(handle._proc.kill).toHaveBeenCalled();
  });
});
