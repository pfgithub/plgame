import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import {
    ArrowLeft,
    ArrowRight,
    ArrowRightToLine,
    ChevronDown,
    createIcons,
    Info,
    Plus,
} from "lucide";
import { renderDiff } from "./diff-renderer.ts";
import { renderCode, runCode } from "./executor.ts";
import {
    DEFAULT_CODE,
    type LevelFailure,
    parseState,
    type RenderedLevel,
    runProgression,
    serializeState,
} from "./game-logic.ts";
import { levels } from "./levels.ts";

const STORAGE_KEY = "plgame-state";
const CODE_VERSIONS_STORAGE_KEY = "plgame-code-versions";
const CODE_VERSIONS_STORAGE_VERSION = 1;
const MIN_RAIL_WIDTH = 288;
const MIN_EDITOR_WIDTH = 360;
const DIVIDER_WIDTH = 8;
const RAIL_RESIZE_STEP = 24;

type MobileTab = "challenge" | "code" | "results";

type CustomCodeVersion = {
    id: string,
    kind: "custom",
    name: string,
    code: string,
};

type CheckpointCodeVersion = {
    id: string,
    kind: "checkpoint",
    passesThroughLevel: number,
    code: string,
};

type CodeVersion = CustomCodeVersion | CheckpointCodeVersion;

type CodeVersionsState = {
    version: typeof CODE_VERSIONS_STORAGE_VERSION,
    selectedVersionId: string,
    versions: CodeVersion[],
};

createIcons({
    icons: {
        ArrowLeft,
        ArrowRight,
        ArrowRightToLine,
        ChevronDown,
        Info,
        Plus,
    },
});

function element<T extends HTMLElement>(id: string): T {
    const found = document.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Missing #${id}.`);
    return found;
}

const workspace = element<HTMLElement>("workspace");
const editorParent = element<HTMLDivElement>("editor");
const codeVersionSelect = element<HTMLSelectElement>("code-version");
const addCodeVersionButton = element<HTMLButtonElement>("add-code-version");
const renameCodeVersionButton = element<HTMLButtonElement>("rename-code-version");
const deleteCodeVersionButton = element<HTMLButtonElement>("delete-code-version");
const divider = element<HTMLDivElement>("workspace-divider");
const previousButton = element<HTMLButtonElement>("previous-level");
const nextButton = element<HTMLButtonElement>("next-level");
const latestButton = element<HTMLButtonElement>("latest-level");
const runButton = element<HTMLButtonElement>("run");
const refreshPreviewsButton = element<HTMLButtonElement>("refresh-previews");
const levelButton = element<HTMLButtonElement>("level-number");
const levelButtonLabel = element<HTMLSpanElement>("level-number-label");
const levelNavigation = element<HTMLElement>("level-navigation");
const levelGrid = element<HTMLDivElement>("level-grid");
const inputTokens = element<HTMLElement>("level-input");
const outputTokens = element<HTMLElement>("level-output");
const challengeResult = element<HTMLDivElement>("challenge-result");
const status = element<HTMLDivElement>("status");
const failuresTabCount = element<HTMLSpanElement>("failures-tab-count");
const failuresPanelCount = element<HTMLSpanElement>("failures-panel-count");
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

function createCodeVersionId(): string {
    return crypto.randomUUID();
}

function defaultCodeVersions(): CodeVersionsState {
    const id = createCodeVersionId();
    return {
        version: CODE_VERSIONS_STORAGE_VERSION,
        selectedVersionId: id,
        versions: [{
            id,
            kind: "custom",
            name: "My code",
            code: DEFAULT_CODE,
        }],
    };
}

