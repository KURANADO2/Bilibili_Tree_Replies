(() => {
  const API_BASE = "https://api.bilibili.com";

  async function apiGet(path, params = {}) {
    const url = new URL(path, API_BASE);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json.code !== 0) {
      throw new Error(json.message || `Bilibili API ${json.code}`);
    }
    return json.data;
  }

  async function apiPost(path, params = {}) {
    const url = new URL(path, API_BASE);
    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        body.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json.code !== 0) {
      throw new Error(json.message || `Bilibili API ${json.code}`);
    }
    return json.data;
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      (event.data?.type !== "BTR_PAGE_API_POST" && event.data?.type !== "BTR_PAGE_API_GET")
    ) {
      return;
    }
    const { requestId, path, params } = event.data;
    const handler = event.data.type === "BTR_PAGE_API_POST" ? apiPost : apiGet;

    handler(path, params)
      .then((data) => {
        window.postMessage({ type: "BTR_PAGE_API_RESPONSE", requestId, ok: true, data }, "*");
      })
      .catch((error) => {
        window.postMessage({
          type: "BTR_PAGE_API_RESPONSE",
          requestId,
          ok: false,
          error: error.message || String(error),
        }, "*");
    });
  });

  window.postMessage({ type: "BTR_PAGE_API_READY" }, "*");
})();
