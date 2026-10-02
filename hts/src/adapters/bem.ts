// Builds BEM class names: block, block__element, and a block--modifier or
// block__element--modifier for each modifier that is on. See ../../BEM.md.
export type Modifiers = Readonly<Record<string, boolean>>;

export function bem(
  block: string,
  element?: string,
  modifiers: Modifiers = {},
): string {
  const base = element === undefined ? block : `${block}__${element}`;
  const active = Object.entries(modifiers)
    .filter(([, isOn]) => isOn)
    .map(([modifier]) => `${base}--${modifier}`);
  return [base, ...active].join(" ");
}
