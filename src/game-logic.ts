import type { Level, Token } from "./levels.ts";

export const DEFAULT_CODE = `function execute(tokens) {
    return tokens;
}`;

export type TokenNames = Record<string, string>;

export type GameState = {
    code: string,
    tokenNames: TokenNames,
    levelIndex: number,
    highestLevelIndex: number,
};

export type LevelFailure = {
    levelIndex: number,
    expected: string[],
    actual?: string[],
    error?: Error,
};

export type ProgressionResult
    = | {kind: "blocked", levelIndex: number, pastFailures: LevelFailure[]}
        | {kind: "past-failures", levelIndex: number, pastFailures: LevelFailure[]}
        | {kind: "failed", levelIndex: number, failure: LevelFailure, pastFailures: LevelFailure[]}
        | {kind: "complete", levelIndex: number, pastFailures: LevelFailure[]};

type Runner = (code: string, input: string[]) => Promise<string[]>;

const STORAGE_VERSION = 2;

export function defaultState(): GameState {
    return {
        code: DEFAULT_CODE,
        tokenNames: {},
        levelIndex: 0,
        highestLevelIndex: 0,
    };
}

export function levelTokens(level: Level): Token[] {
    return [...new Set([...level.input, ...level.output])];
}

export function isLevelNamed(level: Level, tokenNames: TokenNames): boolean {
    return levelTokens(level).every(token => tokenNames[token] !== undefined);
}

export function validateTokenName(
    tokenNames: TokenNames,
    token: Token,
    proposedName: string,
): string | undefined {
    const name = proposedName.trim();
    if (name === "") return "A token name cannot be empty.";

    const duplicate = Object.entries(tokenNames).find(
        ([otherToken, otherName]) => otherToken !== token && otherName === name,
    );
    if (duplicate) return `The name "${name}" is already in use.`;

    return undefined;
}

export function tokensToNames(tokens: Token[], tokenNames: TokenNames): string[] {
    return tokens.map((token) => {
        const name = tokenNames[token];
        if (name === undefined) throw new Error(`Token "${token}" is unnamed.`);
        return name;
    });
}

export function namesToTokens(names: string[], tokenNames: TokenNames): Token[] | undefined {
    const reverseNames = new Map(
        Object.entries(tokenNames).map(([token, name]) => [name, token as Token]),
    );
    const tokens: Token[] = [];
    for (const name of names) {
        const token = reverseNames.get(name);
        if (token === undefined) return undefined;
        tokens.push(token);
    }
    return tokens;
}

export function arraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function runProgression(
    code: string,
    tokenNames: TokenNames,
    levels: Level[],
    currentLevelIndex: number,
    runner: Runner,
): Promise<ProgressionResult> {
    const runLevel = async (levelIndex: number): Promise<LevelFailure | undefined> => {
        const level = levels[levelIndex];
        if (!level) throw new Error(`Missing level ${levelIndex + 1}.`);
        const input = tokensToNames(level.input, tokenNames);
        const expected = tokensToNames(level.output, tokenNames);
        try {
            const actual = await runner(code, input);
            if (!arraysEqual(actual, expected)) {
                return {levelIndex, expected, actual};
            }
        } catch (error) {
            return {
                levelIndex,
                expected,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
        return undefined;
    };

    const pastFailures: LevelFailure[] = [];
    let currentFailure: LevelFailure | undefined;
    for (let levelIndex = 0; levelIndex <= currentLevelIndex; levelIndex++) {
        const level = levels[levelIndex];
        if (!level || !isLevelNamed(level, tokenNames)) {
            return {kind: "blocked", levelIndex, pastFailures};
        }
        const failure = await runLevel(levelIndex);
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
        const level = levels[levelIndex];
        if (!level || !isLevelNamed(level, tokenNames)) {
            return {kind: "blocked", levelIndex, pastFailures};
        }
        const failure = await runLevel(levelIndex);
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
            (saved.version !== 1 && saved.version !== STORAGE_VERSION)
            || typeof saved.code !== "string"
            || !Number.isInteger(saved.levelIndex)
            || typeof saved.levelIndex !== "number"
            || saved.levelIndex < 0
            || saved.levelIndex >= levelCount
            || typeof saved.tokenNames !== "object"
            || saved.tokenNames === null
            || Array.isArray(saved.tokenNames)
        ) return defaultState();

        const entries = Object.entries(saved.tokenNames);
        if (entries.some(([, name]) => typeof name !== "string" || name.trim() === "")) {
            return defaultState();
        }
        const names = entries.map(([, name]) => name);
        if (new Set(names).size !== names.length) return defaultState();

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
            tokenNames: Object.fromEntries(entries) as TokenNames,
            levelIndex: saved.levelIndex,
            highestLevelIndex,
        };
    } catch {
        return defaultState();
    }
}
