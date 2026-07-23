import DiffMatchPatch from "diff-match-patch";

const diffEngine = new DiffMatchPatch();

export function renderDiff(document: Document, expected: string, actual: string): HTMLPreElement {
    const code = document.createElement("code");
    let hasLines = false;

    const appendLine = (
        prefix: " " | "-" | "+",
        text: string,
        comparison?: string,
    ): void => {
        if (hasLines) code.append("\n");
        hasLines = true;

        const line = document.createElement("span");
        line.className = [
            "diff-line",
            prefix === "-" ? "diff-line-expected" : "",
            prefix === "+" ? "diff-line-actual" : "",
        ].filter(Boolean).join(" ");
        line.append(prefix);

        if (comparison === undefined) {
            const part = document.createElement("span");
            part.textContent = text;
            line.append(part);
        } else {
            const changes = prefix === "-"
                ? diffEngine.diff_main(text, comparison)
                : diffEngine.diff_main(comparison, text);
            diffEngine.diff_cleanupSemantic(changes);
            for (const [operation, partText] of changes) {
                if (
                    (prefix === "-" && operation === DiffMatchPatch.DIFF_INSERT)
                    || (prefix === "+" && operation === DiffMatchPatch.DIFF_DELETE)
                ) {
                    continue;
                }
                const part = document.createElement(
                    operation === DiffMatchPatch.DIFF_DELETE
                        ? "del"
                        : operation === DiffMatchPatch.DIFF_INSERT
                            ? "ins"
                            : "span",
                );
                part.textContent = partText;
                line.append(part);
            }
        }
        code.append(line);
    };

    const encoded = diffEngine.diff_linesToChars_(expected, actual);
    const changes = diffEngine.diff_main(encoded.chars1, encoded.chars2, false);
    const lines = (encodedText: string): string[] => Array.from(
        encodedText,
        character => encoded.lineArray[character.charCodeAt(0)]!.replace(/\n$/, ""),
    );

    for (let index = 0; index < changes.length; index++) {
        const change = changes[index];
        if (change === undefined) break;
        const [operation, encodedText] = change;
        const changedLines = lines(encodedText);

        if (operation === DiffMatchPatch.DIFF_EQUAL) {
            for (const line of changedLines) appendLine(" ", line);
            continue;
        }

        const nextChange = changes[index + 1];
        if (operation === DiffMatchPatch.DIFF_DELETE
            && nextChange?.[0] === DiffMatchPatch.DIFF_INSERT) {
            const insertedLines = lines(nextChange[1]);
            for (let lineIndex = 0; lineIndex < changedLines.length; lineIndex++) {
                appendLine("-", changedLines[lineIndex]!, insertedLines[lineIndex]);
            }
            for (let lineIndex = 0; lineIndex < insertedLines.length; lineIndex++) {
                appendLine("+", insertedLines[lineIndex]!, changedLines[lineIndex]);
            }
            index++;
            continue;
        }

        const prefix = operation === DiffMatchPatch.DIFF_DELETE ? "-" : "+";
        for (const line of changedLines) appendLine(prefix, line);
    }

    const pre = document.createElement("pre");
    pre.append(code);
    return pre;
}
