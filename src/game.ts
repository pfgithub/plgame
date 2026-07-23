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
const latestButton = element<HTMLButtonElement>("latest-level");
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
let renderedLevels: RenderedLevel[] = levels.map(level => ({
    input: level.input.join(" "),
    expected: level.output.join(" "),
}));
let lastRunFailures = new Map<number, LevelFailure>();
let lastRunTestedThrough = -1;
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
    if (running) {
        status.textContent = "Running…";
        return;
    }
    if (lastRunTestedThrough < 0) {
        status.textContent = "Ready to run.";
        return;
    }

    const failure = lastRunFailures.get(state.levelIndex);
    const resultHeading = document.createElement("strong");
    const resultDetail = document.createElement("p");
    const children: HTMLElement[] = [resultHeading, resultDetail];

    if (!failure) {
        resultHeading.textContent = "Pass";
        resultDetail.textContent = `Level ${state.levelIndex + 1} passed.`;
    } else {
        resultHeading.textContent = "Fail";
        resultDetail.textContent = `Level ${state.levelIndex + 1} failed.`;
        const expectedLabel = document.createElement("strong");
        expectedLabel.textContent = "Expected output";
        const expected = failure.renderedExpected ?? failure.expected.join(" ");
        children.push(expectedLabel, codeBlock(expected));

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
    }

    const otherFailures = [...lastRunFailures.values()]
        .filter(other => other.levelIndex !== state.levelIndex)
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
    } else {
        const otherSummary = document.createElement("p");
        otherSummary.textContent = "All other tested levels passed.";
        children.push(otherSummary);
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
        button.dataset.levelState = itemState;
        const name = document.createElement("strong");
        name.textContent = `Level ${levelIndex + 1}`;
        const executionTimeMs = renderedLevels[levelIndex]?.executionTimeMs;
        const timing = document.createElement("small");
        timing.className = "level-grid-time";
        timing.textContent = executionTimeMs === undefined
            ? "Not run"
            : `${executionTimeMs.toFixed(2)} ms`;
        button.replaceChildren(name, timing);
        button.setAttribute(
            "aria-label",
            `Level ${levelIndex + 1}, ${itemState}, ${timing.textContent}${current ? ", current" : ""}`,
        );
        if (current) button.setAttribute("aria-current", "step");
        button.addEventListener("click", () => {
            levelNavigationExpanded = false;
            goToLevel(levelIndex);
        });
        buttons.push(button);
    }
    levelGrid.replaceChildren(...buttons);
}

function renderLevel(): void {
    const level = levels[state.levelIndex];
    if (!level) throw new Error(`Missing level ${state.levelIndex + 1}.`);
    const rendered = renderedLevels[state.levelIndex];

    const itemState = levelState(state.levelIndex);
    levelNumber.textContent = `Level ${state.levelIndex + 1}`;
    if (itemState === "unlocked") delete levelNumber.dataset.levelState;
    else levelNumber.dataset.levelState = itemState;
    inputTokens.textContent = rendered?.input ?? level.input.join(" ");
    outputTokens.textContent = rendered?.expected ?? level.output.join(" ");
}

function render(): void {
    previousButton.disabled = running || state.levelIndex === 0;
    nextButton.disabled = running || state.levelIndex === state.highestLevelIndex;
    latestButton.disabled = running || state.levelIndex === state.highestLevelIndex;
    runButton.disabled = running;
    runButton.textContent = running ? "Running…" : "Run";
    toggleLevelsButton.disabled = running;
    toggleLevelsButton.setAttribute("aria-expanded", String(levelNavigationExpanded));
    toggleLevelsButton.setAttribute(
        "aria-label",
        levelNavigationExpanded ? "Close unlocked levels" : "Browse unlocked levels",
    );
    workspace.dataset.browsing = String(levelNavigationExpanded);
    levelNavigation.hidden = !levelNavigationExpanded;
    renderLevel();
    renderLevelGrid();
    renderResult();
    setMobileTab(activeMobileTab);
}

function focusFailure(failure: LevelFailure): void {
    goToLevel(failure.levelIndex);
    setMobileTab("results");
}

function goToLevel(levelIndex: number): void {
    if (levelIndex < 0 || levelIndex > state.highestLevelIndex) return;
    state.levelIndex = levelIndex;
    saveGame();
    render();
}

async function runGame(): Promise<void> {
    if (running) return;
    running = true;
    render();

    const result = await runProgression(
        editor.state.doc.toString(),
        levels,
        state.levelIndex,
        state.highestLevelIndex,
        runCode,
    );

    const failures = result.levelFailures.filter(
        (failure): failure is LevelFailure => failure !== undefined,
    );
    lastRunFailures = new Map(failures.map(failure => [failure.levelIndex, failure]));
    renderedLevels = result.renderedLevels;
    state.highestLevelIndex = Math.max(state.highestLevelIndex, result.levelIndex);
    lastRunTestedThrough = state.highestLevelIndex;
    running = false;

    saveGame();
    activeMobileTab = "results";
    render();
}

previousButton.addEventListener("click", () => goToLevel(state.levelIndex - 1));
nextButton.addEventListener("click", () => goToLevel(state.levelIndex + 1));
latestButton.addEventListener("click", () => goToLevel(state.highestLevelIndex));
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
