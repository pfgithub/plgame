export type CodeExecutionResult =
    | {ok: true, result: number[], renderedResult?: string}
    | {ok: false, error: Error};

export type CodeRunResult = {
    executions: CodeExecutionResult[],
    renderings: string[],
};

export function runCode(
    code: string,
    inputs: number[][],
    valuesToRender: number[][] = [],
): Promise<CodeRunResult> {
    const EXECUTION_TIMEOUT_MS = 1_000;
    const SETUP_TIMEOUT_MS = 2_000;

    return new Promise<CodeRunResult>((resolve, reject) => {
        const iframe = document.createElement("iframe");
        const channel = new MessageChannel();

        let settled = false;
        let setupTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = (): void => {
            if (setupTimer !== undefined) {
                clearTimeout(setupTimer);
                setupTimer = undefined;
            }

            channel.port1.close();
            iframe.remove();
        };

        const succeed = (result: CodeRunResult): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const fail = (error: unknown): void => {
            if (settled) return;
            settled = true;
            cleanup();

            reject(error instanceof Error ? error : new Error(String(error)));
        };

        /*
     * This function is serialized into the iframe. The iframe itself never
     * evaluates the submitted code; it delegates execution to a Web Worker.
     */
        function iframeBootstrap(): void {
            type RunRequest = {
                type: "run",
                code: string,
                inputs: number[][],
                valuesToRender: number[][],
                timeoutMs: number,
            };

            type SerializedError = {
                name: string,
                message: string,
                stack?: string,
            };

            type WorkerResponse =
                | {
                    ok: true,
                    renderings: string[],
                    results: Array<
                        | {ok: true, result: number[], renderedResult: string}
                        | {ok: false, error: SerializedError}
                    >,
                }
                | {
                    ok: false,
                    error: SerializedError,
                };

            function workerMain(): void {
                const serializeError = (error: unknown): SerializedError => {
                    if (error instanceof Error) {
                        return {
                            name: error.name,
                            message: error.message,
                            stack: error.stack,
                        };
                    }

                    return {
                        name: "Error",
                        message: String(error),
                    };
                };

                self.addEventListener("message", async (event) => {
                    const {code, inputs, valuesToRender} = event.data as {
                        code: string,
                        inputs: number[][],
                        valuesToRender: number[][],
                    };

                    try {
                        /*
             * Returning both functions keeps them inside the generated
             * function's scope, however they were declared.
             *
             *   function execute(input) {}
             *   const execute = input => {}
             */
                        const createFunctions = new Function(
                            `"use strict";

${code}

if (typeof execute !== "function") {
  throw new Error(
    "The submitted code must define a function named execute(input)."
  );
}

if (typeof render !== "function") {
  throw new Error(
    "The submitted code must define a function named render(tokens)."
  );
}

return {execute, render};
`,
                        ) as () => {
                            execute: (input: number[]) => unknown,
                            render: (tokens: number[]) => unknown,
                        };

                        const {execute, render} = createFunctions();
                        const renderTokens = async (tokens: number[]): Promise<string> => {
                            const rendered = await render([...tokens]);
                            if (typeof rendered !== "string") {
                                throw new TypeError(
                                    "render(tokens) must return a string or a Promise<string>.",
                                );
                            }
                            return rendered;
                        };
                        const renderings: string[] = [];
                        for (const value of valuesToRender) {
                            renderings.push(await renderTokens(value));
                        }
                        const results: Array<
                            | {ok: true, result: number[], renderedResult: string}
                            | {ok: false, error: SerializedError}
                        > = [];

                        for (const input of inputs) {
                            try {
                                const result = await execute(input);

                                if (!Array.isArray(result)) {
                                    throw new TypeError(
                                        "execute(input) must return a number array or a Promise<number[]>.",
                                    );
                                }

                                if (!result.every(value => typeof value === "number")) {
                                    throw new TypeError(
                                        "Every value returned by execute(input) must be a number.",
                                    );
                                }

                                results.push({
                                    ok: true,
                                    result,
                                    renderedResult: await renderTokens(result),
                                });
                            } catch (error) {
                                results.push({ok: false, error: serializeError(error)});
                            }
                        }

                        const response: WorkerResponse = {
                            ok: true,
                            renderings,
                            results,
                        };

                        self.postMessage(response);
                    } catch (error) {
                        const response: WorkerResponse = {
                            ok: false,
                            error: serializeError(error),
                        };

                        self.postMessage(response);
                    }
                });
            }

            window.addEventListener(
                "message",
                (event) => {
                    const request = event.data as RunRequest;
                    const port = event.ports[0];

                    if (request?.type !== "run" || !port) {
                        return;
                    }

                    const workerSource = `(${workerMain.toString()})();`;
                    const workerBlob = new Blob([workerSource], {
                        type: "text/javascript",
                    });
                    const workerUrl = URL.createObjectURL(workerBlob);
                    const worker = new Worker(workerUrl);

                    let finished = false;

                    const finish = (response: WorkerResponse): void => {
                        if (finished) return;
                        finished = true;

                        clearTimeout(timeout);
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);

                        port.postMessage(response);
                        port.close();
                    };

                    const timeout = window.setTimeout(() => {
                        finish({
                            ok: false,
                            error: {
                                name: "TimeoutError",
                                message: `Execution exceeded ${request.timeoutMs} ms.`,
                            },
                        });
                    }, request.timeoutMs);

                    worker.addEventListener("message", (workerEvent) => {
                        finish(workerEvent.data as WorkerResponse);
                    });

                    worker.addEventListener("error", (workerError) => {
                        workerError.preventDefault();

                        finish({
                            ok: false,
                            error: {
                                name: "WorkerError",
                                message: workerError.message || "The worker crashed.",
                            },
                        });
                    });

                    worker.addEventListener("messageerror", () => {
                        finish({
                            ok: false,
                            error: {
                                name: "DataCloneError",
                                message: "The worker returned a value that could not be cloned.",
                            },
                        });
                    });

                    worker.postMessage({
                        code: request.code,
                        inputs: request.inputs,
                        valuesToRender: request.valuesToRender,
                    });
                },
                {once: true},
            );

            parent.postMessage({type: "runner-ready"}, "*");
        }

        iframe.hidden = true;
        iframe.setAttribute("aria-hidden", "true");

        // No allow-same-origin: the iframe receives an opaque origin.
        iframe.setAttribute("sandbox", "allow-scripts");

        iframe.srcdoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
  </head>
  <body>
    <script>
      (${iframeBootstrap.toString()})();
    </script>
  </body>
</html>`;

        const handleReady = (event: MessageEvent): void => {
            if (event.source !== iframe.contentWindow) return;
            if (event.data?.type !== "runner-ready") return;
            if (settled) return;

            window.removeEventListener("message", handleReady);

            iframe.contentWindow?.postMessage(
                {
                    type: "run",
                    code,
                    inputs,
                    valuesToRender,
                    timeoutMs: EXECUTION_TIMEOUT_MS,
                },
                "*",
                [channel.port2],
            );
        };

        window.addEventListener("message", handleReady);

        channel.port1.onmessage = (event) => {
            const response = event.data as
                | {
                    ok: true,
                    renderings: string[],
                    results: Array<
                        | {ok: true, result: number[], renderedResult: string}
                        | {
                            ok: false,
                            error: {
                                name?: string,
                                message?: string,
                                stack?: string,
                            },
                        }
                    >,
                }
                | {
                    ok: false,
                    error: {
                        name?: string,
                        message?: string,
                        stack?: string,
                    },
                };

            if (response?.ok === true) {
                succeed({
                    executions: response.results.map((execution) => {
                        if (execution.ok) return execution;

                        const error = new Error(execution.error.message ?? "Code execution failed.");
                        error.name = execution.error.name ?? "ExecutionError";
                        if (execution.error.stack) error.stack = execution.error.stack;
                        return {ok: false, error};
                    }),
                    renderings: response.renderings,
                });
                return;
            }

            const remoteError = response?.error;
            const error = new Error(
                remoteError?.message ?? "Code execution failed.",
            );

            error.name = remoteError?.name ?? "ExecutionError";

            if (remoteError?.stack) {
                error.stack = remoteError.stack;
            }

            fail(error);
        };

        channel.port1.onmessageerror = () => {
            fail(new Error("Could not deserialize the execution result."));
        };

        channel.port1.start();

        setupTimer = setTimeout(() => {
            window.removeEventListener("message", handleReady);
            fail(new Error("The isolated runner failed to initialize."));
        }, SETUP_TIMEOUT_MS);

        document.body.appendChild(iframe);
    });
}
