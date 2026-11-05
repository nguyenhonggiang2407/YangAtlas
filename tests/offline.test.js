import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const workerSource = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/offline.js", import.meta.url), "utf8");
const integrity = (value) => "sha256-" + createHash("sha256").update(value).digest("base64");

// An isolated Cache API/event harness exercises worker boundaries without real
// networking. Actual installation/offline navigation is also checked by E2E.
function workerHarness(path = "/YangAtlas/", { failure = false, template = false } = {}) {
  const base = "https://example.test" + path;
  const files = new Map([
    [new URL("index.html", base).href, "<main>YangAtlas</main>"],
    [new URL("src/app.js", base).href, "app-v1"],
    [new URL("media/photo.jpg", base).href, "photo-bytes"],
    [new URL("LICENSES/fonts/OFL.txt", base).href, "font-license"],
  ]);
  const entries = [...files].map(([url, body]) => ({ url: "./" + url.slice(base.length), integrity: integrity(body) }));
  const stores = new Map(), handlers = {}, requests = [];
  const counters = { claim: 0, skipWaiting: 0, network: 0 };
  const key = (value) => typeof value === "string" ? value : value.url;
  const cache = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async (items) => {
          const pending = [];
          for (const item of items) {
            requests.push(item);
            if (failure || !files.has(item.url)) throw new Error("offline install failed");
            const body = files.get(item.url);
            assert.equal(item.integrity, integrity(body));
            pending.push([item.url, new Response(body)]);
          }
          pending.forEach(([url, response]) => store.set(url, response));
        },
        match: async (request) => store.get(key(request))?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const self = {
    registration: { scope: base },
    clients: { claim: async () => { counters.claim++; } },
    skipWaiting: async () => { counters.skipWaiting++; },
    addEventListener: (type, listener) => { handlers[type] = listener; },
  };
  const source = template ? workerSource : workerSource
    .replace('"__YANGATLAS_BUILD_VERSION__"', '"test-release"')
    .replace("/* YANGATLAS_PRECACHE */ []", JSON.stringify(entries));
  vm.runInNewContext(source, {
    self, caches: cache, URL, Request, Set,
    fetch: async (request) => { counters.network++; if (!files.has(request.url)) throw new Error("network unavailable"); return new Response(files.get(request.url)); },
  });
  return {
    base, files, stores, requests, counters,
    async dispatch(type, values = {}) {
      const waits = [];
      let response;
      handlers[type]({ ...values, waitUntil: (promise) => waits.push(promise), respondWith: (promise) => { response = promise; } });
      await Promise.all(waits);
      return response;
    },
  };
}

test("worker caches the complete release and serves offline root/subpath entries and actual resources", async () => {
  for (const path of ["/", "/YangAtlas/"]) {
    const worker = workerHarness(path);
    await worker.dispatch("install");
    assert.equal(worker.requests.length, worker.files.size);
    assert.equal(worker.counters.skipWaiting, 0, "installation must wait for user acceptance");
    for (const request of worker.requests) {
      assert.equal(request.cache, "reload");
      assert.equal(request.redirect, "error");
      assert.equal(request.credentials, "same-origin");
    }
    const page = await worker.dispatch("fetch", { request: { method: "GET", mode: "navigate", url: worker.base + "?open=trip" } });
    assert.equal(await page.text(), "<main>YangAtlas</main>");
    for (const file of ["src/app.js", "media/photo.jpg", "LICENSES/fonts/OFL.txt"]) {
      const response = await worker.dispatch("fetch", { request: { method: "GET", url: new URL(file, worker.base).href } });
      assert.equal(await response.text(), worker.files.get(new URL(file, worker.base).href));
    }
    assert.equal(worker.counters.network, 0);
  }
});

test("worker ignores third parties, writes, other apps, unlisted URLs and missing-file navigations", async () => {
  const worker = workerHarness();
  await worker.dispatch("install");
  for (const request of [
    { method: "POST", url: worker.base + "index.html" },
    { method: "GET", url: "https://third-party.test/photo.jpg" },
    { method: "GET", url: "https://example.test/OtherApp/index.html" },
    { method: "GET", url: "https://example.test/YangAtlasOther/index.html" },
    { method: "GET", url: worker.base + "api/private-trips" },
    { method: "GET", mode: "navigate", url: worker.base + "missing.js" },
  ]) assert.equal(await worker.dispatch("fetch", { request }), undefined);
  assert.equal(worker.counters.network, 0);
});

