import {
  mkdir,
  copyFile,
  cp,
  rm,
  readdir,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
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
// Derive the complete offline release from copied public files. URLs stay
// relative so the same build works at / and a GitHub Pages project subpath.
const entries = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile()) {
      const path = relative(output, file).replaceAll("\\", "/");
      if (path === "service-worker.js") continue;
      const bytes = await readFile(file);
      entries.push({
        url: "./" + path.split("/").map(encodeURIComponent).join("/"),
        integrity:
          "sha256-" + createHash("sha256").update(bytes).digest("base64"),
      });
    } else throw new Error("Unsupported offline asset: " + file);
  }
}
await collect(output);
entries.sort((a, b) => a.url.localeCompare(b.url, "en"));
const template = await readFile("public/service-worker.js", "utf8");
if (
  !template.includes('"__YANGATLAS_BUILD_VERSION__"') ||
  !template.includes("/* YANGATLAS_PRECACHE */ []")
)
  throw new Error("Missing offline build placeholders");
const release = createHash("sha256")
  .update(template)
  .update(JSON.stringify(entries))
  .digest("hex")
  .slice(0, 24);
await writeFile(
  "dist/service-worker.js",
  template
    .replace('"__YANGATLAS_BUILD_VERSION__"', JSON.stringify(release))
    .replace("/* YANGATLAS_PRECACHE */ []", JSON.stringify(entries, null, 2)),
);
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
  `Built ${count} static files (${(bytes / 1024).toFixed(1)} KiB). Offline release ${release}: ${entries.length} integrity-checked resources. No runtime dependencies.`,
);
