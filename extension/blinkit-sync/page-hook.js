// Runs in the page's own JS world. Many panels build export files in memory and
// download them via blob: URLs, which the extension cannot fetch afterwards. Keep a
// reference to recent non-media blobs so content.js can read the downloaded file.
(() => {
  const MAX = 20;
  const kept = new Map();
  const create = URL.createObjectURL;

  URL.createObjectURL = function (obj) {
    const url = create.apply(this, arguments);
    if (obj instanceof Blob && !/^(image|video|audio|font)\//.test(obj.type)) {
      kept.set(url, obj);
      if (kept.size > MAX) kept.delete(kept.keys().next().value);
    }
    return url;
  };

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.source !== "qcp-ext" || e.data.type !== "get-blob") return;
    const blob = kept.get(e.data.url);
    if (!blob) {
      window.postMessage({ source: "qcp-page", id: e.data.id, error: "blob not found" }, "*");
      return;
    }
    window.postMessage({ source: "qcp-page", id: e.data.id, buf: await blob.arrayBuffer() }, "*");
  });
})();
