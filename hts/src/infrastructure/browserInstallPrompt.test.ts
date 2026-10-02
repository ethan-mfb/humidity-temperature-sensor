import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { InstallPromptPort, Unsubscribe } from "../application/ports";
import { createBrowserInstallPrompt } from "./browserInstallPrompt";

type FakePromptEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function createPromptEvent(outcome: "accepted" | "dismissed"): FakePromptEvent {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
}

const subscribe = (
  target: EventTarget,
): {
  handlers: { onInstallAvailable: Mock; onInstalled: Mock };
  installPrompt: InstallPromptPort;
  unsubscribe: Unsubscribe;
} => {
  const handlers = { onInstallAvailable: vi.fn(), onInstalled: vi.fn() };
  const installPrompt = createBrowserInstallPrompt(target);
  const unsubscribe = installPrompt.subscribe(handlers);
  return { handlers, installPrompt, unsubscribe };
};

describe("createBrowserInstallPrompt", () => {
  it("holds the browser's prompt and reports it as available", () => {
    const target = new EventTarget();
    const { handlers } = subscribe(target);
    const event = createPromptEvent("accepted");
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onInstallAvailable).toHaveBeenCalledOnce();
  });

  it("reports when the app has been installed", () => {
    const target = new EventTarget();
    const { handlers } = subscribe(target);
    target.dispatchEvent(new Event("appinstalled"));
    expect(handlers.onInstalled).toHaveBeenCalledOnce();
  });

  it("shows the held prompt and returns the user's choice", async () => {
    const target = new EventTarget();
    const { installPrompt } = subscribe(target);
    const event = createPromptEvent("dismissed");
    target.dispatchEvent(event);
    await expect(installPrompt.promptInstall()).resolves.toBe("dismissed");
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it("can only use a held prompt once", async () => {
    const target = new EventTarget();
    const { installPrompt } = subscribe(target);
    target.dispatchEvent(createPromptEvent("accepted"));
    await installPrompt.promptInstall();
    await expect(installPrompt.promptInstall()).rejects.toThrow();
  });

  it("rejects when the browser has not offered an install", async () => {
    const { installPrompt } = subscribe(new EventTarget());
    await expect(installPrompt.promptInstall()).rejects.toThrow();
  });

  it("stops listening once unsubscribed", () => {
    const target = new EventTarget();
    const { handlers, unsubscribe } = subscribe(target);
    unsubscribe();
    target.dispatchEvent(createPromptEvent("accepted"));
    target.dispatchEvent(new Event("appinstalled"));
    expect(handlers.onInstallAvailable).not.toHaveBeenCalled();
    expect(handlers.onInstalled).not.toHaveBeenCalled();
  });
});
