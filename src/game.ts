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
    CircleX,
    createElement as createIconElement,
    createIcons,
    Info,
    Pencil,
    Plus,
    Settings,
} from "lucide";
import { renderDiff } from "./diff-renderer.ts";
import {
    type ConsoleOutputEntry,
    renderCode,
    runCode,
} from "./executor.ts";
import {
    DEFAULT_CODE,
    type Level,
    type LevelFailure,
    parseState,
    type PreviewRenderMode,
    type RenderedLevel,
    runProgression,
    serializeState,
    type Token,
} from "./game-logic.ts";
import levelData from "./levels.json";

const levelGroups: Level[][] = levelData.map(groupData =>
    Array.from(
        {length: groupData.length / 2},
        (_, index) => ({
            input: groupData[index * 2]! as Token[],
            output: groupData[index * 2 + 1]! as Token[],
        }),
    ),
);
const levels = levelGroups.flat();

const STORAGE_KEY = "plgame-state";
const CODE_VERSIONS_STORAGE_KEY = "plgame-code-versions";
const LEVEL_GROUP_NAMES_STORAGE_KEY = "plgame-level-group-names";
const CODE_VERSIONS_STORAGE_VERSION = 1;
const LEVEL_GROUP_NAMES_STORAGE_VERSION = 1;
const DEFAULT_CODE_VERSION_ID = "default-code";
const MIN_RAIL_WIDTH = 288;
const MIN_EDITOR_WIDTH = 360;
const DIVIDER_WIDTH = 8;
const RAIL_RESIZE_STEP = 24;

type MobileTab = "challenge" | "console" | "code";

type CustomCodeVersion = {
    id: string,
    kind: "custom",
    name: string,
    code: string,
    builtIn?: false,
};

type CheckpointCodeVersion = {
    id: string,
    kind: "checkpoint",
    passesThroughLevel: number,
    code: string,
    builtIn?: true,
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
        Pencil,
        Plus,
        Settings,
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
const previewRenderModeInput = element<HTMLInputElement>("preview-render-mode");
const previewRenderDescriptions = document.querySelectorAll<HTMLElement>(
    "[data-preview-render-description]",
);
const actualRenderDescriptions = document.querySelectorAll<HTMLElement>(
    "[data-actual-render-description]",
);
const levelButton = element<HTMLButtonElement>("level-number");
const levelButtonLabel = element<HTMLSpanElement>("level-number-label");
const levelNavigation = element<HTMLElement>("level-navigation");
const levelSelectionPanel = element<HTMLElement>("level-selection-panel");
const settingsPanel = element<HTMLElement>("settings-panel");
const openSettingsButton = element<HTMLButtonElement>("open-settings");
const closeSettingsButton = element<HTMLButtonElement>("close-settings");
const resetSolvedLevelsButton = element<HTMLButtonElement>("reset-solved-levels");
const deleteAllProgressButton = element<HTMLButtonElement>("delete-all-progress");
const levelGrid = element<HTMLDivElement>("level-grid");
const inputTokens = element<HTMLElement>("level-input");
const outputTokens = element<HTMLElement>("level-output");
const challengeResultsOutdated = element<HTMLDivElement>("challenge-results-outdated");
const challengeRunStatus = element<HTMLDivElement>("challenge-run-status");
const challengeRunStatusLabel = element<HTMLElement>("challenge-run-status-label");
const challengeRunStatusDetail = element<HTMLParagraphElement>("challenge-run-status-detail");
const challengeActualSection = element<HTMLElement>("challenge-actual-section");
const challengeActualError = element<HTMLParagraphElement>("challenge-actual-error");
const challengeActualMessage = element<HTMLParagraphElement>("challenge-actual-message");
const challengeActualOutput = element<HTMLPreElement>("challenge-actual-output");
const challengeActualOutputCode = element<HTMLElement>("challenge-actual-output-code");
const challengeRenderCollisionWarning = element<HTMLDivElement>(
    "challenge-render-collision-warning",
);
const challengeDiffSection = element<HTMLElement>("challenge-diff-section");
const challengeDiffMessage = element<HTMLParagraphElement>("challenge-diff-message");
const challengeDiffOutput = element<HTMLDivElement>("challenge-diff-output");
const consoleOutput = element<HTMLDivElement>("console-output");
const consoleEmpty = element<HTMLParagraphElement>("console-empty");
const levelResultsOutdated = element<HTMLDivElement>("level-results-outdated");
const actionModal = element<HTMLDialogElement>("action-modal");
const actionModalForm = element<HTMLFormElement>("action-modal-form");
const actionModalTitle = element<HTMLHeadingElement>("action-modal-title");
const actionModalDescription = element<HTMLParagraphElement>("action-modal-description");
const actionModalInputSection = element<HTMLDivElement>("action-modal-input-section");
const actionModalInput = element<HTMLInputElement>("action-modal-input");
const actionModalError = element<HTMLParagraphElement>("action-modal-error");
const cancelActionModalButton = element<HTMLButtonElement>("cancel-action-modal");
const confirmActionModalButton = element<HTMLButtonElement>("confirm-action-modal");
const successModal = element<HTMLDialogElement>("success-modal");
const successModalSummary = element<HTMLParagraphElement>("success-modal-summary");
const successResults = element<HTMLDivElement>("success-results");
const successModalActions = element<HTMLElement>("success-modal-actions");
const successPrimaryAction = element<HTMLButtonElement>("success-primary-action");
const closeSuccessModalButton = element<HTMLButtonElement>("close-success-modal");
const mobileTabButtons = [
    element<HTMLButtonElement>("challenge-tab"),
    element<HTMLButtonElement>("console-tab"),
    element<HTMLButtonElement>("code-tab"),
];
const mobilePanels: Record<MobileTab, HTMLElement> = {
    challenge: element<HTMLElement>("challenge-panel"),
    console: element<HTMLElement>("console-panel"),
    code: element<HTMLElement>("code-panel"),
};
const narrowScreen = window.matchMedia("(max-width: 48rem)");

function createCodeVersionId(): string {
    return crypto.randomUUID();
}

function defaultCodeCheckpoint(): CheckpointCodeVersion {
    return {
        id: DEFAULT_CODE_VERSION_ID,
        kind: "checkpoint",
        passesThroughLevel: 0,
        code: DEFAULT_CODE,
        builtIn: true,
    };
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
        }, defaultCodeCheckpoint()],
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
                || version.id === DEFAULT_CODE_VERSION_ID
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
            versions: [...versions, defaultCodeCheckpoint()],
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

