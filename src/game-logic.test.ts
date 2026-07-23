import { describe, expect, test } from "bun:test";
import { DEFAULT_CODE, parseState, runProgression } from "./game-logic.ts";
import type { Level, Token } from "./levels.ts";

describe("user rendering", () => {
    test("carries rendered level and failure output through progression", async () => {
        const levels: Level[] = [{raw: "1", input: [1 as Token], output: [2 as Token]}];
        const result = await runProgression("code", levels, 0, async (_code, _inputs, values) => ({
            executions: [{ok: true, result: [3], renderedResult: "<3>"}],
            renderings: values.map(tokens => `<${tokens.join(",")}>`),
        }));

        expect(result.renderedLevels).toEqual([{input: "<1>", expected: "<2>"}]);
        expect(result.kind).toBe("failed");
        if (result.kind !== "failed") throw new Error("Expected the level to fail.");
        expect(result.failure.renderedExpected).toBe("<2>");
        expect(result.failure.renderedActual).toBe("<3>");
    });

    test("adds the default renderer to older saved code", () => {
        const state = parseState(JSON.stringify({
            version: 3,
            code: "function execute(tokens) { return tokens; }",
            levelIndex: 0,
            highestLevelIndex: 0,
        }), 1);

        expect(state.code).toContain("function render(tokens)");
        expect(state.code).toContain("function execute(tokens)");
        expect(DEFAULT_CODE).toContain("return tokens.join(\" \");");
    });
});
