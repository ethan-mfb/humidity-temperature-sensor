import type React from "react";
import type { PwaService } from "../../../application/pwaService";
import type { Store } from "../../../application/store";
import { DEFAULT_AUDIENCE, createGreeting } from "../../../domain/greeting";
import type { PwaEvent, PwaState } from "../../../domain/pwaLifecycle";
import { bem } from "../../bem";
import { useStoreState } from "../../useStoreState";
import { HelloWorld } from "../HelloWorld/HelloWorld";
import { InstallButton } from "../InstallButton/InstallButton";
import { UpdateBanner } from "../UpdateBanner/UpdateBanner";
import "./App.scss";

const BLOCK = "app";

const text = {
  name: "HTS",
  version: (version: string) => `v${version}`,
};

const greeting = createGreeting(DEFAULT_AUDIENCE);

const reportError = (result: unknown): void => {
  if (result instanceof Error) console.error(result);
};

export function App(props: {
  store: Store<PwaState, PwaEvent>;
  service: PwaService;
  version: string;
}): React.JSX.Element {
  const state = useStoreState(props.store);
  return (
    <div className={bem(BLOCK)}>
      <header className={bem(BLOCK, "header")}>
        <span className={bem(BLOCK, "name")}>{text.name}</span>
        <InstallButton
          installable={state.installable}
          onInstall={() => void props.service.install().then(reportError)}
        />
      </header>
      <main className={bem(BLOCK, "main")}>
        <HelloWorld greeting={greeting} />
      </main>
      <footer className={bem(BLOCK, "footer")}>
        {text.version(props.version)}
      </footer>
      <UpdateBanner
        update={state.update}
        offlineReady={state.offlineReady}
        onUpdate={() => void props.service.applyUpdate().then(reportError)}
        onDismissUpdate={props.service.dismissUpdate}
        onDismissOfflineReady={props.service.dismissOfflineReady}
      />
    </div>
  );
}
