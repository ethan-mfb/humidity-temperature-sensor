import express from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./apiSpec.js";
import { indexRequestHandler, indexRequestPath } from "./indexController.js";
import { createGpioPinService } from "./gpioPinService/index.js";
import { createLoggingService } from "./loggingService/index.js";
import { createTempSensorService } from "./tempSensorService/index.js";
import {
  createTempSensorRestService,
  createTempSensorSSEService,
} from "./tempSensorController/index.js";

const app = express();
const port = process.env.PORT || 3000;

const loggingService = createLoggingService();
const gpioPinService = createGpioPinService();
const tempSensorService = createTempSensorService({
  gpioPinService,
  loggingService,
});
const tempSensorRestService = createTempSensorRestService(tempSensorService);
const tempSensorSSEService = createTempSensorSSEService(tempSensorService);

app.get(indexRequestPath, indexRequestHandler);

app.get(
  tempSensorRestService.paths.status,
  tempSensorRestService.handlers.getStatus,
);
app.post(
  tempSensorRestService.paths.start,
  tempSensorRestService.handlers.start,
);
app.post(tempSensorRestService.paths.stop, tempSensorRestService.handlers.stop);
app.get(
  tempSensorSSEService.paths.stream,
  tempSensorSSEService.handlers.stream,
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api-docs`);
});
