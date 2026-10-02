import type React from "react";
import type { Greeting } from "../../../domain/greeting";
import { bem } from "../../bem";
import "./HelloWorld.scss";

const BLOCK = "hello-world";

export function HelloWorld(props: { greeting: Greeting }): React.JSX.Element {
  return (
    <section className={bem(BLOCK)}>
      <h1 className={bem(BLOCK, "title")}>{props.greeting.message}</h1>
    </section>
  );
}
