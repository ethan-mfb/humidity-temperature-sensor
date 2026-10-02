// The composition root: the only module that knows about every layer. It
// builds the infrastructure, hands it to the application, and renders.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { createPwaService } from "./application/pwaService";
import { createStore } from "./application/store";
import { App } from "./adapters/components/App/App";
import { initialPwaState, pwaReducer } from "./domain/pwaLifecycle";
import { createBrowserInstallPrompt } from "./infrastructure/browserInstallPrompt";
import { createWorkboxServiceWorker } from "./infrastructure/workboxServiceWorker";
import "./styles/global.scss";

const ROOT_ELEMENT_ID = "root";

const rootElement = document.getElementById(ROOT_ELEMENT_ID);
if (rootElement === null) {
  // Nothing can render without it, so this is the one place to halt.
  throw new Error(`Missing #${ROOT_ELEMENT_ID} element`);
}

const store = createStore(pwaReducer, initialPwaState);
const service = createPwaService({
  serviceWorker: createWorkboxServiceWorker({
    registerSW,
    ...("serviceWorker" in navigator && {
      serviceWorkerContainer: navigator.serviceWorker,
    }),
  }),
  installPrompt: createBrowserInstallPrompt(window),
  dispatch: store.dispatch,
});
service.start();

createRoot(rootElement).render(
  <StrictMode>
    <App store={store} service={service} version={__APP_VERSION__} />
  </StrictMode>,
);
