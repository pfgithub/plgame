import type {
    CodeExecutionResult,
    CodeRunOptions,
    ConsoleOutputEntry,
} from "./executor.ts";

export type Token = number & {__is_token: true};
export type Level = {input: Token[], output: Token[]};
export type PreviewRenderMode = "player" | "json";

export const DEFAULT_CODE = `
// Write code in execute() to solve the level
function execute(tokens) {
    return tokens;
}
// Your same code needs to solve every level

// You may update render() to make the levels easier to understand
function render(tokens) {
    return JSON.stringify(tokens);
}`;

export type GameState = {
    levelIndex: number,
    highestLevelIndex: number,
    railWidth: number,
    previewRenderMode: PreviewRenderMode,
};

export type LevelFailure = {
    levelIndex: number,
    expected: number[],
    renderedExpected: string,
    actual?: unknown[],
    renderedActual?: string,
    error?: Error,
};

export type RenderedLevel = {
    input: string,
    expected: string,
    executionTimeMs?: number,
};

export type ProgressionResult =
    | {kind: "past-failures", levelIndex: number, pastFailures: LevelFailure[], levelFailures: Array<LevelFailure | undefined>, renderedLevels: RenderedLevel[], consoleOutput: ConsoleOutputEntry[]}
    | {kind: "failed", levelIndex: number, failure: LevelFailure, pastFailures: LevelFailure[], levelFailures: Array<LevelFailure | undefined>, renderedLevels: RenderedLevel[], consoleOutput: ConsoleOutputEntry[]}
    | {kind: "complete", levelIndex: number, pastFailures: LevelFailure[], levelFailures: Array<LevelFailure | undefined>, renderedLevels: RenderedLevel[], consoleOutput: ConsoleOutputEntry[]};

type Runner = (
    code: string,
    inputs: number[][],
    valuesToRender: number[][],
    options?: CodeRunOptions,
    levelIndices?: number[],
) => Promise<{
    executions: CodeExecutionResult[],
    renderings: string[],
    consoleOutput?: ConsoleOutputEntry[],
}>;

const STORAGE_VERSION = 5;
const DEFAULT_RAIL_WIDTH = 416;

export function defaultState(): GameState {
    return {
        levelIndex: 0,
        highestLevelIndex: 0,
        railWidth: DEFAULT_RAIL_WIDTH,
        previewRenderMode: "player",
    };
}

