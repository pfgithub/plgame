import app from "./index.html";

const server = Bun.serve({
    routes: {
        "/": app,
    },
    development: true,
});

console.log(`Hosting at ${server.url}`);
