import DiffMatchPatch from "diff-match-patch";

const diffEngine = new DiffMatchPatch();

export function renderDiff(document: Document, expected: string, actual: string): HTMLPreElement {
    const changes = diffEngine.diff_main(expected, actual);
    diffEngine.diff_cleanupSemantic(changes);

    const code = document.createElement("code");
    const expectedLine = document.createElement("span");
    expectedLine.className = "diff-line diff-line-expected";
    expectedLine.append("-");
    for (const [operation, text] of changes) {
        if (operation === DiffMatchPatch.DIFF_INSERT) continue;
        const part = document.createElement(
            operation === DiffMatchPatch.DIFF_DELETE ? "del" : "span",
        );
        part.textContent = text;
        expectedLine.append(part);
    }

    const actualLine = document.createElement("span");
    actualLine.className = "diff-line diff-line-actual";
    actualLine.append("+");
    for (const [operation, text] of changes) {
        if (operation === DiffMatchPatch.DIFF_DELETE) continue;
        const part = document.createElement(
            operation === DiffMatchPatch.DIFF_INSERT ? "ins" : "span",
        );
        part.textContent = text;
        actualLine.append(part);
    }
    code.append(expectedLine, "\n", actualLine);

    const pre = document.createElement("pre");
    pre.append(code);
    return pre;
}
