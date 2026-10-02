import type React from "react";
import { bem } from "../../bem";
import "./InstallButton.scss";

const BLOCK = "install-button";

const text = {
  install: "Install app",
};

export function InstallButton(props: {
  installable: boolean;
  onInstall: () => void;
}): React.JSX.Element | null {
  if (!props.installable) return null;
  return (
    <button type="button" className={bem(BLOCK)} onClick={props.onInstall}>
      {text.install}
    </button>
  );
}
