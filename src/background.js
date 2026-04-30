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

async function apiPost(path, params = {}, referrer = "https://www.bilibili.com/") {
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
    referrer,
    referrerPolicy: "strict-origin-when-cross-origin",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BTR_API_GET" && message?.type !== "BTR_API_POST") return false;

  const referrer = sender?.tab?.url || "https://www.bilibili.com/";
  const promise = message.type === "BTR_API_POST"
    ? apiPost(message.path, message.params, referrer)
    : apiGet(message.path, message.params);

  promise
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
