import { createApiClient } from "/static/modules/api-client.js";

const $ = (id) => document.getElementById(id);

const statusTextEl = $("statusText");
const statusCardEl = statusTextEl?.closest(".kb-card--status") || null;
const refreshStatusBtn = $("refreshStatusBtn");
const queryInputEl = $("queryInput");
const topKInputEl = $("topKInput");
const modeInputEl = $("modeInput");
const searchBtn = $("searchBtn");
const resultMetaEl = $("resultMeta");
const resultListEl = $("resultList");

const sessionStore = window.sessionStorage;
const url = new URL(window.location.href);
const urlToken = url.searchParams.get("token") || "";
const storedToken = sessionStore.getItem("openclaw-webchat-auth-token") || "";
const authToken = urlToken || storedToken;
const api = createApiClient(() => authToken);

function ensureStatusUi() {
  if (!statusCardEl || !statusTextEl) return {};
  let lamp = $("statusLamp");
  if (!lamp) {
    lamp = document.createElement("div");
    lamp.id = "statusLamp";
    lamp.className = "kb-status-lamp kb-status-lamp--checking";
    lamp.setAttribute("aria-hidden", "true");
    lamp.innerHTML = "<span></span>";
    statusCardEl.insertBefore(lamp, statusCardEl.firstElementChild);
  }

  let details = $("statusDetails");
  if (!details) {
    details = document.createElement("div");
    details.id = "statusDetails";
    details.className = "kb-status-details";
    statusTextEl.insertAdjacentElement("afterend", details);
  }
  return { lamp, details };
}

function setStatus(text, kind = "", detailItems = []) {
  const { lamp, details } = ensureStatusUi();
  statusTextEl.textContent = text;
  statusTextEl.className = "";
  if (kind) statusTextEl.classList.add(`kb-status-${kind}`);
  if (lamp) lamp.className = `kb-status-lamp kb-status-lamp--${kind || "checking"}`;
  if (details) {
    details.innerHTML = "";
    detailItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "kb-status-detail";
      row.textContent = item;
      details.appendChild(row);
    });
  }
}

function readableValue(value, fallback = "未设置") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function describeKnowledgeStatus(knowledge = {}) {
  const enabled = !!knowledge.enabled;
  const loaded = !!knowledge.loaded;
  const error = knowledge.error ? String(knowledge.error) : "";
  const mode = readableValue(knowledge.mode, "默认");
  const topK = readableValue(knowledge.top_k, "默认");
  const outputDir = readableValue(knowledge.output_dir);
  const model = readableValue(knowledge.model, "默认 embedding 模型");

  if (error) {
    return {
      kind: "error",
      text: `知识库连接异常：${error}`,
      details: [
        "后端已经响应，但知识库加载或检索时出现错误。",
        `索引目录：${outputDir}`,
        `后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
      ],
    };
  }

  if (!enabled) {
    return {
      kind: "error",
      text: "知识库服务已响应，但检索开关没有打开。",
      details: [
        "当前会返回空结果；启动前设置 OPENCLAW_KB_ENABLED=1 后再重启服务。",
        `索引目录：${outputDir}`,
        `后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
      ],
    };
  }

  if (!loaded) {
    return {
      kind: "warning",
      text: "知识库已开启，正在等待第一次检索加载索引。",
      details: [
        "这是正常状态；第一次点击“开始检索”时会加载 embedding 模型和索引。",
        `索引目录：${outputDir}`,
        `模型：${model}；后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
      ],
    };
  }

  return {
    kind: "ok",
    text: "知识库已连接，索引已经加载，可以开始检索。",
    details: [
      `索引目录：${outputDir}`,
      `模型：${model}`,
      `后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
    ],
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function normalizeResultTitle(item, index) {
  return item.title || item.source || item.path || item.id || `结果 ${index + 1}`;
}

function normalizeResultText(item) {
  return item.text || item.content || item.chunk || item.document || item.summary || safeJson(item);
}

function createRawDataCard(item) {
  const meta = document.createElement("details");
  meta.className = "kb-result__meta";

  const summary = document.createElement("summary");
  summary.className = "kb-raw-summary";
  const label = document.createElement("span");
  label.textContent = "原始数据";
  summary.append(label);

  const detailCard = document.createElement("div");
  detailCard.className = "kb-raw-card";
  const pre = document.createElement("pre");
  pre.textContent = safeJson(item);
  detailCard.appendChild(pre);

  meta.append(summary, detailCard);
  return meta;
}

function renderResults(results) {
  resultListEl.innerHTML = "";
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "kb-empty";
    empty.textContent = "没有检索到结果。可以换一个问题，或检查知识库是否已经加载。";
    resultListEl.appendChild(empty);
    return;
  }

  results.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "kb-result";

    const head = document.createElement("div");
    head.className = "kb-result__head";
    const title = document.createElement("span");
    title.textContent = normalizeResultTitle(item, index);
    const score = document.createElement("span");
    const rawScore = item.score ?? item.similarity ?? item.distance ?? "";
    score.textContent = rawScore === "" ? `#${index + 1}` : `#${index + 1} · score=${rawScore}`;
    head.append(title, score);

    const text = document.createElement("div");
    text.className = "kb-result__text";
    text.textContent = normalizeResultText(item);

    const meta = createRawDataCard(item);

    card.append(head, text, meta);
    resultListEl.appendChild(card);
  });
}

