import { Gpio } from "onoff";

export type GpioPinService = {
  /**
   * Watches the GPIO pin for changes.
   *
   * @param onInterrupt called on interrupt with error or value
   */
  watchPin: (onInterrupt: (err: Error | null, value: 0 | 1) => void) => void;
  /**
   * Removes the interrupt event handler.
   *
   * @param onInterrupt called on interrupt with error or value
   */
  unwatchPin: (onInterrupt: (err: Error | null, value: 0 | 1) => void) => void;
  /** Cleans up resources for next instance of this service type. After this is called this instance should not be used again. */
  destroy: () => void;
};

let service: GpioPinService | null = null;

/** Gets the GPIO pin service singleton. */
export function getGpioPinService(args: { targetPin: number }): GpioPinService {
  if (service !== null) return service;

  const onOffService = new Gpio(args.targetPin, "in", "both");
  service = {
    watchPin: (onInterrupt) => {
      onOffService.watch(onInterrupt);
    },
    unwatchPin: (onInterrupt) => {
      onOffService.unwatch(onInterrupt);
    },
    destroy: () => {
      onOffService.unexport();
      service = null;
    },
  };
  return service;
}
