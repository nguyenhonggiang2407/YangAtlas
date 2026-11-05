import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
const root = resolve(
  process.env.ATLAS_SERVE_DIR ||
    (process.argv.includes("--dist") ? "dist" : "."),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      path = decodeURIComponent(url.pathname);
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    if (
      path.includes("\\") ||
      path.split("/").some((part) => part.startsWith("."))
    )
      throw new Error();
    let file = resolve(
      root,
      "." + (path.endsWith("/") ? path + "index.html" : path),
    );
    if (relative(root, file).startsWith("..")) throw new Error();
    try {
      if (!(await stat(file)).isFile()) throw new Error();
    } catch {
      file = resolve(root, "public", "." + path);
      if (
        relative(resolve(root, "public"), file).startsWith("..") ||
        !(await stat(file)).isFile()
      )
        throw new Error();
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
server.listen(Number(process.env.PORT || 4177), "127.0.0.1", () =>
  console.log(`Local: http://127.0.0.1:${server.address().port}/`),
);
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