function updateRequestHint() {
  const topK = Number.parseInt(topKInputEl.value, 10);
  const mode = modeInputEl.value.trim();
  const requestedTopK = Number.isFinite(topK) ? `${topK} 条` : "后端默认条数";
  const requestedMode = mode || "后端默认模式";
  if (resultMetaEl) {
    resultMetaEl.textContent = `待检索 · 本次将使用 ${requestedMode}，请求返回 ${requestedTopK}`;
  }
}

async function refreshStatus() {
  setStatus("正在检查知识库连接...", "checking", ["请稍等，正在请求后端状态接口。"]);
  try {
    const data = await api("/api/knowledge/status");
    const status = describeKnowledgeStatus(data.knowledge || {});
    setStatus(status.text, status.kind, status.details);
  } catch (err) {
    setStatus(`连接失败：${err.message || err}`, "error", [
      "前端没有成功请求到 /api/knowledge/status。",
      "请确认 webchat 服务正在运行，并且 token 没有填错。",
    ]);
  }
}

async function searchKnowledge() {
  const query = queryInputEl.value.trim();
  if (!query) {
    queryInputEl.focus();
    setStatus("请先输入测试问题。", "error");
    return;
  }

  searchBtn.disabled = true;
  resultMetaEl.textContent = "检索中...";
  resultListEl.innerHTML = "";

  try {
    const topK = Number.parseInt(topKInputEl.value, 10);
    const mode = modeInputEl.value.trim();
    const requestedTopK = Number.isFinite(topK) ? topK : "后端默认";
    const requestedMode = mode || "后端默认";
    resultMetaEl.textContent = `检索中...本次请求：${requestedMode} 模式，返回 ${requestedTopK} 条`;
    const data = await api("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        top_k: Number.isFinite(topK) ? topK : undefined,
        mode: mode || undefined,
      }),
    });
    const results = Array.isArray(data.results) ? data.results : [];
    resultMetaEl.textContent = `${results.length} 条结果 · 本次请求 ${requestedTopK} 条 · ${requestedMode} 模式 · query="${data.query || query}"`;
    renderResults(results);

    if (data.knowledge) {
      const status = describeKnowledgeStatus(data.knowledge);
      setStatus(status.text, status.kind, status.details);
    }
  } catch (err) {
    resultMetaEl.textContent = "检索失败";
    const empty = document.createElement("div");
    empty.className = "kb-empty";
    empty.textContent = `请求失败：${err.message || err}`;
    resultListEl.appendChild(empty);
  } finally {
    searchBtn.disabled = false;
  }
}

refreshStatusBtn.addEventListener("click", () => void refreshStatus());
searchBtn.addEventListener("click", () => void searchKnowledge());
topKInputEl.addEventListener("input", updateRequestHint);
modeInputEl.addEventListener("input", updateRequestHint);
queryInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void searchKnowledge();
  }
});

updateRequestHint();
void refreshStatus();
