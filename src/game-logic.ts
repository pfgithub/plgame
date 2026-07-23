import type { Level, Token } from "./levels.ts";
import type { CodeExecutionResult } from "./executor.ts";

export const DEFAULT_CODE = `function render(tokens) {
    return tokens.join(" ");
}

function execute(tokens) {
    return tokens;
}`;

export type GameState = {
    levelIndex: number,
    highestLevelIndex: number,
    railWidth: number,
};

export type LevelFailure = {
    levelIndex: number,
    expected: number[],
    renderedExpected?: string,
    actual?: number[],
    renderedActual?: string,
    error?: Error,
};

export type RenderedLevel = {
    input: string,
    expected: string,
    executionTimeMs?: number,
};

export type ProgressionResult =
    | {kind: "past-failures", levelIndex: number, pastFailures: LevelFailure[], levelFailures: Array<LevelFailure | undefined>, renderedLevels: RenderedLevel[]}
    | {kind: "failed", levelIndex: number, failure: LevelFailure, pastFailures: LevelFailure[], levelFailures: Array<LevelFailure | undefined>, renderedLevels: RenderedLevel[]}
    | {kind: "complete", levelIndex: number, pastFailures: LevelFailure[], levelFailures: Array<LevelFailure | undefined>, renderedLevels: RenderedLevel[]};

type Runner = (
    code: string,
    inputs: number[][],
    valuesToRender: number[][],
) => Promise<CodeExecutionResult[] | {executions: CodeExecutionResult[], renderings: string[]}>;

const STORAGE_VERSION = 5;
const DEFAULT_RAIL_WIDTH = 416;

export function defaultState(): GameState {
    return {
        levelIndex: 0,
        highestLevelIndex: 0,
        railWidth: DEFAULT_RAIL_WIDTH,
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
    const renderedLevels: RenderedLevel[] = runnableLevels.map(level => ({
        input: level.input.join(" "),
        expected: level.expected.join(" "),
    }));
    const levelFailures: Array<LevelFailure | undefined> = Array.from({
        length: levels.length,
    });

    async function runLevels(
        levelsToRun: Array<{levelIndex: number, input: Token[], expected: Token[]}>,
    ): Promise<void> {
        let executions: CodeExecutionResult[];
        let renderings: string[];
        try {
            const run = await runner(
                code,
                levelsToRun.map(level => level.input),
                levelsToRun.flatMap(level => [level.input, level.expected]),
            );
            if (Array.isArray(run)) {
                executions = run;
                renderings = levelsToRun.flatMap(level => [
                    level.input.join(" "),
                    level.expected.join(" "),
                ]);
            } else {
                executions = run.executions;
                renderings = run.renderings;
            }
        } catch (error) {
            const executionError = error instanceof Error ? error : new Error(String(error));
            executions = levelsToRun.map(() => ({ok: false, error: executionError}));
            renderings = levelsToRun.flatMap(level => [
                level.input.join(" "),
                level.expected.join(" "),
            ]);
        }
        if (executions.length !== levelsToRun.length) {
            throw new Error("The code runner returned an unexpected number of results.");
        }
        if (renderings.length !== levelsToRun.length * 2) {
            throw new Error("The code runner returned an unexpected number of renderings.");
        }

        levelsToRun.forEach((level, index) => {
            const execution = executions[index];
            if (!execution) {
                throw new Error(`Missing execution result for level ${level.levelIndex + 1}.`);
            }
            const executionTimeMs = execution.executionTimeMs;
            const renderedLevel: RenderedLevel = {
                input: renderings[index * 2] ?? level.input.join(" "),
                expected: renderings[index * 2 + 1] ?? level.expected.join(" "),
                ...(executionTimeMs === undefined ? {} : {executionTimeMs}),
            };
            renderedLevels[level.levelIndex] = renderedLevel;

            if (!execution.ok) {
                levelFailures[level.levelIndex] = {
                    levelIndex: level.levelIndex,
                    expected: level.expected,
                    renderedExpected: renderedLevel.expected,
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

    const unlockedLevels = runnableLevels.slice(0, highestLevelIndex + 1);
    if (unlockedLevels.length > 0) await runLevels(unlockedLevels);

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
        };
    }
    if (pastFailures.length > 0) {
        return {
            kind: "past-failures",
            levelIndex: currentLevelIndex,
            pastFailures,
            levelFailures,
            renderedLevels,
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
        };
    }

    for (let levelIndex = highestLevelIndex + 1; levelIndex < levels.length; levelIndex++) {
        const level = runnableLevels[levelIndex];
        if (!level) throw new Error(`Missing level ${levelIndex + 1}.`);
        await runLevels([{
            levelIndex,
            input: level.input,
            expected: level.expected,
        }]);
        const failure = levelFailures[levelIndex];
        if (failure) {
            return {
                kind: "failed",
                levelIndex,
                failure,
                pastFailures,
                levelFailures,
                renderedLevels,
            };
        }
    }

    return {
        kind: "complete",
        levelIndex: Math.max(0, levels.length - 1),
        pastFailures,
        levelFailures,
        renderedLevels,
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
        };
    } catch {
        return defaultState();
    }
}
