import type { Level, Token } from "./levels.ts";
import type { CodeExecutionResult } from "./executor.ts";

export const DEFAULT_CODE = `function execute(tokens) {
    return tokens;
}`;

export type GameState = {
    code: string,
    levelIndex: number,
    highestLevelIndex: number,
};

export type LevelFailure = {
    levelIndex: number,
    expected: number[],
    actual?: number[],
    error?: Error,
};

export type ProgressionResult =
    | {kind: "past-failures", levelIndex: number, pastFailures: LevelFailure[]}
    | {kind: "failed", levelIndex: number, failure: LevelFailure, pastFailures: LevelFailure[]}
    | {kind: "complete", levelIndex: number, pastFailures: LevelFailure[]};

type Runner = (code: string, inputs: number[][]) => Promise<CodeExecutionResult[]>;

const STORAGE_VERSION = 3;

export function defaultState(): GameState {
    return {
        code: DEFAULT_CODE,
        levelIndex: 0,
        highestLevelIndex: 0,
    };
}

export function arraysEqual(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function runProgression(
    code: string,
    levels: Level[],
    currentLevelIndex: number,
    runner: Runner,
): Promise<ProgressionResult> {
    const runnableLevels: Array<{levelIndex: number, input: Token[], expected: Token[]}> = [];
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
        const level = levels[levelIndex];
        if (!level) throw new Error(`Missing level ${levelIndex + 1}.`);
        runnableLevels.push({
            levelIndex,
            input: level.input,
            expected: level.output,
        });
    }

    let executions: CodeExecutionResult[];
    try {
        executions = runnableLevels.length === 0
            ? []
            : await runner(code, runnableLevels.map(level => level.input));
    } catch (error) {
        const executionError = error instanceof Error ? error : new Error(String(error));
        executions = runnableLevels.map(() => ({ok: false, error: executionError}));
    }
    if (executions.length !== runnableLevels.length) {
        throw new Error("The code runner returned an unexpected number of results.");
    }

    const failures = runnableLevels.map((level, index): LevelFailure | undefined => {
        const execution = executions[index];
        if (!execution) throw new Error(`Missing execution result for level ${level.levelIndex + 1}.`);
        if (!execution.ok) {
            return {levelIndex: level.levelIndex, expected: level.expected, error: execution.error};
        }
        if (!arraysEqual(execution.result, level.expected)) {
            return {levelIndex: level.levelIndex, expected: level.expected, actual: execution.result};
        }
        return undefined;
    });

    const pastFailures: LevelFailure[] = [];
    let currentFailure: LevelFailure | undefined;
    for (let levelIndex = 0; levelIndex <= currentLevelIndex; levelIndex++) {
        const failure = failures[levelIndex];
        if (failure && levelIndex < currentLevelIndex) pastFailures.push(failure);
        if (failure && levelIndex === currentLevelIndex) currentFailure = failure;
    }

    if (currentFailure) {
        return {kind: "failed", levelIndex: currentLevelIndex, failure: currentFailure, pastFailures};
    }
    if (pastFailures.length > 0) {
        return {kind: "past-failures", levelIndex: currentLevelIndex, pastFailures};
    }

    for (let levelIndex = currentLevelIndex + 1; levelIndex < levels.length; levelIndex++) {
        const failure = failures[levelIndex];
        if (failure) return {kind: "failed", levelIndex, failure, pastFailures};
    }

    return {kind: "complete", levelIndex: Math.max(0, levels.length - 1), pastFailures};
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
            (saved.version !== 1 && saved.version !== 2 && saved.version !== STORAGE_VERSION)
            || typeof saved.code !== "string"
            || !Number.isInteger(saved.levelIndex)
            || typeof saved.levelIndex !== "number"
            || saved.levelIndex < 0
            || saved.levelIndex >= levelCount
        ) return defaultState();

        const highestLevelIndex = saved.version === 1
            ? saved.levelIndex
            : saved.highestLevelIndex;
        if (
            typeof highestLevelIndex !== "number"
            || !Number.isInteger(highestLevelIndex)
            || highestLevelIndex < saved.levelIndex
            || highestLevelIndex >= levelCount
        ) return defaultState();

        return {
            code: saved.code,
            levelIndex: saved.levelIndex,
            highestLevelIndex,
        };
    } catch {
        return defaultState();
    }
}
