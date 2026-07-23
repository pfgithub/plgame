import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { keymap } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { renderDiff } from "./diff-renderer.ts";
import { runCode } from "./executor.ts";
import {
    type LevelFailure,
    parseState,
    type RenderedLevel,
    runProgression,
    serializeState,
} from "./game-logic.ts";
import { levels } from "./levels.ts";

const STORAGE_KEY = "plgame-state";
const LAYOUT_STORAGE_KEY = "plgame-layout";
const MIN_RAIL_WIDTH = 288;
const MIN_EDITOR_WIDTH = 360;
const DIVIDER_WIDTH = 8;
const RAIL_RESIZE_STEP = 24;

type MobileTab = "challenge" | "code" | "results";
type ResultState =
    | {kind: "ready"}
    | {kind: "running"}
    | {kind: "failure", failure: LevelFailure, regression: boolean}
    | {kind: "complete"};

function element<T extends HTMLElement>(id: string): T {
    const found = document.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Missing #${id}.`);
    return found;
}

const workspace = element<HTMLElement>("workspace");
const editorParent = element<HTMLDivElement>("editor");
const divider = element<HTMLDivElement>("workspace-divider");
const previousButton = element<HTMLButtonElement>("previous-level");
const nextButton = element<HTMLButtonElement>("next-level");
const runButton = element<HTMLButtonElement>("run");
const levelNumber = element<HTMLHeadingElement>("level-number");
const toggleLevelsButton = element<HTMLButtonElement>("toggle-levels");
const levelNavigation = element<HTMLElement>("level-navigation");
const levelGrid = element<HTMLDivElement>("level-grid");
const inputTokens = element<HTMLElement>("level-input");
const outputTokens = element<HTMLElement>("level-output");
const status = element<HTMLDivElement>("status");
const mobileTabButtons = [
    element<HTMLButtonElement>("challenge-tab"),
    element<HTMLButtonElement>("code-tab"),
    element<HTMLButtonElement>("results-tab"),
];
const mobilePanels: Record<MobileTab, HTMLElement> = {
    challenge: element<HTMLElement>("challenge-panel"),
    code: element<HTMLElement>("code-panel"),
    results: element<HTMLElement>("results-panel"),
};
const narrowScreen = window.matchMedia("(max-width: 48rem)");

const state = (() => {
    try {
        return parseState(localStorage.getItem(STORAGE_KEY), levels.length);
    } catch {
        return parseState(null, levels.length);
    }
})();

function savedRailWidth(): number {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null");
        if (
            typeof saved === "object"
            && saved !== null
            && "railWidth" in saved
            && typeof saved.railWidth === "number"
            && Number.isFinite(saved.railWidth)
        ) return saved.railWidth;
    } catch {
        // Invalid layout preferences use the default width.
    }
    return 416;
}

let running = false;
let activeMobileTab: MobileTab = "code";
let levelNavigationExpanded = false;
let resultState: ResultState = {kind: "ready"};
let renderedLevels: RenderedLevel[] = levels.map(level => ({
    input: level.input.join(" "),
    expected: level.output.join(" "),
}));
let lastRunFailures = new Map<number, LevelFailure>();
let lastRunTestedThrough = -1;
let lastRunOrigin = state.levelIndex;
let railWidth = savedRailWidth();

function saveGame(): void {
    try {
        localStorage.setItem(STORAGE_KEY, serializeState(state));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

function saveLayout(): void {
    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({railWidth}));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

function maximumRailWidth(): number {
    return Math.max(MIN_RAIL_WIDTH, workspace.clientWidth - MIN_EDITOR_WIDTH - DIVIDER_WIDTH);
}

function setRailWidth(nextWidth: number, persist: boolean): void {
    railWidth = Math.round(Math.min(Math.max(nextWidth, MIN_RAIL_WIDTH), maximumRailWidth()));
    workspace.style.setProperty("--task-rail-width", `${railWidth}px`);
    divider.setAttribute("aria-valuemax", String(maximumRailWidth()));
    divider.setAttribute("aria-valuenow", String(railWidth));
    if (persist) saveLayout();
}

setRailWidth(railWidth, false);

const editor = new EditorView({
    doc: state.code,
    extensions: [
        basicSetup,
        javascript(),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            state.code = update.state.doc.toString();
            saveGame();
        }),
    ],
    parent: editorParent,
});

function codeBlock(text: string): HTMLPreElement {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = text;
    pre.append(code);
    return pre;
}

