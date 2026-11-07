export * from "./types.js";
export * from "./fixtures.js";
export * from "./adapter.js";
export * from "./server.js";

// Optional CLI runner if started directly with node
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  import("./server.js").then(({ createAppServer }) => {
    const port = Number(process.env.PORT) || 8787;
    createAppServer({ port }).then(({ port }) => {
      console.log(`Recourse Control Center UI & API running at http://localhost:${port}`);
    });
  });
}

