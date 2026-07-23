import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
    entrypoints: ["./src/index.html"],
    outdir: "./dist",
    minify: true,
    publicPath: "./",
    plugins: [tailwind],
});

if (!result.success) {
    throw new AggregateError(result.logs, "Build failed");
}