function defaultLevelGroupNames(): string[] {
    let firstLevelNumber = 1;
    return levelGroups.map((group) => {
        const lastLevelNumber = firstLevelNumber + group.length - 1;
        const name = `Levels ${firstLevelNumber}-${lastLevelNumber}`;
        firstLevelNumber = lastLevelNumber + 1;
        return name;
    });
}

function parseLevelGroupNames(serialized: string | null): string[] {
    const defaults = defaultLevelGroupNames();
    if (serialized === null) return defaults;

    try {
        const value: unknown = JSON.parse(serialized);
        if (typeof value !== "object" || value === null) return defaults;
        const saved = value as Record<string, unknown>;
        if (
            saved.version !== LEVEL_GROUP_NAMES_STORAGE_VERSION
            || !Array.isArray(saved.names)
            || saved.names.length !== levelGroups.length
            || saved.names.some(name => typeof name !== "string" || name.trim().length === 0)
        ) return defaults;
        return saved.names.map(name => (name as string).trim());
    } catch {
        return defaults;
    }
}

const levelGroupNames = (() => {
    try {
        return parseLevelGroupNames(localStorage.getItem(LEVEL_GROUP_NAMES_STORAGE_KEY));
    } catch {
        return defaultLevelGroupNames();
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
let previewRenderMode: PreviewRenderMode = state.previewRenderMode;
let activeMobileTab: MobileTab = "code";
let levelNavigationExpanded = false;
let settingsExpanded = false;
const renderedLevels: RenderedLevel[] = [];
let previewError: string | undefined;
let runError: string | undefined;
let lastRunFailures = new Map<number, LevelFailure>();
let lastRunTestedThrough = -1;
let resultsOutOfDate = false;
let lastConsoleOutput: ConsoleOutputEntry[] = [];
let renderedConsoleOutput: ConsoleOutputEntry[] | undefined;
let railWidth = state.railWidth;
let switchingCodeVersion = false;
let actionModalSubmit: ((value: string) => string | undefined) | undefined;

function saveState(): void {
    try {
        localStorage.setItem(STORAGE_KEY, serializeState(state));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

function saveCodeVersions(): void {
    try {
        const persistedVersions = codeVersions.versions.filter(version => !version.builtIn);
        const selectedVersionId = selectedCodeVersion().builtIn
            ? persistedVersions.find(version => version.kind === "custom")?.id
            : codeVersions.selectedVersionId;
        if (selectedVersionId === undefined) return;
        localStorage.setItem(CODE_VERSIONS_STORAGE_KEY, JSON.stringify({
            ...codeVersions,
            selectedVersionId,
            versions: persistedVersions,
        }));
    } catch {
        // Storage can be disabled without preventing the game from working.
    }
}

function saveLevelGroupNames(): void {
    try {
        localStorage.setItem(LEVEL_GROUP_NAMES_STORAGE_KEY, JSON.stringify({
            version: LEVEL_GROUP_NAMES_STORAGE_VERSION,
            names: levelGroupNames,
        }));
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
        ]),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged || switchingCodeVersion) return;
            const version = selectedCodeVersion();
            if (version.kind !== "custom") return;
            version.code = update.state.doc.toString();
            saveCodeVersions();
            if (
                !resultsOutOfDate
                && (lastRunTestedThrough >= 0 || runError !== undefined)
            ) {
                resultsOutOfDate = true;
                render();
            }
        }),
    ],
    parent: editorParent,
});

