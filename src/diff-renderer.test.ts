import { describe, expect, test } from "bun:test";
import { renderDiff } from "./diff-renderer.ts";

class TestElement {
    readonly children: Array<TestElement | string> = [];
    className = "";
    textContent: string | null = null;

    constructor(readonly tagName: string) {}

    append(...children: Array<TestElement | string>): void {
        this.children.push(...children);
    }
}

const documentStub = {
    createElement: (tagName: string) => new TestElement(tagName),
} as unknown as Document;

interface ElementTree {
    tagName: string,
    className?: string,
    textContent?: string | null,
    children?: Array<ElementTree | string>,
}

function tree(element: TestElement): ElementTree {
    return {
        tagName: element.tagName,
        ...(element.className === "" ? {} : {className: element.className}),
        ...(element.textContent === null ? {} : {textContent: element.textContent}),
        ...(element.children.length === 0
            ? {}
            : {
                    children: element.children.map(child => (
                        typeof child === "string" ? child : tree(child)
                    )),
                }),
    };
}

describe("renderDiff", () => {
    test("renders expected and actual on separate lines", () => {
        const result = renderDiff(documentStub, "a f ! b c d e !", "b c d e ! m a f !");

        expect(tree(result as unknown as TestElement)).toEqual({
            tagName: "pre",
            children: [{
                tagName: "code",
                children: [
                    {
                        tagName: "span",
                        className: "diff-line diff-line-expected",
                        children: [
                            "-",
                            {tagName: "del", textContent: "a f ! "},
                            {tagName: "span", textContent: "b c d e !"},
                        ],
                    },
                    "\n",
                    {
                        tagName: "span",
                        className: "diff-line diff-line-actual",
                        children: [
                            "+",
                            {tagName: "span", textContent: "b c d e !"},
                            {tagName: "ins", textContent: " m a f !"},
                        ],
                    },
                ],
            }],
        });
    });

    test("renders entirely different values as a deletion and insertion", () => {
        const result = renderDiff(documentStub, "expected", "actual");
        const code = (result as unknown as TestElement).children[0] as TestElement;

        expect(code.children).toEqual([
            expect.objectContaining({
                className: "diff-line diff-line-expected",
                children: [
                    "-",
                    expect.objectContaining({tagName: "del", textContent: "expected"}),
                ],
            }),
            "\n",
            expect.objectContaining({
                className: "diff-line diff-line-actual",
                children: [
                    "+",
                    expect.objectContaining({tagName: "ins", textContent: "actual"}),
                ],
            }),
        ]);
    });
});
