import { javascript } from "@codemirror/lang-javascript";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { runCode } from "./executor.ts";
import {
    isLevelNamed,
    type LevelFailure,
    levelTokens,
    parseState,
    runProgression,
    serializeState,
    validateTokenName,
} from "./game-logic.ts";
import { levels, type Token } from "./levels.ts";

const STORAGE_KEY = "plgame-state";

function element<T extends HTMLElement>(id: string): T {
    const found = document.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Missing #${id}.`);
    return found;
}

const editorParent = element<HTMLDivElement>("editor");
const previousButton = element<HTMLButtonElement>("previous-level");
const nextButton = element<HTMLButtonElement>("next-level");
const showLevelsButton = element<HTMLButtonElement>("show-levels");
const failedLevels = element<HTMLDivElement>("failed-levels");
const levelDetail = element<HTMLDivElement>("level-detail");
const levelPicker = element<HTMLDivElement>("level-picker");
const levelGrid = element<HTMLDivElement>("level-grid");
const levelNumber = element<HTMLHeadingElement>("level-number");
const inputTokens = element<HTMLDivElement>("level-input");
const outputTokens = element<HTMLDivElement>("level-output");
const runButton = element<HTMLButtonElement>("run");
const status = element<HTMLParagraphElement>("status");

const state = (() => {
    try {
        return parseState(localStorage.getItem(STORAGE_KEY), levels.length);
    } catch {
        return parseState(null, levels.length);
    }
})();
let running = false;
let showingLevelPicker = false;
let lastPastFailures: LevelFailure[] = [];

function save(): void {
    try {
        localStorage.setItem(STORAGE_KEY, serializeState(state));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

const editor = new EditorView({
    doc: state.code,
    extensions: [
        basicSetup,
        javascript(),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            state.code = update.state.doc.toString();
            save();
        }),
    ],
    parent: editorParent,
});

function setStatus(message: string): void {
    status.textContent = message;
}

function beginRename(token: Token, button: HTMLButtonElement): void {
    const nameInput = document.createElement("input");
    nameInput.className = "token-name";
    nameInput.value = state.tokenNames[token] ?? "";
    nameInput.placeholder = "name";
    nameInput.setAttribute("aria-label", "Token name");
    button.replaceWith(nameInput);
    nameInput.focus();
    nameInput.select();

    let finished = false;
    const finish = (commit: boolean): void => {
        if (finished) return;
        finished = true;

        if (commit) {
            const error = validateTokenName(state.tokenNames, token, nameInput.value);
            if (error) {
                renderLevel();
                setStatus(error);
                return;
            }
            state.tokenNames[token] = nameInput.value.trim();
            save();
        }
        renderLevel();
    };

    nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
    });
    nameInput.addEventListener("blur", () => finish(true));
}

function renderTokens(parent: HTMLElement, tokens: Token[]): void {
    parent.replaceChildren(...tokens.map((token) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = state.tokenNames[token] ?? "unnamed";
        button.title = "Click to name this token";
        button.addEventListener("click", () => beginRename(token, button));
        return button;
    }));
}

function goToLevel(levelIndex: number): void {
    if (levelIndex < 0 || levelIndex > state.highestLevelIndex) return;
    state.levelIndex = levelIndex;
    showingLevelPicker = false;
    save();
    render();
}

function renderFailures(): void {
    const failures = lastPastFailures.filter(failure => failure.levelIndex !== state.levelIndex);
    if (failures.length === 0) {
        failedLevels.replaceChildren();
        return;
    }

    const label = document.createElement("p");
    label.textContent = "Failed earlier levels:";
    const buttons = failures.map((failure) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Level ${failure.levelIndex + 1}`;
        button.addEventListener("click", () => goToLevel(failure.levelIndex));
        return button;
    });
    failedLevels.replaceChildren(label, ...buttons);
}

function renderLevelGrid(): void {
    const buttons: HTMLButtonElement[] = [];
    for (let levelIndex = 0; levelIndex <= state.highestLevelIndex; levelIndex++) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = String(levelIndex + 1);
        button.setAttribute("aria-label", `Level ${levelIndex + 1}`);
        button.addEventListener("click", () => goToLevel(levelIndex));
        buttons.push(button);
    }
    levelGrid.replaceChildren(...buttons);
}

function renderLevel(): void {
    const level = levels[state.levelIndex];
    if (!level) throw new Error(`Missing level ${state.levelIndex + 1}.`);

    levelNumber.textContent = `Level ${state.levelIndex + 1} of ${levels.length}`;
    renderTokens(inputTokens, level.input);
    renderTokens(outputTokens, level.output);
    runButton.disabled = running || !isLevelNamed(level, state.tokenNames);

    if (!running && !isLevelNamed(level, state.tokenNames)) {
        const unnamedCount = levelTokens(level).filter(
            token => state.tokenNames[token] === undefined,
        ).length;
        setStatus(`Name ${unnamedCount} token${unnamedCount === 1 ? "" : "s"} to run this level.`);
    } else if (!running) {
        setStatus("Ready to run.");
    }
}

function render(): void {
    previousButton.disabled = running || state.levelIndex === 0;
    nextButton.disabled = running || state.levelIndex === state.highestLevelIndex;
    showLevelsButton.disabled = running;
    levelDetail.hidden = showingLevelPicker;
    levelPicker.hidden = !showingLevelPicker;
    renderFailures();
    if (showingLevelPicker) renderLevelGrid();
    else renderLevel();
}

previousButton.addEventListener("click", () => goToLevel(state.levelIndex - 1));
nextButton.addEventListener("click", () => goToLevel(state.levelIndex + 1));
showLevelsButton.addEventListener("click", () => {
    showingLevelPicker = true;
    render();
});

runButton.addEventListener("click", async () => {
    if (running) return;
    running = true;
    render();
    setStatus("Running…");

    const previousLevel = state.levelIndex;
    const result = await runProgression(
        editor.state.doc.toString(),
        state.tokenNames,
        levels,
        state.levelIndex,
        runCode,
    );
    state.levelIndex = result.levelIndex;
    state.highestLevelIndex = Math.max(state.highestLevelIndex, result.levelIndex);
    lastPastFailures = result.pastFailures;
    running = false;
    save();
    render();

    if (result.kind === "blocked") {
        const prefix = result.levelIndex > previousLevel
            ? `Passed through level ${result.levelIndex}. `
            : "";
        setStatus(`${prefix}Name every token in level ${result.levelIndex + 1} to continue.`);
    } else if (result.kind === "past-failures") {
        setStatus("This level passed, but every earlier level must also pass before you can continue.");
    } else if (result.kind === "failed") {
        if (result.failure.error) {
            setStatus(`Level ${result.levelIndex + 1} failed: ${result.failure.error.message}`);
        } else {
            setStatus(
                `Level ${result.levelIndex + 1} failed. Expected ${JSON.stringify(result.failure.expected)}, received ${JSON.stringify(result.failure.actual)}.`,
            );
        }
    } else {
        setStatus("All levels passed.");
    }
});

render();
