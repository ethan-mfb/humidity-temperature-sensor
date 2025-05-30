import { targetDataGpioPin } from "./constants.js";
import { getGpioPinService } from "../gpioPinService/index.js";

const gpioPinService = getGpioPinService({ targetPin: targetDataGpioPin });

function onPinValueChange(err: Error | null, value: 0 | 1): void {
  if (err) {
    console.error("Error reading pin:", err);
  } else {
    console.log(`Pin value changed to: ${value}`);
  }
}

gpioPinService.watchPin(onPinValueChange);

process.on("SIGINT", () => {
  // make the pin available for other processes
  gpioPinService.unwatchPin(onPinValueChange);
  gpioPinService.destroy();
  console.log("Exiting...");
  process.exit();
});
