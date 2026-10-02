import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLibgpiodSession, requireHelper } from "dht22-capture";
import { createLibgpiodFrameSource } from "../libgpiod.js";
import { createGpioPin } from "../../types/nominal-utils.js";

vi.mock("dht22-capture", () => ({
  requireHelper: vi.fn(async () => undefined),
  createLibgpiodSession: vi.fn(),
}));

const readFrame = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createLibgpiodSession).mockReturnValue({ readFrame });
});

describe("createLibgpiodFrameSource", () => {
  it("reads the pin it was built for", async () => {
    readFrame.mockResolvedValue({ edges: [], resolvedChip: null, error: null });

    await createLibgpiodFrameSource({ pin: createGpioPin(2) }).readFrame();

    expect(createLibgpiodSession).toHaveBeenCalledWith(
      expect.objectContaining({ bcmPin: 2 }),
    );
  });

  it("maps captured edges onto the service's edge type", async () => {
    readFrame.mockResolvedValue({
      edges: [
        { level: 1, tickUs: 0, tickNs: 0 },
        { level: 0, tickUs: 25, tickNs: 24792 },
      ],
      resolvedChip: "/dev/gpiochip4",
      error: null,
    });

    const capture = await createLibgpiodFrameSource({
      pin: createGpioPin(2),
    }).readFrame();

    expect(capture).toEqual({
      edges: [
        { pin: 2, value: 1, timestamp: 0 },
        { pin: 2, value: 0, timestamp: 25 },
      ],
      error: null,
    });
  });

  it("passes a failed capture through as a message, not a throw", async () => {
    readFrame.mockResolvedValue({
      edges: [],
      resolvedChip: null,
      error: { message: "no gpiochip with label pinctrl-bcm2835", cause: null },
    });

    const capture = await createLibgpiodFrameSource({
      pin: createGpioPin(2),
    }).readFrame();

    expect(capture.edges).toEqual([]);
    expect(capture.error).toContain("no gpiochip");
  });

  it("opens the session once across many reads", async () => {
    readFrame.mockResolvedValue({ edges: [], resolvedChip: null, error: null });
    const source = createLibgpiodFrameSource({ pin: createGpioPin(2) });

    await source.readFrame();
    await source.readFrame();

    expect(createLibgpiodSession).toHaveBeenCalledTimes(1);
  });

  it("checks the helper exists before the first read", async () => {
    readFrame.mockResolvedValue({ edges: [], resolvedChip: null, error: null });

    await createLibgpiodFrameSource({ pin: createGpioPin(2) }).readFrame();

    expect(requireHelper).toHaveBeenCalled();
  });

  it("throws when the helper is missing, since there is nothing to read with", async () => {
    vi.mocked(requireHelper).mockRejectedValueOnce(
      new Error("GPIO helper not found"),
    );

    await expect(
      createLibgpiodFrameSource({ pin: createGpioPin(2) }).readFrame(),
    ).rejects.toThrow("GPIO helper not found");
  });

  it("reopens the session after close", async () => {
    readFrame.mockResolvedValue({ edges: [], resolvedChip: null, error: null });
    const source = createLibgpiodFrameSource({ pin: createGpioPin(2) });

    await source.readFrame();
    await source.close();
    await source.readFrame();

    expect(createLibgpiodSession).toHaveBeenCalledTimes(2);
  });
});