function setMobileTab(tab: MobileTab): void {
    activeMobileTab = tab;
    workspace.dataset.mobileTab = tab;
    for (const button of mobileTabButtons) {
        const selected = button.dataset.tab === tab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
    }
    for (const [panelTab, panel] of Object.entries(mobilePanels)) {
        if (narrowScreen.matches) panel.setAttribute("aria-hidden", String(panelTab !== tab));
        else panel.removeAttribute("aria-hidden");
    }
    if (tab === "code") requestAnimationFrame(() => editor.requestMeasure());
}

function renderResult(): void {
    if (resultState.kind === "ready") {
        status.textContent = "Ready to run.";
        return;
    }
    if (resultState.kind === "running") {
        status.textContent = "Running…";
        return;
    }
    if (resultState.kind === "complete") {
        const heading = document.createElement("strong");
        heading.textContent = "All levels passed.";
        const detail = document.createElement("p");
        detail.textContent = "Your interpreter satisfies every challenge.";
        status.replaceChildren(heading, detail);
        return;
    }

    const {failure, regression} = resultState;
    const summary = document.createElement("p");
    summary.textContent = regression
        ? `Earlier level ${failure.levelIndex + 1} no longer passes.`
        : `Level ${failure.levelIndex + 1} failed.`;
    const expectedLabel = document.createElement("strong");
    expectedLabel.textContent = "Expected output";
    const expected = failure.renderedExpected ?? failure.expected.join(" ");
    const children: HTMLElement[] = [
        summary,
        expectedLabel,
        codeBlock(expected),
    ];

    if (failure.error) {
        const errorLabel = document.createElement("strong");
        errorLabel.textContent = "Error";
        children.push(errorLabel, codeBlock(failure.error.message));
    } else {
        const actual = failure.renderedActual ?? failure.actual?.join(" ") ?? "";
        const actualLabel = document.createElement("strong");
        actualLabel.textContent = "Your code returned";
        const diffLabel = document.createElement("strong");
        diffLabel.textContent = "Diff";
        children.push(
            actualLabel,
            codeBlock(actual),
            diffLabel,
            renderDiff(document, expected, actual),
        );
    }

    const otherFailures = [...lastRunFailures.values()]
        .filter(other => other.levelIndex !== failure.levelIndex)
        .sort((left, right) => left.levelIndex - right.levelIndex);
    if (otherFailures.length > 0) {
        const otherLabel = document.createElement("p");
        otherLabel.textContent = "Other failing levels:";
        const links = document.createElement("div");
        for (const other of otherFailures) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `Level ${other.levelIndex + 1}`;
            button.addEventListener("click", () => focusFailure(other));
            links.append(button);
        }
        children.push(otherLabel, links);
    }
    status.replaceChildren(...children);
}

function levelState(levelIndex: number): "failed" | "passed" | "unlocked" {
    if (lastRunFailures.has(levelIndex)) return "failed";
    if (levelIndex <= lastRunTestedThrough) return "passed";
    return "unlocked";
}

function renderLevelGrid(): void {
    if (!levelNavigationExpanded) return;
    const buttons: HTMLButtonElement[] = [];
    for (let levelIndex = 0; levelIndex <= state.highestLevelIndex; levelIndex++) {
        const button = document.createElement("button");
        const itemState = levelState(levelIndex);
        const current = levelIndex === state.levelIndex;
        button.type = "button";
        button.textContent = String(levelIndex + 1);
        button.dataset.levelState = itemState;
        button.setAttribute(
            "aria-label",
            `Level ${levelIndex + 1}, ${itemState}${current ? ", current" : ""}`,
        );
        if (current) button.setAttribute("aria-current", "step");
        button.addEventListener("click", () => goToLevel(levelIndex));
        buttons.push(button);
    }
    levelGrid.replaceChildren(...buttons);
}

function renderLevel(): void {
    const level = levels[state.levelIndex];
    if (!level) throw new Error(`Missing level ${state.levelIndex + 1}.`);
    const rendered = renderedLevels[state.levelIndex];

    levelNumber.textContent = `Level ${state.levelIndex + 1} of ${levels.length}`;
    inputTokens.textContent = rendered?.input ?? level.input.join(" ");
    outputTokens.textContent = rendered?.expected ?? level.output.join(" ");
}