function parseCodeVersions(serialized: string | null): CodeVersionsState {
    if (serialized === null) return defaultCodeVersions();

    try {
        const value: unknown = JSON.parse(serialized);
        if (typeof value !== "object" || value === null) return defaultCodeVersions();

        const saved = value as Record<string, unknown>;
        if (
            saved.version !== CODE_VERSIONS_STORAGE_VERSION
            || typeof saved.selectedVersionId !== "string"
            || !Array.isArray(saved.versions)
            || saved.versions.length === 0
        ) return defaultCodeVersions();

        const versions: CodeVersion[] = [];
        const ids = new Set<string>();
        const customNames = new Set<string>();
        let customVersionCount = 0;
        for (const entry of saved.versions) {
            if (typeof entry !== "object" || entry === null) return defaultCodeVersions();
            const version = entry as Record<string, unknown>;
            if (
                typeof version.id !== "string"
                || version.id.length === 0
                || ids.has(version.id)
                || typeof version.code !== "string"
            ) return defaultCodeVersions();
            ids.add(version.id);

            if (version.kind === "custom") {
                if (typeof version.name !== "string" || version.name.trim().length === 0) {
                    return defaultCodeVersions();
                }
                const name = version.name.trim();
                const normalizedName = name.toLowerCase();
                if (customNames.has(normalizedName)) return defaultCodeVersions();
                customNames.add(normalizedName);
                customVersionCount++;
                versions.push({
                    id: version.id,
                    kind: "custom",
                    name,
                    code: version.code,
                });
            } else if (
                version.kind === "checkpoint"
                && typeof version.passesThroughLevel === "number"
                && Number.isInteger(version.passesThroughLevel)
                && version.passesThroughLevel > 0
                && version.passesThroughLevel <= levels.length
            ) {
                versions.push({
                    id: version.id,
                    kind: "checkpoint",
                    passesThroughLevel: version.passesThroughLevel,
                    code: version.code,
                });
            } else {
                return defaultCodeVersions();
            }
        }

        if (customVersionCount === 0 || !ids.has(saved.selectedVersionId)) {
            return defaultCodeVersions();
        }
        return {
            version: CODE_VERSIONS_STORAGE_VERSION,
            selectedVersionId: saved.selectedVersionId,
            versions,
        };
    } catch {
        return defaultCodeVersions();
    }
}

const state = (() => {
    try {
        return parseState(localStorage.getItem(STORAGE_KEY), levels.length);
    } catch {
        return parseState(null, levels.length);
    }
})();

const codeVersions = (() => {
    try {
        return parseCodeVersions(localStorage.getItem(CODE_VERSIONS_STORAGE_KEY));
    } catch {
        return defaultCodeVersions();
    }
})();

function selectedCodeVersion(): CodeVersion {
    const version = codeVersions.versions.find(
        candidate => candidate.id === codeVersions.selectedVersionId,
    );
    if (!version) throw new Error("The selected code version is missing.");
    return version;
}

let running = false;
let refreshingPreviews = false;
let activeMobileTab: MobileTab = "code";
let levelNavigationExpanded = false;
const renderedLevels: RenderedLevel[] = [];
let previewError: string | undefined;
let runError: string | undefined;
let lastRunFailures = new Map<number, LevelFailure>();
let lastRunTestedThrough = -1;
let railWidth = state.railWidth;
let switchingCodeVersion = false;

