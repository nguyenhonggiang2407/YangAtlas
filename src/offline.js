/** Optional offline lifecycle; never touches storage or reloads the document.
 * setupOffline({ onStatus, onUpdate }) resolves to a disposable controller.
 * onStatus({state,message,offlineReady,updateReady}); onUpdate({apply}).
 * Ask the visitor to save/close forms before invoking applyUpdate(). It resolves
 * true ONLY after controllerchange to the requested waiting worker, false when
 * no update is waiting, and rejects if activation fails/times out. The caller
 * may then explicitly reload. Other tabs only receive status; no silent reload.
 * Installation/offline behavior is enabled in a generated build over HTTPS or
 * localhost; the unbuilt source worker is intentionally not an offline release.
 */
let latestRegistration;

export function applyOfflineUpdate(registration = latestRegistration) {
  const worker = registration?.waiting;
  const container = globalThis.navigator?.serviceWorker;
  if (!worker || !container) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const previous = container.controller;
    const cleanup = () => {
      clearTimeout(timeout);
      container.removeEventListener("controllerchange", changed);
      worker.removeEventListener("statechange", failed);
    };
    const changed = () => {
      if (
        container.controller &&
        container.controller !== previous &&
        container.controller === worker
      ) {
        cleanup();
        resolve(true);
      }
    };
    const failed = () => {
      if (worker.state === "redundant") {
        cleanup();
        reject(new Error("Bản cập nhật chưa áp dụng được. Hãy thử lại sau."));
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Bản cập nhật vẫn đang chờ. Lịch trình hiện tại được giữ nguyên.",
        ),
      );
    }, 15000);
    container.addEventListener("controllerchange", changed);
    worker.addEventListener("statechange", failed);
    try {
      worker.postMessage({ type: "YANGATLAS_ACTIVATE_UPDATE" });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function setupOffline({
  onStatus = () => {},
  onUpdate = () => {},
} = {}) {
  const container = globalThis.navigator?.serviceWorker;
  const browser = globalThis.window;
  const supported = Boolean(container && globalThis.isSecureContext && browser);
  let registration,
    offlineReady = false,
    disposed = false,
    lastWaiting,
    hadController = Boolean(container?.controller);
  const removers = [];
  const listen = (target, name, callback) => {
    target.addEventListener(name, callback);
    removers.push(() => target.removeEventListener(name, callback));
  };
  const emit = (state, message) => {
    if (!disposed)
      onStatus({
        state,
        message,
        offlineReady,
        updateReady: Boolean(registration?.waiting),
      });
  };
  const connection = () => {
    if (globalThis.navigator.onLine === false) {
      emit(
        "offline",
        offlineReady
          ? "Đang ngoại tuyến · bản ứng dụng đã được lưu trên thiết bị."
          : "Đang ngoại tuyến · bản ứng dụng chưa sẵn sàng để mở lại.",
      );
    } else if (offlineReady)
      emit("ready", "Đã sẵn sàng để mở ngoại tuyến trên thiết bị này.");
    else emit("online", "Đang có mạng · chuẩn bị bản dùng ngoại tuyến.");
  };
  const controller = {
    supported,
    get registration() {
      return registration;
    },
    applyUpdate: () =>
      registration ? applyOfflineUpdate(registration) : Promise.resolve(false),
    checkForUpdate: async () => {
      if (!registration) return false;
      await registration.update();
      return Boolean(registration.waiting);
    },
    dispose: () => {
      disposed = true;
      removers.forEach((remove) => remove());
    },
  };
  if (!supported) {
    emit(
      "unsupported",
      "Trình duyệt này chưa hỗ trợ lưu ứng dụng ngoại tuyến. Bạn vẫn có thể dùng khi có mạng.",
    );
    return controller;
  }
  emit("preparing", "Đang chuẩn bị bản dùng ngoại tuyến…");
  listen(browser, "online", connection);
  listen(browser, "offline", connection);
  listen(container, "controllerchange", () => {
    offlineReady = true;
    if (hadController)
      emit(
        "updated",
        "Bản mới đã sẵn sàng. Bạn có thể chủ động mở lại sau khi lưu thay đổi.",
      );
    else connection();
    hadController = true;
  });
  const waiting = () => {
    if (
      disposed ||
      !registration?.waiting ||
      registration.waiting === lastWaiting
    )
      return;
    lastWaiting = registration.waiting;
    emit("update-ready", "Có bản mới · chỉ áp dụng khi bạn chọn cập nhật.");
    onUpdate({ apply: controller.applyUpdate });
  };
  const watch = (worker) => {
    if (!worker) return;
    listen(worker, "statechange", () => {
      if (worker.state === "installed") waiting();
      if (worker.state === "redundant")
        emit(
          "error",
          "Chưa lưu được bản ngoại tuyến mới. Bản đang dùng và lịch trình được giữ nguyên.",
        );
    });
  };
  try {
    const base = new URL("../", import.meta.url);
    registration = await container.register(
      new URL("service-worker.js", base),
      { scope: base.href, updateViaCache: "none" },
    );
    latestRegistration = registration;
    if (disposed) return controller;
    listen(registration, "updatefound", () => watch(registration.installing));
    watch(registration.installing);
    waiting();
    container.ready
      .then(() => {
        if (disposed) return;
        offlineReady = true;
        connection();
      })
      .catch(() => {
        if (!disposed)
          emit(
            "error",
            "Chưa chuẩn bị được bản ngoại tuyến. Bạn vẫn có thể dùng khi có mạng.",
          );
      });
  } catch {
    emit(
      "error",
      "Chưa chuẩn bị được bản ngoại tuyến. Bạn vẫn có thể dùng khi có mạng.",
    );
  }
  return controller;
}
