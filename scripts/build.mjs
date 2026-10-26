// Builds everything into dist/:
//   dist/index.html    game page with online play (served by the match server)
//   dist/artifact.html practice-only page without the document wrapper (static hosting / preview)
//   dist/server.js     the match server (node dist/server.js)
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const template = readFileSync("src/client/index.html", "utf8");

async function bundleClient(online) {
  const out = await build({
    entryPoints: ["src/client/main.ts"],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    write: false,
    define: { __ONLINE__: String(online) },
    loader: { ".webp": "dataurl" },
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  return template.replace("/*BUNDLE*/", () => js);
}

mkdirSync("dist", { recursive: true });
const online = await bundleClient(true);
writeFileSync(
  "dist/index.html",
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n</head>\n<body>\n${online}\n</body>\n</html>\n`,
);
writeFileSync("dist/artifact.html", await bundleClient(false));

await build({
  entryPoints: ["src/server/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  outfile: "dist/server.js",
});
console.log("built dist/index.html, dist/artifact.html, dist/server.js");