test("failed/incomplete installation keeps the previous release; activation removes only this scope's old cache", async () => {
  const failed = workerHarness("/YangAtlas/", { failure: true });
  const prefix = "yangatlas-offline:%2FYangAtlas%2F:";
  failed.stores.set(prefix + "previous", new Map());
  await assert.rejects(failed.dispatch("install"), /offline install failed/);
  assert.deepEqual([...failed.stores.keys()], [prefix + "previous"]);
  await assert.rejects(workerHarness("/YangAtlas/", { template: true }).dispatch("install"), /generated build/);
  const worker = workerHarness();
  worker.stores.set(prefix + "previous", new Map());
  worker.stores.set("yangatlas-offline:%2F:other-app", new Map());
  worker.stores.set("unrelated-cache", new Map());
  await worker.dispatch("install");
  await worker.dispatch("activate");
  assert.equal(worker.stores.has(prefix + "previous"), false);
  assert.equal(worker.stores.has("yangatlas-offline:%2F:other-app"), true);
  assert.equal(worker.stores.has("unrelated-cache"), true);
  assert.equal(worker.counters.claim, 1);
});

test("only an explicit same-app update message can skip the waiting phase", async () => {
  const worker = workerHarness();
  const message = (url, type = "YANGATLAS_ACTIVATE_UPDATE") => worker.dispatch("message", { data: { type }, source: { url } });
  await message("https://third-party.test/YangAtlas/");
  await message("https://example.test/OtherApp/");
  await message(worker.base, "OTHER_MESSAGE");
  assert.equal(worker.counters.skipWaiting, 0);
  await message(worker.base);
  assert.equal(worker.counters.skipWaiting, 1);
});

class Events {
  callbacks = new Map();
  addEventListener(name, callback) { if (!this.callbacks.has(name)) this.callbacks.set(name, new Set()); this.callbacks.get(name).add(callback); }
  removeEventListener(name, callback) { this.callbacks.get(name)?.delete(callback); }
  dispatch(name) { for (const callback of [...(this.callbacks.get(name) || [])]) callback(); }
}

function clientHarness({ existing = false, waiting = false, unsupported = false, registerFails = false } = {}) {
  const window = new Events(), container = new Events(), registration = new Events();
  const states = [], updates = [], posted = [];
  let resolveReady;
  const worker = Object.assign(new Events(), { state: "installed", postMessage: (value) => posted.push(value) });
  registration.waiting = waiting ? worker : null;
  registration.update = async () => {};
  container.controller = existing ? {} : null;
  container.ready = new Promise((resolve) => { resolveReady = resolve; });
  container.register = async (url, options) => {
    if (registerFails) throw new Error("registration failed");
    container.registered = { url: url.href, options };
    return registration;
  };
  const navigator = { serviceWorker: unsupported ? undefined : container, onLine: true };
  const context = {
    navigator, window, isSecureContext: true, URL, setTimeout, clearTimeout,
    get localStorage() { throw new Error("Offline module must not access user storage"); },
    location: { reload() { throw new Error("Offline module must not reload a document"); } },
  };
  vm.runInNewContext(clientSource.replaceAll("export ", "").replaceAll("import.meta.url", '"https://example.test/YangAtlas/src/offline.js"')
    + "\nglobalThis.api = {setupOffline,applyOfflineUpdate};", context);
  return {
    container, registration, worker, states, updates, navigator, window, posted,
    start: () => context.api.setupOffline({ onStatus: (value) => states.push(value), onUpdate: (value) => updates.push(value) }),
    ready: async () => { resolveReady(registration); await Promise.resolve(); },
  };
}

test("client registers within the project subpath, reports first-install readiness and handles offline/disposal", async () => {
  const client = clientHarness();
  const offline = await client.start();
  assert.equal(client.container.registered.url, "https://example.test/YangAtlas/service-worker.js");
  assert.equal(client.container.registered.options.scope, "https://example.test/YangAtlas/");
  assert.equal(client.container.registered.options.updateViaCache, "none");
  await client.ready();
  client.container.controller = client.worker;
  client.container.dispatch("controllerchange");
  assert.equal(client.states.at(-1).state, "ready");
  assert.equal(client.states.some((value) => value.state === "updated"), false);
  client.navigator.onLine = false;
  client.window.dispatch("offline");
  assert.equal(client.states.at(-1).state, "offline");
  assert.equal(client.states.at(-1).offlineReady, true);
  const count = client.states.length;
  offline.dispose();
  client.window.dispatch("online");
  assert.equal(client.states.length, count);
  assert.equal(await offline.applyUpdate(), false);
});

