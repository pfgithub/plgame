Do not run. Running will be done with `bun src/devserver.ts` (does not exit until killed). Do not test with the browser skill.

After finishing, run `bun check` to typecheck, lint, format, & test code. Takes ~30sec. Do not do any additional testing or validation beyond `bun check`.

Do not add any tests unless asked.

Do not add any animations or transitions unless asked.

## Game summary

plgame is a browser-based programming puzzle about learning an unknown language from input/output examples. Players name and render numeric tokens, implement the language in JavaScript, and advance through levels that gradually reveal base-6 numbers, stack operations, variables, arithmetic, and lists.

## File summary

- `src/index.html`: Responsive single-page game shell, layout styles, controls, challenge/console/results/settings panels, and entry script.
- `src/game.ts`: Browser UI controller for CodeMirror, saved state and reset actions, grouped level navigation and custom group names, previews, execution, console output, results, and responsive interactions.
- `src/game-logic.ts`: UI-independent progression, failure reporting, default player code, and persisted-state serialization/parsing.
- `src/executor.ts`: Sandboxed iframe and Web Worker runner that validates, times out, executes, renders, and captures console output from player code. Calling runCode() is slow, always batch multiple calls into one call instead, modifying the runCode implementaion if necessary.
- `src/diff-renderer.ts`: Builds a semantic two-line HTML diff between expected and actual rendered output.
- `src/levels.json`: Gitignored generated numeric level data, consumed by the game at runtime.
- `spoilers/spoilers.ts`: Token vocabulary, tokenizer, ordered puzzle corpus, reference stack-language interpreter, and generator for `src/levels.json`.

If new code files are added, or significant changes are made to existing files, add/update the summary.
