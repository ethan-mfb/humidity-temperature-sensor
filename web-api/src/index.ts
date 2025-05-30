import express from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./apiSpec.js";
import { indexRequestHandler, indexRequestPath } from "./indexController.js";

const app = express();
const port = process.env.PORT || 3000;

app.get(indexRequestPath, indexRequestHandler);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api-docs`);
});
