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

### Testing

- Use `npm run test:once` to run tests, if it exists.
- If it does not exist, suggest creating it to the developer.
- Do not run `npm run test`; it runs in watch mode and will block you.