function checkpointLabel(passesThroughLevel: number): string {
    if (passesThroughLevel === 0) return "Default code";
    return passesThroughLevel === 1
        ? "Passes level 1"
        : `Passes levels 1-${passesThroughLevel}`;
}

function selectCodeVersion(versionId: string): void {
    const version = codeVersions.versions.find(candidate => candidate.id === versionId);
    if (!version) return;
    const changedVersion = version.id !== codeVersions.selectedVersionId;

    codeVersions.selectedVersionId = version.id;
    switchingCodeVersion = true;
    try {
        editor.dispatch({
            changes: {from: 0, to: editor.state.doc.length, insert: version.code},
            effects: editorReadOnly.reconfigure([
                EditorState.readOnly.of(version.kind === "checkpoint"),
            ]),
        });
    } finally {
        switchingCodeVersion = false;
    }
    saveCodeVersions();
    if (changedVersion && (lastRunTestedThrough >= 0 || runError !== undefined)) {
        resultsOutOfDate = true;
    }
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

function closeActionModal(): void {
    actionModal.close();
    actionModalSubmit = undefined;
}

function openNameModal(
    title: string,
    description: string,
    submitLabel: string,
    defaultValue: string,
    onSubmit: (name: string) => string | undefined,
): void {
    actionModalTitle.textContent = title;
    actionModalDescription.textContent = description;
    actionModalInputSection.hidden = false;
    actionModalInput.value = defaultValue;
    actionModalError.textContent = "";
    confirmActionModalButton.textContent = submitLabel;
    confirmActionModalButton.className =
        "rounded border border-violet-400 bg-violet-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:border-violet-300 hover:bg-violet-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400";
    actionModalSubmit = onSubmit;
    actionModal.showModal();
    actionModalInput.focus();
    actionModalInput.select();
}

function openConfirmModal(
    title: string,
    description: string,
    submitLabel: string,
    onSubmit: () => void,
): void {
    actionModalTitle.textContent = title;
    actionModalDescription.textContent = description;
    actionModalInputSection.hidden = true;
    actionModalError.textContent = "";
    confirmActionModalButton.textContent = submitLabel;
    confirmActionModalButton.className =
        "rounded border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:border-red-400 hover:bg-red-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400";
    actionModalSubmit = () => {
        onSubmit();
        return undefined;
    };
    actionModal.showModal();
    confirmActionModalButton.focus();
}

function createCustomCodeVersion(): void {
    const copyingCheckpoint = selectedCodeVersion().kind === "checkpoint";
    openNameModal(
        copyingCheckpoint ? "Copy automatic checkpoint" : "Create code version",
        copyingCheckpoint
            ? "Create an editable version from this automatic checkpoint."
            : "Create a new editable version from the current code.",
        copyingCheckpoint ? "Copy" : "Create",
        "",
        (name) => {
            if (name.length === 0) return "Version names cannot be empty.";
            if (customVersionNameExists(name)) {
                return "A code version with that name already exists.";
            }

            const version: CustomCodeVersion = {
                id: createCodeVersionId(),
                kind: "custom",
                name,
                code: editor.state.doc.toString(),
            };
            codeVersions.versions.push(version);
            selectCodeVersion(version.id);
            return undefined;
        },
    );
}

function renameCustomCodeVersion(): void {
    const version = selectedCodeVersion();
    if (version.kind !== "custom") return;
    openNameModal(
        "Rename code version",
        "Choose a unique name for this editable version.",
        "Rename",
        version.name,
        (name) => {
            if (name.length === 0) return "Version names cannot be empty.";
            if (name === version.name) return undefined;
            if (customVersionNameExists(name, version.id)) {
                return "A code version with that name already exists.";
            }
            version.name = name;
            saveCodeVersions();
            render();
            return undefined;
        },
    );
}

function deleteCodeVersion(): void {
    const version = selectedCodeVersion();
    const customVersions = codeVersions.versions.filter(
        (candidate): candidate is CustomCodeVersion => candidate.kind === "custom",
    );
    if (version.kind === "custom" && customVersions.length <= 1) return;

    const label = version.kind === "custom"
        ? `"${version.name}"`
        : `"${checkpointLabel(version.passesThroughLevel)}"`;
    openConfirmModal(
        "Delete code version?",
        `Permanently delete ${label}?`,
        "Delete",
        () => {
            const nextVersion = customVersions.find(candidate => candidate.id !== version.id);
            if (!nextVersion) throw new Error("A replacement custom code version is missing.");
            const index = codeVersions.versions.indexOf(version);
            codeVersions.versions.splice(index, 1);
            selectCodeVersion(nextVersion.id);
        },
    );
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
    challengeRunStatus.hidden = true;
    challengeActualSection.hidden = true;
    challengeActualError.hidden = true;
    challengeActualMessage.hidden = true;
    challengeActualOutput.hidden = true;
    challengeRenderCollisionWarning.hidden = true;
    challengeDiffSection.hidden = true;
    challengeDiffMessage.hidden = true;
    challengeDiffOutput.hidden = true;
    challengeDiffOutput.replaceChildren();

    if (running) {
        challengeRunStatusLabel.textContent = "Running…";
        challengeRunStatusDetail.textContent = "";
        challengeRunStatus.hidden = false;
        return;
    }
    if (runError !== undefined) {
        challengeRunStatusLabel.textContent = "Run failed";
        challengeRunStatusDetail.textContent = runError;
        challengeRunStatus.hidden = false;
        return;
    }

    challengeActualSection.hidden = false;
    if (lastRunTestedThrough < 0) {
        challengeActualMessage.hidden = false;
        return;
    }

    const failure = lastRunFailures.get(state.levelIndex);
    if (failure?.error) {
        challengeActualError.textContent = `Error: ${failure.error.message}`;
        challengeActualError.hidden = false;
    }
    if (failure?.error && failure.actual === undefined) {
        challengeActualOutputCode.textContent = "";
    } else {
        const actual = failure === undefined
            ? renderTokensForDisplay(
                    levels[state.levelIndex]?.output,
                    renderedLevels[state.levelIndex]?.expected,
                )
            : renderTokensForDisplay(failure.actual, failure.renderedActual);
        if (actual === undefined) {
            throw new Error(`Missing rendered output for level ${state.levelIndex + 1}.`);
        }
        challengeActualOutputCode.textContent = actual;
    }
    challengeActualOutput.hidden = failure?.error !== undefined
        && failure.actual === undefined;

    if (failure) {
        challengeDiffSection.hidden = false;
        if (failure.actual !== undefined) {
            const expected = renderTokensForDisplay(
                failure.expected,
                failure.renderedExpected,
            );
            const actual = renderTokensForDisplay(failure.actual, failure.renderedActual);
            if (expected === undefined || actual === undefined) {
                throw new Error(`Missing rendered output for level ${failure.levelIndex + 1}.`);
            }
            challengeRenderCollisionWarning.hidden = !hasRenderCollision(failure);
            challengeDiffOutput.replaceChildren(
                renderDiff(document, expected, actual),
            );
            challengeDiffOutput.hidden = false;
        } else if (failure.error) {
            challengeDiffMessage.textContent =
                "A diff is unavailable because your code returned an error.";
            challengeDiffMessage.hidden = false;
        }
    }
}

function renderConsole(): void {
    if (renderedConsoleOutput === lastConsoleOutput) return;
    renderedConsoleOutput = lastConsoleOutput;

    if (lastConsoleOutput.length === 0) {
        consoleOutput.replaceChildren(consoleEmpty);
        return;
    }

    const lines: HTMLElement[] = [];
    let previousLevelIndex: number | undefined;
    for (const entry of lastConsoleOutput) {
        if (entry.levelIndex !== undefined && entry.levelIndex !== previousLevelIndex) {
            const levelIndex = entry.levelIndex;
            const header = document.createElement("button");
            header.type = "button";
            header.className =
                "my-1 flex w-full items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-left font-sans font-semibold text-violet-300 hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-400";
            const label = document.createElement("span");
            label.textContent = `Level ${levelIndex + 1}`;
            const arrow = createIconElement(ArrowRight, {
                "aria-hidden": "true",
                "class": "lucide lucide-arrow-right shrink-0",
                "height": 14,
                "width": 14,
            });
            header.replaceChildren(label, arrow);
            header.addEventListener("click", () => {
                levelNavigationExpanded = false;
                goToLevel(levelIndex);
                if (narrowScreen.matches) setMobileTab("code");
            });
            lines.push(header);
        }

        const line = document.createElement("div");
        line.className = "whitespace-pre-wrap break-words";
        line.textContent = entry.message;
        lines.push(line);
        previousLevelIndex = entry.levelIndex;
    }
    consoleOutput.replaceChildren(...lines);
}

function levelState(levelIndex: number): "failed" | "passed" | "unlocked" {
    if (lastRunFailures.has(levelIndex)) return "failed";
    if (levelIndex <= lastRunTestedThrough) return "passed";
    return "unlocked";
}

function renderLevelGrid(): void {
    if (!levelNavigationExpanded) return;
    const sections: HTMLElement[] = [];
    let groupStartIndex = 0;
    for (const [groupIndex, group] of levelGroups.entries()) {
        if (groupStartIndex > state.highestLevelIndex) break;
        const groupName = levelGroupNames[groupIndex]
            ?? defaultLevelGroupNames()[groupIndex]
            ?? "Levels";

        const section = document.createElement("section");
        const headingId = `level-group-${groupIndex}-heading`;
        section.setAttribute("aria-labelledby", headingId);

        const header = document.createElement("div");
        header.className = "mb-1.5 flex items-center gap-1.5";
        const heading = document.createElement("h3");
        heading.id = headingId;
        heading.className = "min-w-0 truncate text-xs font-semibold text-zinc-400";
        heading.textContent = groupName;

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "grid size-6 shrink-0 place-items-center rounded text-zinc-600 hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400";
        editButton.setAttribute("aria-label", `Rename ${groupName}`);
        editButton.append(createIconElement(Pencil, {
            "aria-hidden": "true",
            "class": "lucide lucide-pencil",
            "height": 12,
            "width": 12,
        }));
        editButton.addEventListener("click", () => {
            openNameModal(
                "Rename level group",
                "Choose a name for this group of levels.",
                "Rename",
                groupName,
                (name) => {
                    if (name.length === 0) return "Group names cannot be empty.";
                    levelGroupNames[groupIndex] = name;
                    saveLevelGroupNames();
                    render();
                    return undefined;
                },
            );
        });
        header.append(heading, editButton);

        const grid = document.createElement("div");
        grid.className = "grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5";
        const buttons: HTMLButtonElement[] = [];
        const groupEndIndex = Math.min(
            groupStartIndex + group.length - 1,
            state.highestLevelIndex,
        );
        for (
            let levelIndex = groupStartIndex;
            levelIndex <= groupEndIndex;
            levelIndex++
        ) {
            const button = document.createElement("button");
            const itemState = levelState(levelIndex);
            const current = levelIndex === state.levelIndex;
            button.type = "button";
            button.className = "grid gap-0.5 rounded border border-zinc-800 bg-zinc-900/60 p-2 text-left text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 data-[level-state=failed]:border-red-500/40 data-[level-state=failed]:bg-red-500/10 data-[level-state=failed]:text-red-300 data-[level-state=passed]:border-emerald-500/30 data-[level-state=passed]:bg-emerald-500/10 data-[level-state=passed]:text-emerald-300 aria-[current=step]:border-violet-400 aria-[current=step]:ring-1 aria-[current=step]:ring-violet-400";
            button.dataset.levelState = itemState;
            const name = document.createElement("strong");
            const nameLabel = document.createElement("span");
            nameLabel.textContent = `Level ${levelIndex + 1}`;
            name.append(nameLabel);
            const executionTimeMs = renderedLevels[levelIndex]?.executionTimeMs;
            const timing = document.createElement("small");
            timing.className = "level-grid-time text-[0.625rem] font-normal text-zinc-600";
            const executionTime = executionTimeMs === undefined
                ? "Not run"
                : `${executionTimeMs.toFixed(2)} ms`;
            if (itemState === "failed") {
                timing.className += " flex items-center gap-1 !text-red-300";
                const failureIcon = createIconElement(CircleX, {
                    "aria-hidden": "true",
                    "class": "lucide lucide-circle-x shrink-0",
                    "height": 12,
                    "width": 12,
                });
                timing.append(failureIcon, `Failed · ${executionTime}`);
            } else {
                timing.textContent = executionTime;
            }
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
        grid.replaceChildren(...buttons);
        section.append(header, grid);
        sections.push(section);
        groupStartIndex += group.length;
    }
    levelGrid.replaceChildren(...sections);
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
    inputTokens.textContent = renderTokensForDisplay(level.input, rendered?.input) ?? unavailable;
    outputTokens.textContent =
        renderTokensForDisplay(level.output, rendered?.expected) ?? unavailable;
}

function renderTokensForDisplay(
    tokens: unknown[] | undefined,
    playerRendering: string | undefined,
): string | undefined {
    if (previewRenderMode === "json") {
        return tokens === undefined ? undefined : JSON.stringify(tokens);
    }
    return playerRendering;
}

function hasRenderCollision(failure: LevelFailure): boolean {
    return failure.error === undefined
        && failure.renderedActual !== undefined
        && failure.renderedExpected === failure.renderedActual;
}

function renderPreviewModeControls(): void {
    const usingJson = previewRenderMode === "json";
    previewRenderModeInput.checked = !usingJson;
    previewRenderModeInput.disabled = running || refreshingPreviews;

    for (const description of previewRenderDescriptions) {
        description.title = usingJson
            ? "This preview is displayed using JSON.stringify()."
            : "This preview is rendered using your code's render() function.";
        const label = description.querySelector("span");
        if (label) {
            label.replaceChildren(
                "via ",
                Object.assign(document.createElement("code"), {
                    className: "text-zinc-500",
                    textContent: usingJson ? "JSON.stringify()" : "render()",
                }),
            );
        }
    }
    for (const description of actualRenderDescriptions) {
        description.title = usingJson
            ? "This output is returned by execute() and displayed using JSON.stringify()."
            : "This output is returned by execute() and rendered using render().";
        const label = description.querySelector("span");
        if (label) {
            label.replaceChildren(
                "via ",
                Object.assign(document.createElement("code"), {
                    className: "text-zinc-500",
                    textContent: usingJson ? "JSON.stringify(execute())" : "render(execute())",
                }),
            );
        }
    }
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
    if (selectedVersion.kind === "checkpoint") {
        addCodeVersionButton.textContent = "Copy";
        addCodeVersionButton.setAttribute("aria-label", "Copy automatic checkpoint");
    } else {
        addCodeVersionButton.replaceChildren(createIconElement(Plus));
        addCodeVersionButton.setAttribute("aria-label", "Create code version");
    }
    renameCodeVersionButton.disabled =
        controlsDisabled || selectedVersion.kind !== "custom";
    deleteCodeVersionButton.disabled =
        controlsDisabled
        || selectedVersion.builtIn
        || (selectedVersion.kind === "custom" && customVersionCount <= 1);
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
    renderPreviewModeControls();
    levelButton.setAttribute("aria-expanded", String(levelNavigationExpanded));
    levelButton.setAttribute(
        "aria-label",
        levelNavigationExpanded ? "Close unlocked levels" : "Browse unlocked levels",
    );
    workspace.dataset.browsing = String(levelNavigationExpanded);
    levelNavigation.hidden = !levelNavigationExpanded;
    levelSelectionPanel.hidden = settingsExpanded;
    settingsPanel.hidden = !settingsExpanded;
    resetSolvedLevelsButton.disabled =
        running || refreshingPreviews || state.highestLevelIndex === 0;
    deleteAllProgressButton.disabled = running || refreshingPreviews;
    const showOutdatedResults = resultsOutOfDate && !running;
    challengeResultsOutdated.hidden = !showOutdatedResults;
    levelResultsOutdated.hidden = !showOutdatedResults;
    renderCodeVersions();
    renderLevel();
    renderLevelGrid();
    renderChallengeResult();
    renderConsole();
    setMobileTab(activeMobileTab);
}

function resetSolvedLevels(): void {
    if (running || refreshingPreviews || state.highestLevelIndex === 0) return;

    state.highestLevelIndex = 0;
    state.levelIndex = 0;
    lastRunFailures = new Map();
    lastRunTestedThrough = -1;
    resultsOutOfDate = false;
    runError = undefined;
    saveState();
    render();
}

function deleteAllProgress(): void {
    if (running || refreshingPreviews) return;
    openConfirmModal(
        "Delete all progress and code?",
        "Permanently delete all level progress, code versions, and automatic checkpoints? This cannot be undone.",
        "Delete everything",
        () => {
            try {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(CODE_VERSIONS_STORAGE_KEY);
                localStorage.removeItem(LEVEL_GROUP_NAMES_STORAGE_KEY);
            } finally {
                window.location.reload();
            }
        },
    );
}

function focusFailure(failure: LevelFailure): void {
    openLevelFromSuccessModal(failure.levelIndex);
}

function openLevelFromSuccessModal(levelIndex: number): void {
    successModal.close();
    levelNavigationExpanded = false;
    goToLevel(levelIndex);
    setMobileTab("challenge");
}

type SuccessRun = {
    currentLevelIndex: number,
    previousHighestLevelIndex: number,
    highestLevelIndex: number,
};

function levelRangeLabel(startIndex: number, endIndex: number): string {
    return startIndex === endIndex
        ? `Level ${startIndex + 1}`
        : `Levels ${startIndex + 1}-${endIndex + 1}`;
}

function createSuccessResultItem(
    label: string,
    tone: "passed" | "failed" | "highlight" | "frontier",
): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "rounded border p-2.5";
    const toneClasses = {
        passed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        failed: "border-red-500/40 bg-red-500/10 text-red-300",
        highlight: "border-blue-400/40 bg-blue-400/10 text-blue-300",
        frontier: "border-yellow-400/40 bg-yellow-400/10 text-yellow-300",
    };
    item.classList.add(...toneClasses[tone].split(" "));
    item.dataset.resultTone = tone;
    item.setAttribute("aria-label", label);
    return item;
}

function appendFailureResult(list: HTMLUListElement, failure: LevelFailure): void {
    const item = createSuccessResultItem(
        `Level ${failure.levelIndex + 1} failed`,
        "failed",
    );
    const button = document.createElement("button");
    button.className = "group flex w-full items-center justify-between gap-3 rounded border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-left font-semibold hover:border-red-300/60 hover:bg-red-500/20 hover:text-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400";
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = `Level ${failure.levelIndex + 1} failed`;
    const action = document.createElement("span");
    action.className = "shrink-0 font-medium text-red-200";
    action.textContent = "Open level →";
    button.replaceChildren(label, action);
    button.addEventListener("click", () => focusFailure(failure));
    item.append(button);

    if (failure.error) {
        const error = document.createElement("p");
        error.className = "mt-2 text-zinc-400";
        error.textContent = `Error: ${failure.error.message}`;
        item.append(error);
    }
    if (failure.actual !== undefined) {
        const expected = renderTokensForDisplay(failure.expected, failure.renderedExpected);
        const actual = renderTokensForDisplay(failure.actual, failure.renderedActual);
        if (expected === undefined || actual === undefined) {
            throw new Error(`Missing rendered output for level ${failure.levelIndex + 1}.`);
        }
        if (hasRenderCollision(failure)) {
            const warning = document.createElement("p");
            warning.className =
                "mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-amber-200";
            warning.textContent =
                "Render warning: render() displays the expected output and your output identically even though their token arrays differ.";
            item.append(warning);
        }
        item.append(renderDiff(document, expected, actual));
    }
    list.append(item);
}

function showSuccessModal(run: SuccessRun): void {
    const unlockedNewLevels = run.highestLevelIndex > run.previousHighestLevelIndex;
    const highlightedLevels = new Set<number>();
    if (unlockedNewLevels) {
        highlightedLevels.add(run.currentLevelIndex);
        for (
            let levelIndex = run.previousHighestLevelIndex + 1;
            levelIndex <= run.highestLevelIndex;
            levelIndex++
        ) highlightedLevels.add(levelIndex);
    }

    const list = document.createElement("ul");
    list.className = "grid gap-2";
    let passingRangeStart: number | undefined;
    const appendPassingRange = (endIndex: number): void => {
        if (passingRangeStart === undefined) return;
        const label = `${levelRangeLabel(passingRangeStart, endIndex)} passed`;
        const item = createSuccessResultItem(label, "passed");
        item.textContent = label;
        list.append(item);
        passingRangeStart = undefined;
    };

    for (let levelIndex = 0; levelIndex <= run.highestLevelIndex; levelIndex++) {
        const failure = lastRunFailures.get(levelIndex);
        const highlighted = highlightedLevels.has(levelIndex);
        if (!failure && !highlighted) {
            if (passingRangeStart === undefined) passingRangeStart = levelIndex;
            continue;
        }
        appendPassingRange(levelIndex - 1);

        if (highlighted) {
            const isFrontierFailure = failure !== undefined
                && levelIndex > run.previousHighestLevelIndex;
            const item = createSuccessResultItem(
                `Level ${levelIndex + 1}`,
                isFrontierFailure ? "frontier" : "highlight",
            );
            const name = document.createElement("strong");
            name.textContent = `Level ${levelIndex + 1}`;
            const detail = document.createElement("span");
            detail.className = "ml-2 font-normal opacity-80";
            if (levelIndex === run.currentLevelIndex) detail.textContent = "Current level · passed";
            else if (isFrontierFailure) detail.textContent = "New level · not passed";
            else detail.textContent = "New level · passed";
            item.replaceChildren(name, detail);
            list.append(item);
        } else if (failure) {
            appendFailureResult(list, failure);
        }
    }
    appendPassingRange(run.highestLevelIndex);

    const newLevelCount = Math.max(
        0,
        run.highestLevelIndex - run.previousHighestLevelIndex,
    );
    successModalSummary.textContent = newLevelCount === 0
        ? "Your latest run passed the current level."
        : `${newLevelCount} new ${newLevelCount === 1 ? "level" : "levels"} unlocked.`;
    successResults.replaceChildren(list);

    const firstFailure = [...lastRunFailures.values()]
        .filter(failure => failure.levelIndex <= run.highestLevelIndex)
        .toSorted((left, right) => left.levelIndex - right.levelIndex)[0];
    if (unlockedNewLevels) {
        successPrimaryAction.textContent = `Continue to Level ${run.highestLevelIndex + 1}`;
        successPrimaryAction.onclick = () =>
            openLevelFromSuccessModal(run.highestLevelIndex);
        successModalActions.hidden = false;
    } else if (firstFailure) {
        successPrimaryAction.textContent = `Review first failure · Level ${firstFailure.levelIndex + 1}`;
        successPrimaryAction.onclick = () => focusFailure(firstFailure);
        successModalActions.hidden = false;
    } else {
        successPrimaryAction.onclick = null;
        successModalActions.hidden = true;
    }
    successModal.showModal();
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
    lastConsoleOutput = [];
    render();

    const code = editor.state.doc.toString();
    const codeVersionId = codeVersions.selectedVersionId;
    try {
        const currentLevelIndex = state.levelIndex;
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
        lastConsoleOutput = result.consoleOutput;
        lastRunFailures = new Map(failures.map(failure => [failure.levelIndex, failure]));
        result.renderedLevels.forEach((renderedLevel, index) => {
            renderedLevels[index] = renderedLevel;
        });
        previewError = undefined;
        state.highestLevelIndex = Math.max(state.highestLevelIndex, result.levelIndex);
        lastRunTestedThrough = state.highestLevelIndex;
        resultsOutOfDate = codeVersionId !== codeVersions.selectedVersionId
            || code !== editor.state.doc.toString();

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
        const currentLevelPassed = !lastRunFailures.has(currentLevelIndex);
        if (!currentLevelPassed) {
            activeMobileTab = "challenge";
        }
        const unlockedNewLevels = state.highestLevelIndex > previousHighestLevelIndex;
        const shouldShowSuccessModal = currentLevelPassed
            && (!levelNavigationExpanded || unlockedNewLevels);
        render();
        if (shouldShowSuccessModal) {
            showSuccessModal({
                currentLevelIndex,
                previousHighestLevelIndex,
                highestLevelIndex: state.highestLevelIndex,
            });
        }
    } catch (error) {
        runError = error instanceof Error ? error.message : String(error);
        resultsOutOfDate = lastRunTestedThrough >= 0
            || codeVersionId !== codeVersions.selectedVersionId
            || code !== editor.state.doc.toString();
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
        const result = await renderCode(
            editor.state.doc.toString(),
            unlockedLevels.flatMap(level => [level.input, level.output]),
            unlockedLevels.map((_level, levelIndex) => levelIndex),
        );
        const {renderings} = result;
        lastConsoleOutput = result.consoleOutput;
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
deleteCodeVersionButton.addEventListener("click", deleteCodeVersion);
actionModalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!actionModalSubmit) return;
    const error = actionModalSubmit(actionModalInput.value.trim());
    if (error !== undefined) {
        actionModalError.textContent = error;
        actionModalInput.focus();
        return;
    }
    closeActionModal();
});
cancelActionModalButton.addEventListener("click", closeActionModal);
actionModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeActionModal();
});
actionModal.addEventListener("click", (event) => {
    if (event.target === actionModal) closeActionModal();
});
previousButton.addEventListener("click", () => {
    levelNavigationExpanded = false;
    goToLevel(state.levelIndex - 1);
});
nextButton.addEventListener("click", () => {
    levelNavigationExpanded = false;
    goToLevel(state.levelIndex + 1);
});
latestButton.addEventListener("click", () => {
    levelNavigationExpanded = false;
    goToLevel(state.highestLevelIndex);
});
runButton.addEventListener("click", () => void runGame());
refreshPreviewsButton.addEventListener("click", () => void refreshPreviews());
previewRenderModeInput.addEventListener("change", () => {
    previewRenderMode = previewRenderModeInput.checked ? "player" : "json";
    state.previewRenderMode = previewRenderMode;
    saveState();
    render();
});
closeSuccessModalButton.addEventListener("click", () => successModal.close());
successModal.addEventListener("click", (event) => {
    if (event.target === successModal) successModal.close();
});
levelButton.addEventListener("click", () => {
    levelNavigationExpanded = !levelNavigationExpanded;
    if (!levelNavigationExpanded) settingsExpanded = false;
    render();
});
openSettingsButton.addEventListener("click", () => {
    settingsExpanded = true;
    render();
});
closeSettingsButton.addEventListener("click", () => {
    settingsExpanded = false;
    render();
});
resetSolvedLevelsButton.addEventListener("click", resetSolvedLevels);
deleteAllProgressButton.addEventListener("click", deleteAllProgress);

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
