import type React from "react";
import type { UpdateStatus } from "../../../domain/pwaLifecycle";
import { bem } from "../../bem";
import "./UpdateBanner.scss";

const BLOCK = "update-banner";

const text = {
  updateAvailable: "A new version is available.",
  update: "Update",
  updating: "Updating…",
  later: "Later",
  offlineReady: "Ready to work offline.",
  ok: "OK",
};

function Notice(props: {
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  isBusy?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}): React.JSX.Element {
  return (
    <div className={bem(BLOCK)} role="status">
      <p className={bem(BLOCK, "message")}>{props.message}</p>
      <div className={bem(BLOCK, "actions")}>
        {props.secondaryLabel !== undefined && (
          <button
            type="button"
            className={bem(BLOCK, "button")}
            onClick={props.onSecondary}
          >
            {props.secondaryLabel}
          </button>
        )}
        <button
          type="button"
          className={bem(BLOCK, "button", {
            primary: true,
            busy: props.isBusy === true,
          })}
          onClick={props.onPrimary}
          disabled={props.isBusy === true}
        >
          {props.primaryLabel}
        </button>
      </div>
    </div>
  );
}

export function UpdateBanner(props: {
  update: UpdateStatus;
  offlineReady: boolean;
  onUpdate: () => void;
  onDismissUpdate: () => void;
  onDismissOfflineReady: () => void;
}): React.JSX.Element | null {
  if (props.update !== "current") {
    return (
      <Notice
        message={text.updateAvailable}
        primaryLabel={props.update === "updating" ? text.updating : text.update}
        onPrimary={props.onUpdate}
        isBusy={props.update === "updating"}
        secondaryLabel={text.later}
        onSecondary={props.onDismissUpdate}
      />
    );
  }
  if (props.offlineReady) {
    return (
      <Notice
        message={text.offlineReady}
        primaryLabel={text.ok}
        onPrimary={props.onDismissOfflineReady}
      />
    );
  }
  return null;
}
