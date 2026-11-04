import { mkdir, copyFile, cp, rm, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
const root = resolve("."),
  output = resolve("dist");
if (relative(root, output) !== "dist")
  throw new Error("Unexpected output directory");
await rm(output, { recursive: true, force: true });
await mkdir(output);
await copyFile("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });
await cp("LICENSES", "dist/LICENSES", { recursive: true });
await mkdir("dist/docs", { recursive: true });
await copyFile("docs/MEDIA.md", "dist/docs/MEDIA.md");
await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
await copyFile("LICENSE", "dist/LICENSE");
let bytes = 0,
  count = 0;
async function measure(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = path + "/" + entry.name;
    if (entry.isDirectory()) await measure(file);
    else {
      bytes += (await stat(file)).size;
      count++;
    }
  }
}
await measure(output);
console.log(
  `Built ${count} static files (${(bytes / 1024).toFixed(1)} KiB). No runtime dependencies.`,
);
