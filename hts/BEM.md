# BEM: Block, Element, Modifier

Every class name in hts follows BEM. This file is the reference. The first half summarises the
methodology as [getbem.com](https://getbem.com/) defines it; the second half is how this project
applies it in Sass.

> **Source:** written from [getbem.com](https://getbem.com/) ([introduction](https://getbem.com/introduction/),
> [naming](https://getbem.com/naming/), [FAQ](https://getbem.com/faq/)). getbem.com's source does
> not carry a license, so this file paraphrases it rather than copying it. Read the original when
> this summary leaves a question open.

## Why BEM

Small sites can get away with unorganised CSS. Bigger, longer-lived ones cannot: how styles are
organised decides how fast code gets written, how much of it there is, and how much the browser has
to load. BEM is one of several methodologies for this (alongside OOCSS, SMACSS, SUIT CSS and Atomic
CSS). Its pitch is that it is easier to follow than SMACSS while still giving OOCSS-style structure,
with terms everyone on a team can share.

What it buys:

- **Modularity.** A block's styles never depend on other parts of the page, so cascade surprises go
  away and a block can move to another project intact.
- **Reusability.** Blocks compose in new ways without new CSS, so there is less to maintain.
- **Structure.** The class names describe the UI's structure, which keeps the CSS easy to read.

## The three parts

### Block

A standalone entity that means something on its own: `header`, `container`, `menu`, `checkbox`,
`input`.

Blocks can nest and interact, but none outranks another. A block does not even need DOM; a
controller or model can be a block too.

### Element

A part of a block with no standalone meaning, tied to that block: a menu's item, a list's item, a
checkbox's caption, a header's title.

All elements of a block are equal; there is no element-of-an-element.

### Modifier

A flag on a block or element that changes its appearance, behaviour or state: `disabled`,
`highlighted`, `checked`, `fixed`, `size big`, `color yellow`.

## Naming

| Part     | Allowed characters                                | Class               |
| -------- | ------------------------------------------------- | ------------------- |
| Block    | lowercase Latin letters, digits, dashes           | `.block`            |
| Element  | lowercase Latin letters, digits, dashes, `_`      | `.block__elem`      |
| Modifier | lowercase Latin letters, digits, dashes, `_`      | `.block--mod`       |
|          |                                                   | `.block__elem--mod` |
|          | key-value modifiers join the key and value by `-` | `.block--color-red` |

Spaces in a multi-word name become a dash: `.main-menu`, `.main-menu__nav-link`.

### Rules

- **Class selectors only.** No tag names, no ids. `div.block__elem` and `#menu` are out.
- **No dependence on other blocks or elements.** Do not write `.block .block__elem`; write
  `.block__elem`.
- **A modifier never stands alone.** Keep the base class and add the modifier beside it:

  ```html
  <!-- good -->
  <div class="block block--mod">...</div>
  <div class="block block--size-big block--shadow-yes">...</div>

  <!-- bad: the base class is missing -->
  <div class="block--mod">...</div>
  ```

- **Block modifiers may reach their elements.** This is the one nested selector BEM allows:
  `.block--mod .block__elem { }`.

### Example

A `form` block with modifiers `theme: xmas` and `simple`, elements `input` and `submit`, and a
`submit` that is disabled until the form is filled in:

```html
<form class="form form--theme-xmas form--simple">
  <input class="form__input" type="text" />
  <input class="form__submit form__submit--disabled" type="submit" />
</form>
```

<!-- prettier-ignore -->
```css
.form { }
.form--theme-xmas { }
.form--simple { }
.form__input { }
.form__submit { }
.form__submit--disabled { }
```

## BEM in hts

### One block per component

Each React component in `src/adapters/components/<Name>/` has one stylesheet next to it,
`<Name>.scss`, which defines one block named after the component in kebab case: `HelloWorld` is
`.hello-world`, `UpdateBanner` is `.update-banner`. The component imports its stylesheet.

```
src/adapters/components/UpdateBanner/
  UpdateBanner.tsx
  UpdateBanner.scss    // .update-banner, .update-banner__button, .update-banner__button--primary
  UpdateBanner.test.tsx
```

A component that needs another block's look renders that component. It does not reach into the
other block's classes.

### Sass nesting builds the names; it does not nest the selectors

Use `&__` and `&--` so the block name is written once. Each compiles to a single, flat class
selector:

```scss
@use "../../../styles/tokens";

.update-banner {
  padding: tokens.$space-md;

  &__button {
    color: tokens.$color-brand;

    &--primary {
      color: tokens.$color-brand-contrast;
      background-color: tokens.$color-brand;
    }
  }
}
// .update-banner, .update-banner__button, .update-banner__button--primary
```

Do not nest in a way that produces descendant selectors (`.update-banner .update-banner__button`),
and do not style tags inside a block (`.update-banner p`). The only nesting allowed is a block
modifier reaching an element:

```scss
.update-banner {
  &--compact &__button {
    padding: tokens.$space-xs;
  }
}
// .update-banner--compact .update-banner__button
```

### Building class names in components

Use `bem()` from `src/adapters/bem.ts` instead of writing class strings by hand. It always keeps the
base class, and only adds modifiers that are on:

```tsx
const BLOCK = "update-banner";

bem(BLOCK); // "update-banner"
bem(BLOCK, "button"); // "update-banner__button"
bem(BLOCK, "button", { primary: true, busy: false }); // "update-banner__button update-banner__button--primary"
```

Write key-value modifiers as one key: `bem(BLOCK, undefined, { "size-big": true })`.

### Tokens, not values

Colours, spacing, radii and fonts come from `src/styles/_tokens.scss`. Colours are `rgba()`
variables, never hex codes. Global styles (the reset, `body`) live in `src/styles/global.scss`, the
only place tag selectors are allowed.