function render(): void {
    previousButton.disabled = running || state.levelIndex === 0;
    nextButton.disabled = running || state.levelIndex === state.highestLevelIndex;
    runButton.disabled = running;
    runButton.textContent = running ? "Running…" : "Run";
    toggleLevelsButton.disabled = running;
    toggleLevelsButton.setAttribute("aria-expanded", String(levelNavigationExpanded));
    levelNavigation.hidden = !levelNavigationExpanded;
    renderLevel();
    renderLevelGrid();
    renderResult();
    setMobileTab(activeMobileTab);
}

function focusFailure(failure: LevelFailure): void {
    state.levelIndex = failure.levelIndex;
    resultState = {
        kind: "failure",
        failure,
        regression: failure.levelIndex < lastRunOrigin,
    };
    saveGame();
    render();
    setMobileTab("results");
}

function goToLevel(levelIndex: number): void {
    if (levelIndex < 0 || levelIndex > state.highestLevelIndex) return;
    state.levelIndex = levelIndex;
    const knownFailure = lastRunFailures.get(levelIndex);
    resultState = knownFailure
        ? {
                kind: "failure",
                failure: knownFailure,
                regression: levelIndex < lastRunOrigin,
            }
        : {kind: "ready"};
    saveGame();
    render();
}

async function runGame(): Promise<void> {
    if (running) return;
    running = true;
    lastRunOrigin = state.levelIndex;
    resultState = {kind: "running"};
    render();

    const result = await runProgression(
        editor.state.doc.toString(),
        levels,
        state.levelIndex,
        runCode,
    );

    const failures = result.kind === "failed"
        ? [...result.pastFailures, result.failure]
        : result.pastFailures;
    lastRunFailures = new Map(failures.map(failure => [failure.levelIndex, failure]));
    lastRunTestedThrough = result.kind === "complete"
        ? levels.length - 1
        : result.levelIndex;
    renderedLevels = result.renderedLevels;
    state.highestLevelIndex = Math.max(state.highestLevelIndex, result.levelIndex);
    running = false;

    const earliestRegression = [...result.pastFailures]
        .sort((left, right) => left.levelIndex - right.levelIndex)[0];
    if (earliestRegression) {
        state.levelIndex = earliestRegression.levelIndex;
        resultState = {
            kind: "failure",
            failure: earliestRegression,
            regression: true,
        };
    } else if (result.kind === "failed") {
        state.levelIndex = result.levelIndex;
        resultState = {
            kind: "failure",
            failure: result.failure,
            regression: false,
        };
    } else {
        state.levelIndex = result.levelIndex;
        resultState = {kind: "complete"};
    }

    saveGame();
    activeMobileTab = "results";
    render();
}

previousButton.addEventListener("click", () => goToLevel(state.levelIndex - 1));
nextButton.addEventListener("click", () => goToLevel(state.levelIndex + 1));
runButton.addEventListener("click", () => void runGame());
toggleLevelsButton.addEventListener("click", () => {
    levelNavigationExpanded = !levelNavigationExpanded;
    render();
});

for (const button of mobileTabButtons) {
    button.addEventListener("click", () => setMobileTab(button.dataset.tab as MobileTab));
    button.addEventListener("keydown", (event) => {
        const currentIndex = mobileTabButtons.indexOf(button);
        let nextIndex: number | undefined;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex + mobileTabButtons.length - 1) % mobileTabButtons.length;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % mobileTabButtons.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = mobileTabButtons.length - 1;
        if (nextIndex === undefined) return;
        event.preventDefault();
        const nextButton = mobileTabButtons[nextIndex];
        if (!nextButton) return;
        setMobileTab(nextButton.dataset.tab as MobileTab);
        nextButton.focus();
    });
}

document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    void runGame();
});

divider.addEventListener("pointerdown", (event) => {
    divider.setPointerCapture(event.pointerId);
});
divider.addEventListener("pointermove", (event) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    setRailWidth(workspace.getBoundingClientRect().right - event.clientX, false);
});
divider.addEventListener("pointerup", (event) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    divider.releasePointerCapture(event.pointerId);
    saveLayout();
});
divider.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") setRailWidth(railWidth + RAIL_RESIZE_STEP, true);
    else if (event.key === "ArrowRight") setRailWidth(railWidth - RAIL_RESIZE_STEP, true);
    else if (event.key === "Home") setRailWidth(MIN_RAIL_WIDTH, true);
    else if (event.key === "End") setRailWidth(maximumRailWidth(), true);
    else return;
    event.preventDefault();
});

window.addEventListener("resize", () => setRailWidth(railWidth, false));
narrowScreen.addEventListener("change", () => setMobileTab(activeMobileTab));

render();
