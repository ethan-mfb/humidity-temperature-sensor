import { fork, ChildProcess, Serializable } from "child_process";
import { EventEmitter } from "events";

export type ChildProcessOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type ChildProcessEvent =
  | { type: "started"; pid: number }
  | { type: "stopped"; code: number | null; signal: string | null }
  | { type: "error"; error: Error }
  | { type: "message"; data: Serializable };

export type ChildProcessHandle = {
  pid: number;
  send: (message: Serializable) => void;
  stop: () => void;
  _proc: ChildProcess;
  _emitter: EventEmitter;
};

export function startChildProcess(
  options: ChildProcessOptions,
): ChildProcessHandle {
  const emitter = new EventEmitter();
  const proc = fork(options.command, options.args ?? [], {
    env: options.env,
    cwd: options.cwd,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  proc.on("spawn", () => {
    emitter.emit("event", { type: "started", pid: proc.pid });
  });
  proc.on("exit", (code, signal) => {
    emitter.emit("event", { type: "stopped", code, signal });
  });
  proc.on("error", (error) => {
    emitter.emit("event", { type: "error", error });
  });
  proc.on("message", (data) => {
    emitter.emit("event", { type: "message", data });
  });

  return {
    pid: proc.pid ?? -1,
    send: (message: Serializable) => proc.send(message),
    stop: () => proc.kill(),
    _proc: proc,
    _emitter: emitter,
  };
}

export function stopChildProcess(handle: ChildProcessHandle): void {
  handle.stop();
}

export function onChildProcessEvent(
  handle: ChildProcessHandle,
  event: ChildProcessEvent["type"],
  listener: (event: ChildProcessEvent) => void,
): void {
  handle._emitter.on("event", (evt: ChildProcessEvent) => {
    if (evt.type === event) listener(evt);
  });
}