function saveState(): void {
    try {
        localStorage.setItem(STORAGE_KEY, serializeState(state));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

function saveCodeVersions(): void {
    try {
        localStorage.setItem(CODE_VERSIONS_STORAGE_KEY, JSON.stringify(codeVersions));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

saveCodeVersions();

function maximumRailWidth(): number {
    return Math.max(MIN_RAIL_WIDTH, workspace.clientWidth - MIN_EDITOR_WIDTH - DIVIDER_WIDTH);
}

function setRailWidth(nextWidth: number, persist: boolean): void {
    railWidth = Math.round(Math.min(Math.max(nextWidth, MIN_RAIL_WIDTH), maximumRailWidth()));
    workspace.style.setProperty("--task-rail-width", `${railWidth}px`);
    divider.setAttribute("aria-valuemax", String(maximumRailWidth()));
    divider.setAttribute("aria-valuenow", String(railWidth));
    if (persist) {
        state.railWidth = railWidth;
        saveState();
    }
}

setRailWidth(railWidth, false);
state.railWidth = railWidth;

const editorReadOnly = new Compartment();
const editor = new EditorView({
    doc: selectedCodeVersion().code,
    extensions: [
        basicSetup,
        javascript(),
        oneDark,
        keymap.of([indentWithTab]),
        editorReadOnly.of([
            EditorState.readOnly.of(selectedCodeVersion().kind === "checkpoint"),
            EditorView.editable.of(selectedCodeVersion().kind === "custom"),
        ]),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged || switchingCodeVersion) return;
            const version = selectedCodeVersion();
            if (version.kind !== "custom") return;
            version.code = update.state.doc.toString();
            saveCodeVersions();
        }),
    ],
    parent: editorParent,
});

function checkpointLabel(passesThroughLevel: number): string {
    return passesThroughLevel === 1
        ? "Passes level 1"
        : `Passes levels 1-${passesThroughLevel}`;
}

function selectCodeVersion(versionId: string): void {
    const version = codeVersions.versions.find(candidate => candidate.id === versionId);
    if (!version) return;

    codeVersions.selectedVersionId = version.id;
    switchingCodeVersion = true;
    try {
        editor.dispatch({
            changes: {from: 0, to: editor.state.doc.length, insert: version.code},
            effects: editorReadOnly.reconfigure([
                EditorState.readOnly.of(version.kind === "checkpoint"),
                EditorView.editable.of(version.kind === "custom"),
            ]),
        });
    } finally {
        switchingCodeVersion = false;
    }
    saveCodeVersions();
    render();
}

function customVersionNameExists(name: string, exceptId?: string): boolean {
    const normalizedName = name.toLowerCase();
    return codeVersions.versions.some(version =>
        version.kind === "custom"
        && version.id !== exceptId
        && version.name.toLowerCase() === normalizedName,
    );
}

function requestedCodeVersionName(message: string, defaultValue?: string): string | undefined {
    const entered = window.prompt(message, defaultValue);
    if (entered === null) return undefined;
    const name = entered.trim();
    if (name.length === 0) {
        window.alert("Version names cannot be empty.");
        return undefined;
    }
    return name;
}

function createCustomCodeVersion(): void {
    const name = requestedCodeVersionName("Name this code version:");
    if (name === undefined) return;
    if (customVersionNameExists(name)) {
        window.alert("A code version with that name already exists.");
        return;
    }

    const version: CustomCodeVersion = {
        id: createCodeVersionId(),
        kind: "custom",
        name,
        code: editor.state.doc.toString(),
    };
    codeVersions.versions.push(version);
    selectCodeVersion(version.id);
}

function renameCustomCodeVersion(): void {
    const version = selectedCodeVersion();
    if (version.kind !== "custom") return;
    const name = requestedCodeVersionName("Rename this code version:", version.name);
    if (name === undefined || name === version.name) return;
    if (customVersionNameExists(name, version.id)) {
        window.alert("A code version with that name already exists.");
        return;
    }
    version.name = name;
    saveCodeVersions();
    render();
}

function deleteCustomCodeVersion(): void {
    const version = selectedCodeVersion();
    if (version.kind !== "custom") return;
    const customVersions = codeVersions.versions.filter(
        (candidate): candidate is CustomCodeVersion => candidate.kind === "custom",
    );
    if (customVersions.length <= 1) return;
    if (!window.confirm(`Delete "${version.name}"?`)) return;

    const nextVersion = customVersions.find(candidate => candidate.id !== version.id);
    if (!nextVersion) throw new Error("A replacement custom code version is missing.");
    const index = codeVersions.versions.indexOf(version);
    codeVersions.versions.splice(index, 1);
    selectCodeVersion(nextVersion.id);
}

function codeBlock(text: string, renderedOutput = false): HTMLPreElement {
    const pre = document.createElement("pre");
    if (renderedOutput) pre.className = "font-mono";
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

function renderChallengeResult(): void {
    if (running) {
        challengeResult.textContent = "Running…";
        return;
    }
    if (runError !== undefined) {
        challengeResult.textContent = `Run failed: ${runError}`;
        return;
    }
    if (lastRunTestedThrough < 0) {
        const label = document.createElement("strong");
        label.textContent = "Your code returned";
        const detail = document.createElement("p");
        detail.textContent = "Run your code to see what it returns.";
        challengeResult.replaceChildren(label, detail);
        return;
    }

    const failure = lastRunFailures.get(state.levelIndex);
    const actualLabel = document.createElement("strong");
    actualLabel.textContent = "Your code returned";
    const children: HTMLElement[] = [actualLabel];

    if (failure?.error) {
        children.push(codeBlock(`Error: ${failure.error.message}`));
    } else {
        const actual = failure?.renderedActual ?? renderedLevels[state.levelIndex]?.expected;
        if (actual === undefined) {
            throw new Error(`Missing rendered output for level ${state.levelIndex + 1}.`);
        }
        children.push(codeBlock(actual, true));
    }

    if (failure) {
        const diffLabel = document.createElement("strong");
        diffLabel.textContent = "Diff";
        children.push(diffLabel);
        if (failure.error) {
            const unavailable = document.createElement("p");
            unavailable.textContent = "A diff is unavailable because your code returned an error.";
            children.push(unavailable);
        } else {
            const actual = failure.renderedActual;
            if (actual === undefined) {
                throw new Error(`Missing rendered output for level ${failure.levelIndex + 1}.`);
            }
            children.push(renderDiff(document, failure.renderedExpected, actual));
        }
    }
    challengeResult.replaceChildren(...children);
}

function renderResults(): void {
    const failureCount = lastRunFailures.size;
    const badgeCount = failureCount - 1;
    for (const badge of [failuresTabCount, failuresPanelCount]) {
        badge.hidden = badgeCount <= 0;
        badge.textContent = String(badgeCount);
    }

    if (running) {
        status.textContent = "Running…";
        return;
    }
    if (lastRunTestedThrough < 0) {
        status.textContent = "Run your code to see failed levels.";
        return;
    }

    const failures = [...lastRunFailures.values()]
        .toSorted((left, right) => left.levelIndex - right.levelIndex);
    if (failures.length === 0) {
        status.textContent = "All tested levels passed.";
        return;
    }

    const list = document.createElement("ul");
    for (const failure of failures) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        const current = failure.levelIndex === state.levelIndex;
        button.textContent = `Level ${failure.levelIndex + 1} failed`;
        if (current) button.setAttribute("aria-current", "step");
        button.addEventListener("click", () => focusFailure(failure));
        item.append(button);
        list.append(item);
    }
    status.replaceChildren(list);
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
    levelButtonLabel.textContent = `Level ${state.levelIndex + 1}`;
    if (itemState === "unlocked") delete levelButton.dataset.levelState;
    else levelButton.dataset.levelState = itemState;
    const unavailable = previewError === undefined
        ? "Rendering preview…"
        : `Preview unavailable: ${previewError}`;
    inputTokens.textContent = rendered?.input ?? unavailable;
    outputTokens.textContent = rendered?.expected ?? unavailable;
}

function renderCodeVersions(): void {
    const customGroup = document.createElement("optgroup");
    customGroup.label = "Editable versions";
    for (const version of codeVersions.versions) {
        if (version.kind !== "custom") continue;
        const option = document.createElement("option");
        option.value = version.id;
        option.textContent = version.name;
        customGroup.append(option);
    }

    const checkpointGroup = document.createElement("optgroup");
    checkpointGroup.label = "Automatic checkpoints";
    const checkpoints = codeVersions.versions
        .filter((version): version is CheckpointCodeVersion => version.kind === "checkpoint")
        .toSorted((left, right) => right.passesThroughLevel - left.passesThroughLevel);
    for (const version of checkpoints) {
        const option = document.createElement("option");
        option.value = version.id;
        option.textContent = checkpointLabel(version.passesThroughLevel);
        checkpointGroup.append(option);
    }

    const groups = checkpoints.length === 0
        ? [customGroup]
        : [customGroup, checkpointGroup];
    codeVersionSelect.replaceChildren(...groups);
    codeVersionSelect.value = codeVersions.selectedVersionId;

    const selectedVersion = selectedCodeVersion();
    const customVersionCount = codeVersions.versions.filter(
        version => version.kind === "custom",
    ).length;
    const controlsDisabled = running || refreshingPreviews;
    codeVersionSelect.disabled = controlsDisabled;
    addCodeVersionButton.disabled = controlsDisabled;
    renameCodeVersionButton.disabled =
        controlsDisabled || selectedVersion.kind !== "custom";
    deleteCodeVersionButton.disabled =
        controlsDisabled || selectedVersion.kind !== "custom" || customVersionCount <= 1;
}

function render(): void {
    previousButton.disabled = running || state.levelIndex === 0;
    nextButton.disabled = running || state.levelIndex === state.highestLevelIndex;
    latestButton.disabled = running || state.levelIndex === state.highestLevelIndex;
    runButton.disabled = running || refreshingPreviews;
    runButton.textContent = "Run";
    levelButton.disabled = running;
    refreshPreviewsButton.disabled = running || refreshingPreviews;
    refreshPreviewsButton.textContent = "Refresh previews";
    levelButton.setAttribute("aria-expanded", String(levelNavigationExpanded));
    levelButton.setAttribute(
        "aria-label",
        levelNavigationExpanded ? "Close unlocked levels" : "Browse unlocked levels",
    );
    workspace.dataset.browsing = String(levelNavigationExpanded);
    levelNavigation.hidden = !levelNavigationExpanded;
    renderCodeVersions();
    renderLevel();
    renderLevelGrid();
    renderChallengeResult();
    renderResults();
    setMobileTab(activeMobileTab);
}

function focusFailure(failure: LevelFailure): void {
    goToLevel(failure.levelIndex);
    setMobileTab("challenge");
}

function goToLevel(levelIndex: number): void {
    if (levelIndex < 0 || levelIndex > state.highestLevelIndex) return;
    state.levelIndex = levelIndex;
    saveState();
    render();
}

async function runGame(): Promise<void> {
    if (running || refreshingPreviews) return;
    running = true;
    runError = undefined;
    render();

    try {
        const code = editor.state.doc.toString();
        const previousHighestLevelIndex = state.highestLevelIndex;
        const result = await runProgression(
            code,
            levels,
            state.levelIndex,
            state.highestLevelIndex,
            runCode,
        );

        const failures = result.levelFailures.filter(
            (failure): failure is LevelFailure => failure !== undefined,
        );
        lastRunFailures = new Map(failures.map(failure => [failure.levelIndex, failure]));
        result.renderedLevels.forEach((renderedLevel, index) => {
            renderedLevels[index] = renderedLevel;
        });
        previewError = undefined;
        state.highestLevelIndex = Math.max(state.highestLevelIndex, result.levelIndex);
        lastRunTestedThrough = state.highestLevelIndex;

        if (state.highestLevelIndex > previousHighestLevelIndex) {
            const passesThroughLevel = result.kind === "complete"
                ? levels.length
                : result.levelIndex;
            if (passesThroughLevel > 0) {
                codeVersions.versions.push({
                    id: createCodeVersionId(),
                    kind: "checkpoint",
                    passesThroughLevel,
                    code,
                });
                saveCodeVersions();
            }
        }
        saveState();
        activeMobileTab = lastRunFailures.has(state.levelIndex) ? "challenge" : "results";
    } catch (error) {
        runError = error instanceof Error ? error.message : String(error);
    } finally {
        running = false;
        render();
    }
}

async function refreshPreviews(): Promise<void> {
    if (running || refreshingPreviews) return;
    refreshingPreviews = true;
    previewError = undefined;
    render();

    const unlockedLevels = levels.slice(0, state.highestLevelIndex + 1);
    try {
        const renderings = await renderCode(
            editor.state.doc.toString(),
            unlockedLevels.flatMap(level => [level.input, level.output]),
        );
        if (renderings.length !== unlockedLevels.length * 2) {
            throw new Error("The code renderer returned an unexpected number of previews.");
        }
        for (const [index] of unlockedLevels.entries()) {
            renderedLevels[index] = {
                input: renderings[index * 2]!,
                expected: renderings[index * 2 + 1]!,
                ...(renderedLevels[index]?.executionTimeMs === undefined
                    ? {}
                    : {executionTimeMs: renderedLevels[index].executionTimeMs}),
            };
        }
    } catch (error) {
        previewError = error instanceof Error ? error.message : String(error);
    } finally {
        refreshingPreviews = false;
        render();
    }
}

codeVersionSelect.addEventListener("change", () => selectCodeVersion(codeVersionSelect.value));
addCodeVersionButton.addEventListener("click", createCustomCodeVersion);
renameCodeVersionButton.addEventListener("click", renameCustomCodeVersion);
deleteCodeVersionButton.addEventListener("click", deleteCustomCodeVersion);
previousButton.addEventListener("click", () => goToLevel(state.levelIndex - 1));
nextButton.addEventListener("click", () => goToLevel(state.levelIndex + 1));
latestButton.addEventListener("click", () => goToLevel(state.highestLevelIndex));
runButton.addEventListener("click", () => void runGame());
refreshPreviewsButton.addEventListener("click", () => void refreshPreviews());
levelButton.addEventListener("click", () => {
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
    state.railWidth = railWidth;
    saveState();
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
void refreshPreviews();