export function arraysEqual(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function runProgression(
    code: string,
    levels: Level[],
    currentLevelIndex: number,
    highestLevelIndex: number,
    runner: Runner,
): Promise<ProgressionResult> {
    const runnableLevels = levels.map((level, levelIndex) => ({
        levelIndex,
        input: level.input,
        expected: level.output,
    }));
    const renderedLevels: RenderedLevel[] = [];
    const consoleOutput: ConsoleOutputEntry[] = [];
    const levelFailures: Array<LevelFailure | undefined> = Array.from({
        length: levels.length,
    });
    const executedLevels = Array.from({length: levels.length}, () => false);

    async function runLevels(
        levelsToRun: Array<{levelIndex: number, input: Token[], expected: Token[]}>,
        options?: CodeRunOptions,
    ): Promise<void> {
        let executions: CodeExecutionResult[];
        let renderings: string[];
        try {
            const run = await runner(
                code,
                levelsToRun.map(level => level.input),
                levelsToRun.flatMap(level => [level.input, level.expected]),
                options,
                levelsToRun.map(level => level.levelIndex),
            );
            executions = run.executions;
            renderings = run.renderings;
            consoleOutput.push(...(run.consoleOutput ?? []));
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
        if (
            executions.length !== levelsToRun.length
            && (
                options === undefined
                || executions.length < options.stopAtFirstFailureFrom
            )
        ) {
            throw new Error("The code runner returned an unexpected number of results.");
        }
        if (renderings.length !== levelsToRun.length * 2) {
            throw new Error("The code runner returned an unexpected number of renderings.");
        }

        levelsToRun.slice(0, executions.length).forEach((level, index) => {
            const execution = executions[index];
            if (!execution) {
                throw new Error(`Missing execution result for level ${level.levelIndex + 1}.`);
            }
            const executionTimeMs = execution.executionTimeMs;
            const renderedLevel: RenderedLevel = {
                input: renderings[index * 2]!,
                expected: renderings[index * 2 + 1]!,
                ...(executionTimeMs === undefined ? {} : {executionTimeMs}),
            };
            renderedLevels[level.levelIndex] = renderedLevel;
            executedLevels[level.levelIndex] = true;

            if (!execution.ok) {
                levelFailures[level.levelIndex] = {
                    levelIndex: level.levelIndex,
                    expected: level.expected,
                    renderedExpected: renderedLevel.expected,
                    ...(execution.result === undefined ? {} : {actual: execution.result}),
                    ...(execution.renderedResult === undefined
                        ? {}
                        : {renderedActual: execution.renderedResult}),
                    error: execution.error,
                };
            } else if (!arraysEqual(execution.result, level.expected)) {
                levelFailures[level.levelIndex] = {
                    levelIndex: level.levelIndex,
                    expected: level.expected,
                    renderedExpected: renderedLevel.expected,
                    actual: execution.result,
                    renderedActual: execution.renderedResult,
                };
            }
        });
    }

    if (runnableLevels.length > 0) {
        await runLevels(runnableLevels, {
            stopAtFirstFailureFrom: highestLevelIndex + 1,
            expectedResults: runnableLevels.map(level => level.expected),
        });
    }

    const pastFailures = levelFailures
        .slice(0, currentLevelIndex)
        .filter((failure): failure is LevelFailure => failure !== undefined);
    const currentFailure = levelFailures[currentLevelIndex];
    if (currentFailure) {
        return {
            kind: "failed",
            levelIndex: currentLevelIndex,
            failure: currentFailure,
            pastFailures,
            levelFailures,
            renderedLevels,
            consoleOutput,
        };
    }
    if (pastFailures.length > 0) {
        return {
            kind: "past-failures",
            levelIndex: currentLevelIndex,
            pastFailures,
            levelFailures,
            renderedLevels,
            consoleOutput,
        };
    }

    const laterUnlockedFailure = levelFailures
        .slice(currentLevelIndex + 1, highestLevelIndex + 1)
        .find((failure): failure is LevelFailure => failure !== undefined);
    if (laterUnlockedFailure) {
        return {
            kind: "failed",
            levelIndex: laterUnlockedFailure.levelIndex,
            failure: laterUnlockedFailure,
            pastFailures,
            levelFailures,
            renderedLevels,
            consoleOutput,
        };
    }

    for (let levelIndex = highestLevelIndex + 1; levelIndex < levels.length; levelIndex++) {
        const failure = levelFailures[levelIndex];
        if (failure) {
            return {
                kind: "failed",
                levelIndex,
                failure,
                pastFailures,
                levelFailures,
                renderedLevels,
                consoleOutput,
            };
        }

        if (!executedLevels[levelIndex]) {
            throw new Error(`Missing execution result for level ${levelIndex + 1}.`);
        }
    }

    return {
        kind: "complete",
        levelIndex: Math.max(0, levels.length - 1),
        pastFailures,
        levelFailures,
        renderedLevels,
        consoleOutput,
    };
}

export function serializeState(state: GameState): string {
    return JSON.stringify({version: STORAGE_VERSION, ...state});
}

export function parseState(serialized: string | null, levelCount: number): GameState {
    if (serialized === null) return defaultState();

    try {
        const value: unknown = JSON.parse(serialized);
        if (typeof value !== "object" || value === null) return defaultState();

        const saved = value as Record<string, unknown>;
        if (
            saved.version !== STORAGE_VERSION
            || !Number.isInteger(saved.levelIndex)
            || typeof saved.levelIndex !== "number"
            || saved.levelIndex < 0
            || saved.levelIndex >= levelCount
            || typeof saved.railWidth !== "number"
            || !Number.isFinite(saved.railWidth)
        ) return defaultState();

        const highestLevelIndex = saved.highestLevelIndex;
        if (
            typeof highestLevelIndex !== "number"
            || !Number.isInteger(highestLevelIndex)
            || highestLevelIndex < saved.levelIndex
            || highestLevelIndex >= levelCount
        ) return defaultState();

        return {
            levelIndex: saved.levelIndex,
            highestLevelIndex,
            railWidth: saved.railWidth,
            previewRenderMode: saved.previewRenderMode === "json" ? "json" : "player",
        };
    } catch {
        return defaultState();
    }
}