test("client updates only after explicit acceptance and resolves after controllerchange, without reload/storage writes", async () => {
  const client = clientHarness({ existing: true, waiting: true });
  const offline = await client.start();
  assert.equal(client.updates.length, 1);
  assert.equal(client.posted.length, 0);
  let settled = false;
  const applying = offline.applyUpdate().then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(client.posted[0].type, "YANGATLAS_ACTIVATE_UPDATE");
  client.container.controller = client.worker;
  client.container.dispatch("controllerchange");
  assert.equal(await applying, true);
  assert.equal(client.states.at(-1).state, "updated");
  offline.dispose();
});

test("client keeps unsupported/failed registration usable and rejects a failed accepted update", async () => {
  const unsupported = clientHarness({ unsupported: true });
  assert.equal((await unsupported.start()).supported, false);
  assert.equal(unsupported.states.at(-1).state, "unsupported");
  const failed = clientHarness({ registerFails: true });
  const fallback = await failed.start();
  assert.equal(failed.states.at(-1).state, "error");
  assert.equal(await fallback.applyUpdate(), false);
  fallback.dispose();
  const client = clientHarness({ waiting: true });
  const offline = await client.start();
  const applying = offline.applyUpdate();
  client.worker.state = "redundant";
  client.worker.dispatch("statechange");
  await assert.rejects(applying, /Bản cập nhật chưa áp dụng/);
  offline.dispose();
});

test("build derives every copied resource/integrity and changes the cache revision when app bytes change", async () => {
  const root = await mkdtemp(join(tmpdir(), "yangatlas-offline-build-"));
  try {
    for (const folder of ["src", "public/fonts", "public/media", "LICENSES/fonts", "docs"]) await mkdir(join(root, folder), { recursive: true });
    const files = {
      "index.html": "<main>Atlas</main>", "src/app.js": "app-v1", "src/styles.css": "body{}",
      "public/fonts/local.woff2": "font-bytes", "public/media/local.jpg": "photo-bytes",
      "public/manifest.webmanifest": '{"start_url":"./","scope":"./"}',
      "public/service-worker.js": workerSource, "LICENSES/fonts/OFL.txt": "font-license",
      "docs/MEDIA.md": "photo attribution", "THIRD_PARTY_NOTICES.md": "notices", "LICENSE": "source license",
    };
    for (const [name, value] of Object.entries(files)) await writeFile(join(root, name), value);
    const build = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));
    const run = () => execFileSync(process.execPath, [build], { cwd: root, encoding: "utf8" });
    run();
    const first = await readFile(join(root, "dist/service-worker.js"), "utf8");
    assert.equal(first.includes("__YANGATLAS_BUILD_VERSION__"), false);
    const entries = JSON.parse(first.match(/const PRECACHE = ([\s\S]*?);\r?\nconst BASE/)[1]);
    for (const file of ["index.html", "src/app.js", "fonts/local.woff2", "media/local.jpg", "LICENSES/fonts/OFL.txt", "docs/MEDIA.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "manifest.webmanifest"]) {
      const entry = entries.find((value) => value.url === "./" + file);
      assert.ok(entry, "Offline manifest must include " + file);
      assert.equal(entry.integrity, integrity(await readFile(join(root, "dist", file))));
    }
    const version = (source) => source.match(/const BUILD_VERSION = "([^"]+)"/)[1];
    run();
    assert.equal(version(await readFile(join(root, "dist/service-worker.js"), "utf8")), version(first));
    await writeFile(join(root, "src/app.js"), "app-v2");
    run();
    assert.notEqual(version(await readFile(join(root, "dist/service-worker.js"), "utf8")), version(first));
  } finally {
    // root is a unique, absolute mkdtemp directory scoped to this test.
    assert.ok(root.startsWith(join(tmpdir(), "yangatlas-offline-build-")));
    await rm(root, { recursive: true, force: true });
  }
});

test("install manifest remains relative and supplies real standard/maskable icon sizes", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.id, "./");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((value) => value.sizes === `${size}x${size}`);
    assert.ok(icon);
    const bytes = await readFile(new URL("../public/" + icon.src, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
