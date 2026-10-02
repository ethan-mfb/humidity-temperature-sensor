# Code Generation Instructions

## User Interactions

- If the user asks for a plan, proposal, explanation, or guidance, respond ONLY with a proposed plan; do NOT start implementing
- When answering questions, don't write code unless explicitly asked

## Remote Repository Configuration

- Repository: humidity-temperature-sensor
- Default target branch for PRs: main
- If the user is not logged in remind them to login using `gh auth login`

## Pull Requests

1. **Title Format**: Use conventional commit format (e.g., `feat: add new feature`, `fix: resolve bug`)
2. **Reviewers**: Set to `lemke.ethan@gmail.com`
3. **Assignment**: Assign to the PR creator
4. **Body Structure**: Include a "Summary" section with bullet points of changes
5. **GitHub CLI Command Example**:

```bash
 gh pr create --title "fix: describe the change" --body "$(cat <<'EOF'
 ## Summary

 - Change 1 description
 - Change 2 description
 - Change 3 description
 EOF
 )" --reviewer "lemke.ethan@gmail.com" --assignee "@me"
```

## Repository Overview

### Project Structure

- `LLM_INSTRUCTIONS.md` - Code generation and contribution guidelines
- `README.md` - Project overview and setup instructions
- `assets/` - Images and diagrams (e.g., sensor pinouts, specs)
- `web-api/` - Web API service
  - `src/` - API source code
  - `scripts/` - Utility scripts (e.g., version generation)
- `hts/` - PWA frontend (React, TypeScript, Sass), hosted on the pi
  - `src/` - App source, by clean architecture layer
  - `e2e/` - Playwright tests
  - `deploy/` - nginx config and pi deploy scripts
- `SCRUM_GUIDE.md` - The Scrum Guide, for the Sprints hts is built in

### Architecture

Projects in this repo follow Uncle Bob's
[clean architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html).
The source is split into four layers, and **source dependencies only point inward**:

```
  infrastructure  ─┐
  (browser, GPIO,   │   implements the ports
   Workbox, nginx)  ▼
  adapters ──────► application ──────► domain
  (React, HTTP)     (use cases, ports)   (entities, pure rules)
```

| Layer                | Holds                                                | May import          |
| -------------------- | ---------------------------------------------------- | ------------------- |
| Domain               | Entities and rules, as pure functions                | nothing             |
| Application          | Use cases, the ports they need, the store            | domain              |
| Interface adapters   | UI components and hooks, HTTP controllers            | application, domain |
| Frameworks & drivers | Port implementations over browser, hardware, network | application, domain |

One module is the composition root — `hts/src/main.tsx`, `web-api/src/index.ts` — and is the only
place that sees every layer. It builds the infrastructure, passes it to the application, and starts
the app.

Enforce the dependency rule in tooling wherever it can be: `hts/` does this with ESLint, so
importing an outer layer from an inner one is a lint error. Run `npm run lint`.

Data flows one way, per the Redux and Event Sourcing patterns above: infrastructure reports
something through a port, a use case turns it into a domain event and dispatches it, the store
reduces it into new immutable state, and the adapters read that state and render. User actions go
back out through the use case, which calls the ports.

`web-api/` predates this standard and is organised by service folder instead. Move it toward the
layers as you touch it; do not rewrite it wholesale.

### Functional style

- No classes and no enums. Services are factory functions that close over their state.
- State is immutable: values are `Readonly` and frozen, and updates return new values.
- Use `type`, not `interface`, and explicit `import type`.
- Only throw when the application cannot continue. Everything else returns an `Error` that retains
  its `cause` and the call stack.

### Coding Standards

- Define constants/variables; no "magic" string or numbers
- Avoid excessive nesting
- Be declarative
- Prefer array methods over imperative loops
- Run `npm run lint` regularly to check for lint errors
- Follow the functional programming paradigm
- Follow [Redux](https://redux.js.org/introduction/core-concepts) and [Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) patterns for data flow and handling events
- Error or exception flow in the application should follow this pattern
  - only throw an error when the application process should be halted (i.e. die)
  - in all other cases, return an error object that retains the call stack data, error message and any other data such as the causing error object
  - use `unknown` for the error type in `try/catch` blocks

### Typescript

- Use strict, strong typing
- Explicitly type function returns unless unusually complex
- Do not use classes; use function builder patterns
- Use types, not interfaces
- Use explicit type imports and exports
- Avoid enums, use constants and string literal types
- Run `npm run typecheck` to check typing whenever you finish editing a typescript file

### React

- When creating React components:

  - Create them using the function keyword
  - Type their props explicitly
  - Type the return type explicitly using React.JSX.Element and, if appropriate, null
  - Put display text in a `text: Record<string,string>` object outside of component scope
  - Do not destructure props; this makes it clear when values come from props
  - Do not use React.FC
  - Do not use ReactNode
  - Example:

    ```typescript
    const text = {
      enabled: "Enabled",
    };

    export function MyComponent(props: {
      isEnabled: boolean;
    }): React.JSX.Element {
      return <div>{props.isEnabled && <p>{text.enabled}</p>}</div>;
    }
    ```

### CSS

- Use SASS (.scss)
- Use variables to define colors
- Use rgba() not hexcodes for colors

### Test-driven development

Every change starts with a failing test.

1. **Red:** write a test for the next small piece of behaviour, and run `npm run test:watch` to
   watch it fail.
1. **Green:** write the least code that passes it.
1. **Refactor:** clean up with the tests green, then commit.

Tests sit next to the code they cover (`greeting.ts` and `greeting.test.ts`). The layers make this
cheap:

- The domain is pure functions; test them directly.
- The application gets fake ports. No browser, no hardware.
- Infrastructure takes its globals as parameters (`registerSW`, the `EventTarget` to listen on,
  `setInterval`, the GPIO handle), so tests pass fakes.
- Components get Testing Library, queried by role and text, the way a user finds them.
- End-to-end tests drive the real thing; see `hts/e2e/`.

### Testing

- Use `npm run test:once` to run tests, if it exists.
- If it does not exist, suggest creating it to the developer.
- Do not run `npm run test`; it runs in watch mode and will block you.
