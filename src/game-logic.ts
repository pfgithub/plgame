import type { Level, Token } from "./levels.ts";

export const DEFAULT_CODE = `function execute(tokens) {
    return tokens;
}`;

export type TokenNames = Record<string, string>;

export type GameState = {
    code: string,
    tokenNames: TokenNames,
    levelIndex: number,
};

export type ProgressionResult
    = | {kind: "blocked", levelIndex: number}
        | {kind: "failed", levelIndex: number, expected: string[], actual?: string[], error?: Error}
        | {kind: "complete", levelIndex: number};

type Runner = (code: string, input: string[]) => Promise<string[]>;

const STORAGE_VERSION = 1;

export function defaultState(): GameState {
    return {
        code: DEFAULT_CODE,
        tokenNames: {},
        levelIndex: 0,
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
    runner: Runner,
): Promise<ProgressionResult> {
    for (const [levelIndex, level] of levels.entries()) {
        if (!isLevelNamed(level, tokenNames)) return {kind: "blocked", levelIndex};

        const input = tokensToNames(level.input, tokenNames);
        const expected = tokensToNames(level.output, tokenNames);
        try {
            const actual = await runner(code, input);
            if (!arraysEqual(actual, expected)) {
                return {kind: "failed", levelIndex, expected, actual};
            }
        } catch (error) {
            return {
                kind: "failed",
                levelIndex,
                expected,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    return {kind: "complete", levelIndex: Math.max(0, levels.length - 1)};
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

        return {
            code: saved.code,
            tokenNames: Object.fromEntries(entries) as TokenNames,
            levelIndex: saved.levelIndex,
        };
    } catch {
        return defaultState();
    }
}
