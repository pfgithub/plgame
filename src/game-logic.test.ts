import { describe, expect, test } from "bun:test";
import {
    DEFAULT_CODE,
    arraysEqual,
    defaultState,
    namesToTokens,
    parseState,
    runProgression,
    serializeState,
    tokensToNames,
    validateTokenName,
} from "./game-logic.ts";
import type { Level, Token } from "./levels.ts";

const token = (value: string): Token => value as Token;
const level = (input: string[], output: string[]): Level => ({
    raw: input.join(" "),
    input: input.map(token),
    output: output.map(token),
});

describe("token names", () => {
    test("translate in both directions", () => {
        const names = {a: "first", b: "second"};
        expect(tokensToNames([token("a"), token("b")], names)).toEqual(["first", "second"]);
        expect(namesToTokens(["second", "first"], names)).toEqual([token("b"), token("a")]);
        expect(namesToTokens(["missing"], names)).toBeUndefined();
    });

    test("names must be nonempty and unique", () => {
        const names = {a: "one"};
        expect(validateTokenName(names, token("b"), " ")).toContain("empty");
        expect(validateTokenName(names, token("b"), "one")).toContain("already in use");
        expect(validateTokenName(names, token("a"), "one")).toBeUndefined();
        expect(validateTokenName(names, token("b"), "two")).toBeUndefined();
    });

    test("array comparison is exact and ordered", () => {
        expect(arraysEqual(["a", "b"], ["a", "b"])).toBeTrue();
        expect(arraysEqual(["a", "b"], ["b", "a"])).toBeFalse();
        expect(arraysEqual(["a"], ["a", "b"])).toBeFalse();
    });
});

describe("progression", () => {
    const sampleLevels = [
        level(["a"], ["a"]),
        level(["a", "a"], ["a", "a"]),
        level(["b"], ["b"]),
    ];

    test("stops at a future level with an unnamed token", async () => {
        const result = await runProgression("code", {a: "same"}, sampleLevels, 0, async (_code, input) => input);
        expect(result).toEqual({kind: "blocked", levelIndex: 2, pastFailures: []});
    });

    test("reports earlier failures without leaving the current level", async () => {
        let calls = 0;
        const result = await runProgression("code", {a: "same", b: "other"}, sampleLevels, 2, async (_code, input) => {
            calls++;
            return calls === 2 ? [] : input;
        });
        expect(result).toEqual({
            kind: "past-failures",
            levelIndex: 2,
            pastFailures: [{levelIndex: 1, expected: ["same", "same"], actual: []}],
        });
        expect(calls).toBe(3);
    });

    test("keeps the current level selected when it fails", async () => {
        let calls = 0;
        const result = await runProgression("code", {a: "same", b: "other"}, sampleLevels, 1, async (_code, input) => {
            calls++;
            return calls === 2 ? [] : input;
        });
        expect(result).toEqual({
            kind: "failed",
            levelIndex: 1,
            failure: {levelIndex: 1, expected: ["same", "same"], actual: []},
            pastFailures: [],
        });
    });

    test("continues into named future levels and reports completion", async () => {
        const result = await runProgression("code", {a: "same", b: "other"}, sampleLevels, 0, async (_code, input) => input);
        expect(result).toEqual({kind: "complete", levelIndex: 2, pastFailures: []});
    });

    test("reports runner errors at their level", async () => {
        const failure = new Error("boom");
        const result = await runProgression("code", {a: "same", b: "other"}, sampleLevels, 0, async () => {
            throw failure;
        });
        expect(result).toEqual({
            kind: "failed",
            levelIndex: 0,
            failure: {levelIndex: 0, expected: ["same"], error: failure},
            pastFailures: [],
        });
    });
});

describe("saved state", () => {
    test("round-trips valid state", () => {
        const state = {code: "hello", tokenNames: {a: "one"}, levelIndex: 1, highestLevelIndex: 2};
        expect(parseState(serializeState(state), 3)).toEqual(state);
    });

    test("migrates version 1 state with its current level discovered", () => {
        expect(parseState(JSON.stringify({
            version: 1,
            code: "hello",
            tokenNames: {a: "one"},
            levelIndex: 2,
        }), 3)).toEqual({
            code: "hello",
            tokenNames: {a: "one"},
            levelIndex: 2,
            highestLevelIndex: 2,
        });
    });

    test("malformed and version-mismatched state uses defaults", () => {
        expect(parseState("not json", 3)).toEqual(defaultState());
        expect(parseState(JSON.stringify({version: 3}), 3)).toEqual(defaultState());
        expect(parseState(JSON.stringify({
            version: 1,
            code: "x",
            tokenNames: {a: "same", b: "same"},
            levelIndex: 0,
        }), 3)).toEqual(defaultState());
        expect(defaultState().code).toBe(DEFAULT_CODE);
    });
});
