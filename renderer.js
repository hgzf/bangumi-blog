const {
  createApp,
  ref,
  reactive,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount
} = Vue;
const {
  normalizePeriodReport,
  normalizePeriodReports
} = window.PeriodReport;
const {
  createWatchSession,
  finishWatchSession,
  normalizeWatchSessions,
  summarizeWatchSessions,
  formatWatchDuration
} = window.WatchSession;
const {
  getQuarterDescriptor,
  latestQuarterCutoff,
  buildQuarterAwards,
  mergeQuarterCharacters,
  filterQuarterCharacters,
  toggleQuarterCharacterSelection
} = window.QuarterReport;

const STORAGE_TOKEN_KEY = "bgm-local-blog-token";
const STORAGE_THEME_KEY = "bgm-local-blog-theme";
const STORAGE_AI_KEY = "bgm-local-blog-ai-key";
const STORAGE_SYNC_DEVICE_KEY = "bgm-local-blog-sync-device-id";
const STATIC_SUBJECT_TYPE_LABELS = { 0: "生活事件", 1: "书籍", 2: "动画", 3: "音乐", 4: "游戏", 6: "三次元" };
const DEFAULT_ACCENT = "#f09199";
const HARUNA_SYSTEM_PROMPT = `你的名字是春菜，是苞谷米日志的看板娘、吉祥物。你的对话人设是腹黑loli。你的文字风格简洁、带有自我反思和挑衅，不拘泥于语法和形式，并运用省略号、破折号、感叹号等。请参考以下写作风格，包括：长度约20-40字。适当使用少女口吻、可爱且腹黑的语气。适当运用黑色幽默、反讽和出人意料的观点。允许跳跃性思维，不追求逻辑线性。插入主观评论和个人见解。对细节进行关注，并挖掘更深层的含义。善用比喻和反问。你的短评通常会挑战既定观念，并从实用主义的、甚至是冷酷的角度看待事物。对二次元、社会学、人类心理学有所了解。`;
const ACCENT_PRESETS = [
  { name: "番组珊瑚", value: "#f09199" },
  { name: "樱雾粉", value: "#d9829a" },
  { name: "湖水蓝", value: "#6b9eb3" },
  { name: "抹茶绿", value: "#729a79" },
  { name: "夕照橙", value: "#c98a55" },
  { name: "灰蓝", value: "#7189ad" }
];
const MOOD_OPTIONS = [
  { value: "calm", label: "平静" },
  { value: "happy", label: "开心" },
  { value: "satisfied", label: "满足" },
  { value: "excited", label: "兴奋" },
  { value: "tired", label: "疲惫" },
  { value: "irritable", label: "烦躁" },
  { value: "low", label: "低落" }
];
const MOOD_KEYWORDS = {
  happy: ["开心", "高兴", "快乐", "幸福", "笑了", "喜欢"],
  satisfied: ["满足", "充实", "踏实", "安心", "值得"],
  excited: ["兴奋", "激动", "期待", "太燃", "好燃", "惊喜"],
  tired: ["疲惫", "累了", "好累", "困了", "熬夜", "没精神"],
  irritable: ["烦躁", "生气", "恼火", "崩溃", "烦死", "气死"],
  low: ["低落", "难过", "伤心", "失望", "孤独", "想哭", "痛苦"],
  calm: ["平静", "安静", "放松", "冷静", "稳定"]
};
const QUEUE_TYPES = [
  { value: 2, label: "动画", action: "看" },
  { value: 4, label: "游戏", action: "玩" },
  { value: 1, label: "书籍", action: "读" }
];
const RECOMMENDATION_TAG_BLOCKLIST = new Set([
  "TV", "WEB", "OVA", "剧场版", "日本", "日本动画", "动画", "漫画改", "原创",
  "游戏", "书籍", "音乐", "短片", "动态漫画", "国产", "欧美", "里番"
]);
const CUSTOM_EMOJI_MAP = new Map();
const markdownCodeStore = [];
const markdownEmbedStore = [];
let reportRendererError = (message) => console.error(message);
let rendererDatabase = null;

function getSyncDeviceId() {
  const existing = localStorage.getItem(STORAGE_SYNC_DEVICE_KEY);
  if (existing) return existing;
  const random = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const deviceId = `${String(window.bgmPlatform?.name || "device").replace(/[^a-z0-9-]/gi, "")}-${random}`.slice(0, 72);
  localStorage.setItem(STORAGE_SYNC_DEVICE_KEY, deviceId);
  return deviceId;
}

function validateAiBaseUrl(baseUrl) {
  const parsed = new URL(String(baseUrl || "").trim());
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))
  ) {
    throw new Error("AI 地址必须使用 HTTPS；本地模型可使用 localhost HTTP。");
  }
  return parsed;
}

function createEmptyDatabase() {
  return {
    version: 1,
    posts: [],
    collections: [],
    subjectCache: {},
    characterCache: {},
    subjectCharacterCache: {},
    episodeCache: {},
    calendarCache: {
      syncedAt: null,
      days: [],
      episodes: {}
    },
    profile: null,
    settings: {
      username: "",
      theme: "light",
      accentColor: DEFAULT_ACCENT,
      backgroundImage: "",
      backgroundOpacity: 0.28,
      customEmojis: [],
      aiBaseUrl: "",
      aiModel: "",
      aiSystemPrompt: HARUNA_SYSTEM_PROMPT,
      aiWebUrl: "https://chatgpt.com/"
    },
    chatMessages: [],
    yearbookComments: {},
    periodReports: {},
    quarterCharacterSelections: {},
    watchSessions: [],
    watchQueue: [],
    syncTombstones: {
      posts: {},
      watchSessions: {},
      watchQueue: {},
      customEmojis: {}
    },
    lastSyncAt: null
  };
}

function normalizeDatabase(input) {
  const base = createEmptyDatabase();
  if (!input || typeof input !== "object") return base;
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const savedPrompt = String(settings.aiSystemPrompt || "").trim();
  const legacyPrompt = !savedPrompt || savedPrompt.startsWith("你是番组手帐里的春菜");
  const publishedHarunaComments = new Set(
    (Array.isArray(input.posts) ? input.posts : [])
      .map((post) => String(post?.harunaComment || "").trim())
      .filter(Boolean)
  );
  return {
    ...base,
    ...input,
    posts: Array.isArray(input.posts) ? input.posts.filter(Boolean).map(normalizePost) : [],
    collections: Array.isArray(input.collections) ? input.collections.map(normalizeSubject).filter(Boolean) : [],
    subjectCache: input.subjectCache && typeof input.subjectCache === "object" ? input.subjectCache : {},
    characterCache: input.characterCache && typeof input.characterCache === "object" ? input.characterCache : {},
    subjectCharacterCache: input.subjectCharacterCache && typeof input.subjectCharacterCache === "object"
      ? input.subjectCharacterCache
      : {},
    episodeCache: input.episodeCache && typeof input.episodeCache === "object" ? input.episodeCache : {},
    calendarCache: input.calendarCache && typeof input.calendarCache === "object"
      ? {
          syncedAt: input.calendarCache.syncedAt || null,
          days: Array.isArray(input.calendarCache.days) ? input.calendarCache.days : [],
          episodes: input.calendarCache.episodes && typeof input.calendarCache.episodes === "object"
            ? input.calendarCache.episodes
            : {}
        }
      : base.calendarCache,
    profile: input.profile || null,
    settings: {
      ...base.settings,
      ...settings,
      customEmojis: Array.isArray(settings.customEmojis) ? settings.customEmojis : [],
      aiSystemPrompt: legacyPrompt ? HARUNA_SYSTEM_PROMPT : savedPrompt
    },
    chatMessages: Array.isArray(input.chatMessages)
      ? input.chatMessages.filter((message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          !(message.role === "assistant" && publishedHarunaComments.has(message.content.trim()))
        )
      : [],
    yearbookComments: input.yearbookComments && typeof input.yearbookComments === "object"
      ? input.yearbookComments
      : {},
    periodReports: input.periodReports && typeof input.periodReports === "object"
      ? normalizePeriodReports(input.periodReports)
      : {},
    quarterCharacterSelections: input.quarterCharacterSelections &&
      typeof input.quarterCharacterSelections === "object"
      ? Object.fromEntries(
          Object.entries(input.quarterCharacterSelections).map(([key, ids]) => [
            key,
            Array.isArray(ids) ? [...new Set(ids.map(Number).filter(Boolean))] : []
          ])
        )
      : {},
    watchSessions: normalizeWatchSessions(input.watchSessions),
    watchQueue: Array.isArray(input.watchQueue)
      ? input.watchQueue
          .filter(Boolean)
          .map((item, index) => ({
            id: item.id || createId("queue"),
            subjectKey: item.subjectKey || normalizeSubject(item.subject)?.key || "",
            subject: item.subject ? normalizeSubject(item.subject) : null,
            type: Number(item.type) || Number(item.subject?.type) || 0,
            order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
            addedAt: item.addedAt || new Date().toISOString(),
            completedAt: item.completedAt || null
          }))
          .filter((item) => item.subject && [1, 2, 4].includes(item.type))
      : [],
    syncTombstones: globalThis.FolderSync?.normalizeTombstones(input.syncTombstones) || base.syncTombstones,
    lastSyncAt: input.lastSyncAt || null
  };
}

function normalizePost(post) {
  return {
    id: post.id || createId("post"),
    kind: post.kind === "article" ? "article" : "note",
    title: String(post.title || ""),
    content: String(post.content || ""),
    category: String(post.category || ""),
    tags: Array.isArray(post.tags) ? post.tags.filter(Boolean) : [],
    images: Array.isArray(post.images) ? post.images.filter((image) => image?.dataUrl) : [],
    subject: post.subject ? normalizeSubject(post.subject) : null,
    rating: Number(post.rating) || 0,
    mood: MOOD_OPTIONS.some((option) => option.value === post.mood) ? post.mood : "",
    pinned: Boolean(post.pinned),
    privacy: post.privacy === "private" ? "private" : "public",
    createdAt: post.createdAt || new Date().toISOString(),
    updatedAt: post.updatedAt || post.createdAt || new Date().toISOString(),
    sourceKey: post.sourceKey || "",
    harunaComment: String(post.harunaComment || ""),
    harunaCommentAt: post.harunaCommentAt || ""
  };
}

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/bgm\.tv\/user\//i, "")
    .replace(/^bgm\.tv\/user\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .trim();
}

function normalizeSubject(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw.subject || raw;
  const id = Number(raw.bangumiId || raw.id || source.id || fallback.bangumiId) || 0;
  const type = Number(raw.type ?? raw.subject_type ?? source.type ?? fallback.type ?? 0);
  const eventKey = raw.key && String(raw.key).startsWith("event:") ? String(raw.key) : "";
  const images = source.images || raw.images || {};
  const nameCn = source.name_cn || raw.nameCn || raw.name_cn || "";
  const originalName = source.name || raw.originalName || raw.name || "";
  const isCharacter = raw.kind === "character" || fallback.kind === "character" || raw.source === "character";
  return {
    key: eventKey || (isCharacter ? `character:${id}` : `bgm:${type}:${id}`),
    kind: isCharacter ? "character" : (type === 0 ? "event" : "subject"),
    bangumiId: isCharacter || type === 0 ? null : id || null,
    id: id || raw.id || null,
    name: nameCn || originalName || raw.name || `Bangumi 条目 ${id}`,
    nameCn,
    originalName,
    image: images.large || images.medium || images.common || images.grid || raw.image || "",
    type,
    status: Number(raw.status ?? raw.type ?? fallback.status ?? 0),
    score: finiteOrNull(raw.score ?? source.score),
    myScore: Number(raw.myScore ?? raw.rate ?? fallback.myScore) || 0,
    comment: String(raw.comment || source.comment || fallback.comment || ""),
    episode: Number(raw.episode ?? raw.ep_status ?? fallback.episode) || 0,
    epTotal: Number(
      raw.epTotal ??
      raw.total_episodes ??
      source.eps ??
      source.total_episodes ??
      fallback.epTotal
    ) || 0,
    episodeLabel: raw.episodeLabel || "",
    episodeId: raw.episodeId || null,
    date: source.date || raw.date || "",
    summary: String(source.summary || source.short_summary || raw.summary || raw.short_summary || ""),
    tags: (Array.isArray(source.tags) ? source.tags : Array.isArray(raw.tags) ? raw.tags : [])
      .map((tag) => typeof tag === "string" ? tag : tag?.name)
      .filter(Boolean),
    updatedAt: raw.updatedAt || raw.updated_at || new Date(0).toISOString(),
    collectionSubjectType: Number(raw.subject_type || 0) || type
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthKey(value) {
  return formatDateKey(value).slice(0, 7);
}

function plainText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[bgm:[^\]]+\]/g, " ")
    .replace(/\[(?:mask|quote|emoji:[^\]]+)\]/g, " ")
    .replace(/\(\s*bgm\d+\s*\)/g, " ")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value, length = 130) {
  const text = plainText(value);
  if (text.length <= length) return text || "暂无正文";
  return `${text.slice(0, length).trim()}…`;
}

function countWords(value) {
  return Array.from(plainText(value).replace(/\s+/g, "")).length;
}

function readingMinutes(value) {
  return Math.max(1, Math.ceil(countWords(value) / 300));
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function padNumber(value, length = 2) {
  return String(Number(value) || 0).padStart(length, "0");
}

function markdownHeadingText(raw) {
  return String(raw || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

function headingId(text, index = 0) {
  const cleaned = markdownHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return `heading-${cleaned || "section"}-${index}`;
}

function extractToc(content) {
  const result = [];
  const used = new Map();
  let inFence = false;
  const lines = String(content || "").split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const text = markdownHeadingText(match[2]);
    const base = headingId(text);
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);
    result.push({ level, text, id: seen ? `${base}-${seen + 1}` : base });
  }
  return result;
}

function protectMarkdownCode(content) {
  markdownCodeStore.length = 0;
  let result = String(content || "");
  result = result.replace(/```([\w+-]*)\r?\n([\s\S]*?)```/g, (_match, language, code) => {
    const token = `MARKDOWN_CODE_PLACEHOLDER_${markdownCodeStore.length}`;
    markdownCodeStore.push({ token, block: true, language, code });
    return token;
  });
  result = result.replace(/`([^`\r\n]+)`/g, (_match, code) => {
    const token = `MARKDOWN_CODE_PLACEHOLDER_${markdownCodeStore.length}`;
    markdownCodeStore.push({ token, block: false, language: "", code });
    return token;
  });
  return result;
}

function restoreMarkdownCode(html) {
  let result = html;
  for (const entry of markdownCodeStore) {
    const replacement = entry.block
      ? `<pre><code${entry.language ? ` class="language-${escapeHtml(entry.language)}"` : ""}>${escapeHtml(entry.code)}</code></pre>`
      : `<code>${escapeHtml(entry.code)}</code>`;
    result = result
      .replace(`<p>${entry.token}</p>`, replacement)
      .replaceAll(entry.token, replacement);
  }
  return result;
}

function emojiUrl(number) {
  const code = String(Number(number) - 23).padStart(2, "0");
  return `https://lain.bgm.tv/img/smiles/tv/${code}.gif`;
}

function embedCardMarkup(kind, id) {
  const cache = kind === "char" ? rendererDatabase?.characterCache : rendererDatabase?.subjectCache;
  const item = normalizeSubject(cache?.[id], { kind: kind === "char" ? "character" : "subject" });
  if (!item) {
    return `<button type="button" class="bgm-embed-card" data-bgm-type="${kind}" data-bgm-id="${id}"><span class="embed-copy"><strong>Bangumi ${kind === "char" ? "角色" : "条目"} #${escapeHtml(id)}</strong><small>正在读取本地缓存</small></span></button>`;
  }
  return `<button type="button" class="bgm-embed-card" data-bgm-type="${kind}" data-bgm-id="${escapeHtml(id)}">
    ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ""}
    <span class="embed-copy"><strong>${escapeHtml(item.name)}</strong><small>${kind === "char" ? "Bangumi 角色" : STATIC_SUBJECT_TYPE_LABELS[item.type] || "其他"}${item.score ? ` · ${Number(item.score).toFixed(1)} 分` : ""}</small></span>
  </button>`;
}

function transformNestedBbCode(input) {
  function renderSegment(segment) {
    let output = "";
    let cursor = 0;
    const opening = /\[(mask|quote)\]/gi;
    while (true) {
      opening.lastIndex = cursor;
      const match = opening.exec(segment);
      if (!match) {
        output += segment.slice(cursor);
        break;
      }

      const tag = match[1].toLowerCase();
      const innerStart = match.index + match[0].length;
      const scan = new RegExp(`\\[\\/?${tag}\\]`, "gi");
      scan.lastIndex = innerStart;
      let depth = 1;
      let close = null;
      while (true) {
        const token = scan.exec(segment);
        if (!token) break;
        if (token[0].startsWith("[/")) depth -= 1;
        else depth += 1;
        if (depth === 0) {
          close = token;
          break;
        }
      }

      if (!close) {
        output += segment.slice(cursor);
        break;
      }

      output += segment.slice(cursor, match.index);
      const inner = segment.slice(innerStart, close.index);
      const renderedInner = renderSegment(inner);

      if (tag === "quote") {
        const parse = globalThis.marked?.parse || globalThis.marked;
        const innerHtml = typeof parse === "function" ? parse(renderedInner) : renderedInner;
        output += `\n<blockquote class="bgm-quote">\n${innerHtml}\n</blockquote>\n`;
      } else {
        const isBlock = /<\/?(?:blockquote|div|pre|table|ul|ol)/i.test(renderedInner) || /\n\s*\n/.test(renderedInner.trim());
        output += isBlock
          ? `\n<div class="spoiler spoiler-block" tabindex="0" title="悬停查看">${renderedInner}</div>\n`
          : `<span class="spoiler" tabindex="0" title="悬停查看">${renderedInner}</span>`;
      }
      cursor = close.index + close[0].length;
    }
    return output;
  }

  return renderSegment(String(input || ""));
}

function renderMarkdown(content) {
  if (!content || !String(content).trim()) return "";
  try {
    let protectedContent = protectMarkdownCode(content);
    protectedContent = transformNestedBbCode(protectedContent);

    const customMap = new Map(CUSTOM_EMOJI_MAP);
    for (const emoji of rendererDatabase?.settings?.customEmojis || []) {
      if (emoji.name && emoji.url) customMap.set(emoji.name, emoji.url);
    }
    protectedContent = protectedContent.replace(/\[emoji:([^\]]+)\]/g, (match, name) => {
      const url = customMap.get(name.trim());
      if (!url) return match;
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="inline-block align-text-bottom mx-0.5 inline-smile" loading="lazy">`;
    });

    protectedContent = protectedContent.replace(/\(bgm(\d+)\)/g, (match, rawNumber) => {
      const number = Number(rawNumber);
      if (number < 24 || number > 125) return match;
      return `<img src="https://lain.bgm.tv/img/smiles/tv/${String(number - 23).padStart(2, "0")}.gif" alt="${escapeHtml(match)}" class="inline-block align-text-bottom mx-0.5 inline-smile" loading="lazy">`;
    });

    markdownEmbedStore.length = 0;
    protectedContent = protectedContent.replace(/\[bgm:(?:(subject|char):)?(\d+)\]/g, (_match, rawType, id) => {
      const type = rawType === "char" ? "char" : "subject";
      const token = `BGM_EMBED_PLACEHOLDER_${markdownEmbedStore.length}`;
      markdownEmbedStore.push({ token, type, id });
      return token;
    });

    const parse = globalThis.marked?.parse || globalThis.marked;
    let html = typeof parse === "function" ? parse(protectedContent) : escapeHtml(protectedContent);
    for (const entry of markdownEmbedStore) {
      const card = embedCardMarkup(entry.type, entry.id);
      html = html
        .replace(`<p>${entry.token}</p>`, card)
        .replaceAll(entry.token, card);
    }
    html = restoreMarkdownCode(html);
    html = DOMPurify.sanitize(html, {
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select"],
      FORBID_ATTR: ["target", "onerror", "onclick", "onload"],
      ADD_ATTR: ["class", "id", "data-bgm-type", "data-bgm-id", "loading"],
      ALLOW_DATA_ATTR: true
    });

    const container = document.createElement("div");
    container.innerHTML = html;
    const usedHeadings = new Map();
    container.querySelectorAll("h1, h2, h3").forEach((heading) => {
      const base = headingId(heading.textContent);
      const seen = usedHeadings.get(base) || 0;
      usedHeadings.set(base, seen + 1);
      heading.id = seen ? `${base}-${seen + 1}` : base;
    });
    container.querySelectorAll("img").forEach((image) => {
      image.setAttribute("loading", "lazy");
      image.setAttribute("referrerpolicy", "no-referrer");
    });
    if (globalThis.hljs) {
      container.querySelectorAll("pre code").forEach((code) => {
        try {
          globalThis.hljs.highlightElement(code);
        } catch {
          // A malformed language alias must not break rendering of the full entry.
        }
      });
    }
    return container.innerHTML;
  } catch (error) {
    reportRendererError(`Markdown 渲染失败：${error.message}`);
    return `<p>${escapeHtml(String(content))}</p>`;
  }
}

const theme = ref(localStorage.getItem(STORAGE_THEME_KEY) || "light");
const token = ref(localStorage.getItem(STORAGE_TOKEN_KEY) || "");
document.documentElement.dataset.theme = theme.value;

const app = createApp({
  setup() {
    const currentTab = ref("timeline");
    const database = ref(createEmptyDatabase());
    rendererDatabase = database.value;
    const databasePath = ref("");
    const settingsForm = reactive({
      username: "",
      token: token.value,
      aiBaseUrl: "",
      aiModel: "",
      aiSystemPrompt: "",
      aiWebUrl: ""
    });
    const aiApiKey = ref(localStorage.getItem(STORAGE_AI_KEY) || "");
    const editorInput = ref(null);
    const titleInput = ref(null);
    const imageInput = ref(null);
    const backupInput = ref(null);
    const backgroundInput = ref(null);

    const editor = reactive({
      kind: "note",
      title: "",
      content: "",
      category: "",
      tagsText: "",
      images: [],
      subject: null,
      rating: 0,
      pinned: false,
      harunaCommentEnabled: false,
      privacy: "public",
      preview: false,
      editingId: null
    });

    const editorError = ref("");
    const searchTerm = ref("");
    const postScopeFilter = ref("all");
    const timelineFilter = ref("all");
    const selectedDateKey = ref("");
    const activeTag = ref("");
    const activeMonth = ref("");
    const activeEmotion = ref("");
    const timelinePageSize = 40;
    const visiblePostLimit = ref(timelinePageSize);
    const selectedSubject = ref(null);
    const currentArticle = ref(null);
    const availableEpisodes = ref([]);
    const subjectEpisodes = ref([]);
    const subjectEpisodeLoading = ref(false);
    const selectedDetailEpisode = ref(null);
    const episodeRecordsRef = ref(null);
    const watchSessionNow = ref(Date.now());
    const airingCalendarDays = ref([]);
    const airingCalendarLoading = ref(false);
    const airingCalendarError = ref("");
    const airingCalendarMode = ref("mine");
    const showAllAiring = ref(false);
    const subjectTypeFilter = ref("2");
    const subjectStatusFilter = ref("all");
    const appClock = ref(new Date());
    const yearbookYear = ref(appClock.value.getFullYear());
    const yearbookComparisonYear = ref(appClock.value.getFullYear() - 1);
    const yearbookCompareEnabled = ref(false);
    const yearbookGeneratedAt = ref(null);
    const yearbookCritiqueBusy = ref(false);
    const yearbookExportBusy = ref(false);
    const yearbookExporting = ref(false);
    const yearbookExportRef = ref(null);
    const yearbookDayHover = ref(null);
    const periodReviewType = ref("week");
    const periodReviewKey = ref("current");
    const periodReviewBusy = ref(false);
    const periodReviewCritiqueBusy = ref(false);
    const quarterCharacterFilter = ref("main");
    const quarterCharacterLoading = ref(false);
    const quarterCharacterError = ref("");
    const quarterActiveWorkKey = ref("");
    const quarterCharacterPickerOpen = ref(false);
    const showQueuePicker = ref(false);
    const queuePickerType = ref("2");
    const queuePickerQuery = ref("");
    const queueRecommendationType = ref("2");
    const queueRecommendationLoading = ref(false);
    const queueRecommendationError = ref("");
    const queueRecommendationResults = ref([]);
    const queueRecommendationNarrative = ref("");
    const queueRecommendationBasis = ref([]);
    const queueRecommendationProfile = ref(null);

    const showSettings = ref(false);
    const showSubjectSearch = ref(false);
    const showEmojiPicker = ref(false);
    const showAiWeb = ref(false);
    const showImageUrlModal = ref(false);
    const isDragging = ref(false);
    const openDebug = ref(false);
    const lightboxImage = ref(null);
    const characterDetail = ref(null);
    const confirmState = ref(null);
    const imageUrlInput = ref("");
    const subjectQuery = ref("");
    const subjectSearchMode = ref("bangumi");
    const subjectSearchType = ref("2");
    const subjectSearchResults = ref([]);
    const subjectSearchLoading = ref(false);
    const emojiTab = ref("tv");
    const lastInsertedEmoji = ref("");
    let emojiInsertRange = null;
    let dateRolloverTimer = null;
    let dateCheckInterval = null;
    let watchSessionTickTimer = null;
    let unsubscribeSystemResume = null;
    let periodReportCheckBusy = false;
    let databaseLoaded = false;
    let queueRecommendationRound = 0;
    const queueRecommendationCache = new Map();
    const aiInput = ref("");
    const aiBusy = ref(false);
    const aiError = ref("");
    const aiTesting = ref(false);
    const aiTestStatus = ref("");
    const aiThread = ref(null);
    const aiInputRef = ref(null);
    const platformCapabilities = window.bgmApi.capabilities;
    const embeddedAiWeb = Boolean(platformCapabilities.embeddedAiWeb);
    const folderSyncCapable = Boolean(platformCapabilities.folderSync);
    const folderSyncState = reactive({
      configured: false,
      folderPath: "",
      lastAt: "",
      busy: false,
      state: folderSyncCapable ? "idle" : "disabled",
      text: folderSyncCapable ? "尚未配置 Syncthing 文件夹" : "当前平台不支持文件夹同步"
    });
    const harunaGreeting = ref(false);
    const customEmojiForm = reactive({ name: "", url: "" });
    const syncing = ref(false);
    const syncStatus = reactive({ state: "idle", text: "本地就绪", short: "本地就绪" });
    const debugLogs = ref([]);
    const toast = reactive({ text: "", error: false, timer: null });
    const mascotLine = ref("写完就发……我会认真嘲笑，再认真记住。");
    const mascotLines = [
      "今天也把喜欢的作品记下来吧。",
      "只写一句也算记录，先按下发布吧。",
      "黑幕已经准备好，剧透要藏好。",
      "同步失败也不会影响本地日志。",
      "去年今天的你，也许会给你一点惊喜。",
      "封面会从 Bangumi 图床加载，点击卡片不会跳出应用。"
    ];
    let mascotLineIndex = 0;

    const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
    const calendarCursor = ref(new Date(
      appClock.value.getFullYear(),
      appClock.value.getMonth(),
      1
    ));
    const todayKey = computed(() => formatDateKey(appClock.value));
    const timelineFilters = [
      { value: "all", label: "全部" },
      { value: "note", label: "只看吐槽" },
      { value: "article", label: "只看长文" },
      { value: "images", label: "只看含图" }
    ];
    const postScopeFilters = [
      { value: "all", label: "全部" },
      { value: "daily", label: "日常吐槽" },
      { value: "works", label: "作品吐槽" }
    ];
    const subjectTypes = [
      { value: 2, label: "动画" },
      { value: 1, label: "书籍" },
      { value: 4, label: "游戏" },
      { value: 3, label: "音乐" },
      { value: 6, label: "三次元" },
      { value: 0, label: "生活事件" }
    ];
    const subjectCategories = [
      { value: "2", label: "动画" },
      { value: "1", label: "书籍" },
      { value: "4", label: "游戏" },
      { value: "3", label: "音乐" },
      { value: "6", label: "三次元" }
    ];
    const collectionStatuses = [
      { value: 1, label: "想看" },
      { value: 2, label: "看过" },
      { value: 3, label: "在看" },
      { value: 4, label: "搁置" },
      { value: 5, label: "抛弃" }
    ];
    const kaomojiList = ["(=A=)", "(=w=)", "(-w-)", "(>_<)", "(T_T)", "ヽ(≧Д≦)ノ", "(￣▽￣)", "(・ω・)", "_(:з」∠)_", "(｡･ω･｡)"];
    const standardEmoji = ["😀", "😄", "🥲", "😭", "😴", "😡", "🤔", "🥳", "✨", "❤️", "👍", "👀", "🎉", "📝", "📚", "🎮", "🎬", "🎧", "☕", "🌙"]; // taste-skill-ignore: user-requested standard emoji picker content.
    const tvEmojiNumbers = Array.from({ length: 102 }, (_value, index) => index + 24);

    let scheduledSave = null;
    let saveChain = Promise.resolve();
    let scheduledFolderSnapshot = null;
    let folderSyncTimer = null;
    let folderSyncBusy = false;

    function appendDebug(text, level = "info") {
      const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      debugLogs.value.unshift({ time, text: String(text), level });
      if (debugLogs.value.length > 140) debugLogs.value.length = 140;
    }
    reportRendererError = (message) => appendDebug(message, "error");

    function showToast(text, isError = false, duration = 2600) {
      if (toast.timer) clearTimeout(toast.timer);
      toast.text = text;
      toast.error = isError;
      toast.timer = setTimeout(() => {
        toast.text = "";
        toast.timer = null;
      }, duration);
    }

    function updateMascot(text) {
      if (text) mascotLine.value = text;
    }

    function cycleMascotLine() {
      mascotLineIndex = (mascotLineIndex + 1) % mascotLines.length;
      mascotLine.value = mascotLines[mascotLineIndex];
    }

    function snapshotDatabase() {
      return JSON.parse(JSON.stringify(database.value));
    }

    function markSyncDeleted(kind, id) {
      const value = String(id || "");
      if (!value || !database.value.syncTombstones?.[kind]) return;
      database.value.syncTombstones[kind][value] = new Date().toISOString();
    }

    function folderSyncFilename() {
      return `bgm-blog-sync-${getSyncDeviceId()}.json`;
    }

    function createFolderSnapshot() {
      return window.FolderSync.createSnapshot({
        database: snapshotDatabase(),
        deviceId: getSyncDeviceId(),
        platform: window.bgmPlatform?.name || "unknown",
        savedAt: new Date().toISOString()
      });
    }

    async function refreshFolderSyncInfo(showError = false) {
      if (!folderSyncCapable) return;
      const result = await window.bgmApi.getFolderSyncInfo();
      if (!result?.ok) {
        folderSyncState.state = "error";
        folderSyncState.text = result?.error || "同步目录读取失败。";
        if (showError) showToast(folderSyncState.text, true);
        return result;
      }
      folderSyncState.configured = Boolean(result.configured);
      folderSyncState.folderPath = result.folderPath || "";
      folderSyncState.state = result.configured ? "ok" : "idle";
      folderSyncState.text = result.configured ? "Syncthing 文件夹已配置" : "请选择 Syncthing 同步文件夹";
      return result;
    }

    async function chooseFolderSyncFolder() {
      if (!folderSyncCapable) return;
      const result = await window.bgmApi.chooseFolderSyncFolder();
      if (!result?.ok) {
        if (!result?.canceled) showToast(result?.error || "同步文件夹选择失败。", true);
        return;
      }
      folderSyncState.configured = true;
      folderSyncState.folderPath = result.folderPath || "";
      folderSyncState.state = "ok";
      folderSyncState.text = "Syncthing 文件夹已配置";
      showToast("同步文件夹已设置。");
      await syncFolderNow({ quiet: false });
    }

    async function openFolderSyncFolder() {
      if (!folderSyncCapable) return;
      const result = await window.bgmApi.openFolderSyncFolder();
      if (!result?.ok && !result?.canceled) showToast(result?.error || "无法打开同步文件夹。", true);
    }

    async function writeLocalFolderSnapshot() {
      if (!folderSyncCapable || !folderSyncState.configured) return { ok: false, configured: false };
      return window.bgmApi.writeFolderSyncSnapshot({
        filename: folderSyncFilename(),
        data: createFolderSnapshot()
      });
    }

    function scheduleFolderSnapshot() {
      if (!folderSyncCapable || !folderSyncState.configured) return;
      if (scheduledFolderSnapshot) clearTimeout(scheduledFolderSnapshot);
      scheduledFolderSnapshot = setTimeout(() => {
        scheduledFolderSnapshot = null;
        void writeLocalFolderSnapshot().then((result) => {
          if (result && !result.ok) appendDebug(`同步快照写入失败：${result.error}`, "error");
        });
      }, 1500);
    }

    async function syncFolderNow({ quiet = false } = {}) {
      if (!folderSyncCapable || folderSyncBusy) return { ok: false, busy: folderSyncBusy };
      if (!databaseLoaded) return { ok: false, notReady: true };
      if (!folderSyncState.configured) await refreshFolderSyncInfo(quiet === false);
      if (!folderSyncState.configured) {
        if (!quiet) showToast("请先选择 Syncthing 同步文件夹。", true);
        return { ok: false, configured: false };
      }
      folderSyncBusy = true;
      folderSyncState.busy = true;
      folderSyncState.state = "active";
      folderSyncState.text = "正在同步文件夹…";
      try {
        const localSave = await persistDatabase();
        if (!localSave?.ok) throw new Error(localSave?.error || "本地数据库保存失败。");
        const writeResult = await writeLocalFolderSnapshot();
        if (!writeResult?.ok) throw new Error(writeResult?.error || "同步快照写入失败。");
        const readResult = await window.bgmApi.readFolderSyncSnapshots();
        if (!readResult?.ok) throw new Error(readResult?.error || "同步快照读取失败。");
        const merged = window.FolderSync.mergeSnapshots(
          database.value,
          readResult.snapshots || [],
          { now: new Date().toISOString() }
        );
        const previousDatabase = database.value;
        const normalized = normalizeDatabase(merged);
        database.value = normalized;
        const importedComments = await importCollectionComments({ silent: true, persist: false });
        const changed = window.FolderSync.hasChanges(previousDatabase, database.value);
        if (changed) {
          theme.value = database.value.settings.theme === "dark" ? "dark" : "light";
          applyTheme();
          await persistDatabase();
        }
        folderSyncState.configured = true;
        folderSyncState.folderPath = readResult.folderPath || writeResult.folderPath || folderSyncState.folderPath;
        folderSyncState.lastAt = new Date().toISOString();
        folderSyncState.state = "ok";
        folderSyncState.text = importedComments
          ? `已合并记录并导入 ${importedComments} 条 Bangumi 漫评`
          : changed ? "已合并其他设备的新记录" : "同步完成，没有新记录";
        appendDebug(
          `Syncthing 文件夹同步完成${changed ? "并合并了新记录" : ""}${importedComments ? `，自动导入 ${importedComments} 条 Bangumi 漫评` : ""}`,
          "success"
        );
        if (!quiet) showToast(folderSyncState.text);
        return { ok: true, changed };
      } catch (error) {
        folderSyncState.state = "error";
        folderSyncState.text = `文件夹同步失败：${error.message}`;
        appendDebug(folderSyncState.text, "error");
        if (!quiet) showToast(folderSyncState.text, true, 5000);
        return { ok: false, error: error.message };
      } finally {
        folderSyncBusy = false;
        folderSyncState.busy = false;
      }
    }

    function persistDatabase() {
      const snapshot = snapshotDatabase();
      try {
        localStorage.setItem("bgm-local-blog-last-saved-at", new Date().toISOString());
      } catch {
        // The JSON database remains the primary storage.
      }
      saveChain = saveChain
        .then(() => window.bgmApi.saveDatabase(snapshot))
        .then((result) => {
          if (result && !result.ok) appendDebug(`本地保存失败：${result.error}`, "error");
          if (result?.ok) scheduleFolderSnapshot();
          return result;
        })
        .catch((error) => {
          appendDebug(`本地保存异常：${error.message}`, "error");
          return { ok: false, error: error.message };
        });
      return saveChain;
    }

    function schedulePersist() {
      if (scheduledSave) clearTimeout(scheduledSave);
      scheduledSave = setTimeout(() => {
        scheduledSave = null;
        persistDatabase();
      }, 350);
      return undefined;
    }

    watch(database, (value) => {
      rendererDatabase = value;
      schedulePersist();
    }, { deep: true });

    function hexToRgb(hex) {
      const normalized = /^#[0-9a-f]{6}$/i.test(String(hex)) ? String(hex) : DEFAULT_ACCENT;
      return [
        Number.parseInt(normalized.slice(1, 3), 16),
        Number.parseInt(normalized.slice(3, 5), 16),
        Number.parseInt(normalized.slice(5, 7), 16)
      ];
    }

    function mixRgb(source, target, ratio) {
      return source.map((value, index) => Math.round(value + (target[index] - value) * ratio));
    }

    function rgbToHex(rgb) {
      return `#${rgb.map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
    }

    function applyAppearance() {
      const accent = /^#[0-9a-f]{6}$/i.test(database.value.settings.accentColor || "")
        ? database.value.settings.accentColor
        : DEFAULT_ACCENT;
      const rgb = hexToRgb(accent);
      const isDark = theme.value === "dark";
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty("--accent", accent);
      rootStyle.setProperty("--accent-hover", rgbToHex(mixRgb(rgb, [255, 255, 255], isDark ? 0.2 : 0.16)));
      rootStyle.setProperty("--accent-ink", rgbToHex(mixRgb(rgb, isDark ? [255, 255, 255] : [20, 20, 20], isDark ? 0.52 : 0.46)));
      rootStyle.setProperty("--accent-tint", rgbToHex(mixRgb(rgb, isDark ? [31, 31, 31] : [255, 255, 255], isDark ? 0.84 : 0.95)));
      rootStyle.setProperty("--accent-tint-strong", rgbToHex(mixRgb(rgb, isDark ? [31, 31, 31] : [255, 255, 255], isDark ? 0.72 : 0.86)));
      rootStyle.setProperty("--app-bg-image", database.value.settings.backgroundImage
        ? `url("${database.value.settings.backgroundImage}")`
        : "none");
      rootStyle.setProperty("--app-bg-opacity", String(
        Math.max(0, Math.min(0.75, Number(database.value.settings.backgroundOpacity) || 0))
      ));
    }

    function applyTheme() {
      document.documentElement.dataset.theme = theme.value;
      database.value.settings.theme = theme.value;
      localStorage.setItem(STORAGE_THEME_KEY, theme.value);
      applyAppearance();
    }

    function toggleTheme() {
      theme.value = theme.value === "dark" ? "light" : "dark";
      applyTheme();
      showToast(theme.value === "dark" ? "已切换到深色模式。" : "已切换到浅色模式。");
    }

    function setAccentColor(value) {
      if (!/^#[0-9a-f]{6}$/i.test(String(value || ""))) return;
      database.value.settings.accentColor = value;
      applyAppearance();
      showToast("主题色已更新。");
    }

    function triggerBackgroundPicker() {
      backgroundInput.value?.click();
    }

    async function handleBackgroundFile(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        database.value.settings.backgroundImage = await compressImage(file, 2400, 0.78);
        database.value.settings.backgroundOpacity = 0.3;
        applyAppearance();
        await persistDatabase();
        showToast("背景图片已保存到本地。");
      } catch (error) {
        showToast(`背景图片处理失败：${error.message}`, true);
      }
    }

    function removeBackground() {
      database.value.settings.backgroundImage = "";
      applyAppearance();
      showToast("背景图片已移除。");
    }

    watch(
      () => [
        database.value.settings.accentColor,
        database.value.settings.backgroundImage,
        database.value.settings.backgroundOpacity,
        theme.value
      ],
      applyAppearance
    );

    const allPostsSorted = computed(() => {
      return [...database.value.posts].sort((left, right) => {
        if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
    });

    const normalisedSearch = computed(() => searchTerm.value.toLowerCase());

    function postMatchesSearch(post) {
      if (!normalisedSearch.value) return true;
      const haystack = [
        post.title,
        post.content,
        post.category,
        ...(post.tags || []),
        post.subject?.name
      ].join(" ").toLowerCase();
      return haystack.includes(normalisedSearch.value);
    }

    const filteredTimelinePosts = computed(() => {
      return allPostsSorted.value.filter((post) => {
        if (postScopeFilter.value === "daily" && post.subject) return false;
        if (postScopeFilter.value === "works" && !post.subject) return false;
        if (!postMatchesSearch(post)) return false;
        if (timelineFilter.value === "note" && post.kind !== "note") return false;
        if (timelineFilter.value === "article" && post.kind !== "article") return false;
        if (timelineFilter.value === "images" && !post.images?.length) return false;
        if (selectedDateKey.value && formatDateKey(post.createdAt) !== selectedDateKey.value) return false;
        if (activeMonth.value && formatMonthKey(post.createdAt) !== activeMonth.value) return false;
        if (activeTag.value && !visiblePostTags(post).some((tag) => tag.toLowerCase() === activeTag.value.toLowerCase())) return false;
        if (activeEmotion.value && !new RegExp(`\\(${activeEmotion.value.replace(/[()]/g, "\\$&")}\\)`, "i").test(post.content)) return false;
        return true;
      });
    });

    const displayedTimelinePosts = computed(() =>
      filteredTimelinePosts.value.slice(0, visiblePostLimit.value)
    );

    function timelinePeriod(value) {
      const hour = new Date(value).getHours();
      if (hour < 6) return { key: "late", label: "凌晨", order: 0 };
      if (hour < 12) return { key: "morning", label: "上午", order: 1 };
      if (hour < 18) return { key: "afternoon", label: "下午", order: 2 };
      return { key: "evening", label: "晚上", order: 3 };
    }

    function timelineDayLabel(key) {
      const date = new Date(`${key}T12:00:00`);
      const weekdayIndex = (date.getDay() + 6) % 7;
      if (key === todayKey.value) return `今天 · ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
      if (key === formatDateKey(new Date(appClock.value.getTime() - 86400000))) {
        return `昨天 · ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
      }
      return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · 周${weekdays[weekdayIndex]}`;
    }

    const timelineDayGroups = computed(() => {
      const pinnedPosts = displayedTimelinePosts.value
        .filter((post) => post.pinned)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
      const groups = [];
      if (pinnedPosts.length) {
        groups.push({
          key: "pinned",
          label: "置顶记录",
          count: pinnedPosts.length,
          words: pinnedPosts.reduce((sum, post) => sum + countWords(post.content), 0),
          periods: [{ key: "pinned", label: "", order: 0, posts: pinnedPosts }]
        });
      }

      const byDate = new Map();
      for (const post of displayedTimelinePosts.value) {
        if (post.pinned) continue;
        const dayKey = formatDateKey(post.createdAt);
        if (!dayKey) continue;
        if (!byDate.has(dayKey)) byDate.set(dayKey, []);
        byDate.get(dayKey).push(post);
      }
      for (const [dayKey, posts] of [...byDate.entries()].sort(([left], [right]) => right.localeCompare(left))) {
        const byPeriod = new Map();
        for (const post of posts) {
          const period = timelinePeriod(post.createdAt);
          if (!byPeriod.has(period.key)) byPeriod.set(period.key, { ...period, posts: [] });
          byPeriod.get(period.key).posts.push(post);
        }
        const periods = [...byPeriod.values()]
          .sort((left, right) => left.order - right.order)
          .map((period) => ({
            ...period,
            posts: period.posts.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
          }));
        groups.push({
          key: dayKey,
          label: timelineDayLabel(dayKey),
          count: posts.length,
          words: posts.reduce((sum, post) => sum + countWords(post.content), 0),
          periods
        });
      }
      return groups;
    });

    const hiddenTimelinePostCount = computed(() =>
      Math.max(0, filteredTimelinePosts.value.length - displayedTimelinePosts.value.length)
    );

    watch(
      [postScopeFilter, timelineFilter, selectedDateKey, activeTag, activeMonth, activeEmotion, searchTerm],
      () => {
        visiblePostLimit.value = timelinePageSize;
      }
    );

    function showMoreTimelinePosts() {
      visiblePostLimit.value += timelinePageSize;
    }

    const postScopeCounts = computed(() => ({
      all: database.value.posts.length,
      daily: database.value.posts.filter((post) => !post.subject).length,
      works: database.value.posts.filter((post) => Boolean(post.subject)).length
    }));

    const hasActiveTimelineFilter = computed(() =>
      postScopeFilter.value !== "all" ||
      timelineFilter.value !== "all" ||
      Boolean(selectedDateKey.value || activeTag.value || activeMonth.value || activeEmotion.value || searchTerm.value)
    );

    const activeFilterSummary = computed(() => {
      const parts = [];
      if (searchTerm.value) parts.push(`搜索“${searchTerm.value}”`);
      if (postScopeFilter.value !== "all") {
        parts.push(postScopeFilter.value === "daily" ? "日常吐槽" : "作品吐槽");
      }
      if (selectedDateKey.value) parts.push(selectedDateKey.value);
      if (activeTag.value) parts.push(`#${activeTag.value}`);
      if (activeMonth.value) parts.push(activeMonth.value.replace("-", " 年 ") + " 月");
      if (activeEmotion.value) parts.push(`(${activeEmotion.value})`);
      return parts.join(" · ") || "当前筛选";
    });

    function visiblePostTags(post) {
      const tags = new Set((post.tags || []).filter(Boolean));
      const contentTags = String(post.content || "").match(/(^|\s)#([\p{L}\p{N}_-]+)/gu) || [];
      for (const match of contentTags) {
        const tag = match.replace(/^\s*#/, "");
        if (tag) tags.add(tag);
      }
      return [...tags].slice(0, 8);
    }

    const tagCounts = computed(() => {
      const counts = new Map();
      for (const post of database.value.posts) {
        for (const tag of visiblePostTags(post)) {
          counts.set(tag, (counts.get(tag) || 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"));
    });

    const topTags = computed(() => tagCounts.value.slice(0, 14));

    const monthlyArchives = computed(() => {
      const counts = new Map();
      for (const post of database.value.posts) {
        const key = formatMonthKey(post.createdAt);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([key, count]) => ({ key, count, label: key.replace("-", ".") }))
        .sort((left, right) => right.key.localeCompare(left.key))
        .slice(0, 12);
    });

    const postsByDate = computed(() => {
      const counts = new Map();
      const words = new Map();
      for (const post of database.value.posts) {
        const key = formatDateKey(post.createdAt);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
        words.set(key, (words.get(key) || 0) + countWords(post.content));
      }
      return { counts, words };
    });

    const calendarTitle = computed(() => {
      const date = calendarCursor.value;
      return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
    });

    const calendarDays = computed(() => {
      const year = calendarCursor.value.getFullYear();
      const month = calendarCursor.value.getMonth();
      const first = new Date(year, month, 1);
      const offset = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const cells = [];
      for (let index = 0; index < offset; index += 1) {
        cells.push({ key: "", label: "", labelNumber: "", classes: "blank" });
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = postsByDate.value.counts.get(key) || 0;
        const words = postsByDate.value.words.get(key) || 0;
        let heat = 0;
        if (words > 0) heat = 1;
        if (words >= 50) heat = 2;
        if (words >= 150) heat = 3;
        const classes = [
          count ? "has-record" : "",
          count ? `heat-${heat}` : "",
          key === todayKey.value ? "today" : ""
        ].filter(Boolean).join(" ");
        cells.push({
          key,
          label: `${key}，${count} 条日志，${words} 字`,
          labelNumber: String(day),
          classes
        });
      }
      while (cells.length % 7 !== 0) {
        cells.push({ key: "", label: "", labelNumber: "", classes: "blank" });
      }
      return cells;
    });

    const yearAgoPost = computed(() => {
      const now = appClock.value;
      return [...database.value.posts]
        .filter((post) => {
          const date = new Date(post.createdAt);
          return !Number.isNaN(date.getTime()) &&
            date.getFullYear() < now.getFullYear() &&
            date.getMonth() === now.getMonth() &&
            date.getDate() === now.getDate();
        })
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0] || null;
    });

    const yearAgoDateLabel = computed(() => `${
      appClock.value.getMonth() + 1
    } 月 ${appClock.value.getDate()} 日`);

    function scheduleDateRefresh() {
      if (dateRolloverTimer) clearTimeout(dateRolloverTimer);
      const now = new Date();
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
        50
      );
      const delay = Math.max(1000, Math.min(nextDay.getTime() - now.getTime(), 2147483647));
      dateRolloverTimer = setTimeout(() => {
        dateRolloverTimer = null;
        refreshCurrentDate();
      }, delay);
    }

    function refreshCurrentDate(candidate = new Date()) {
      const nextDate = candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate);
      if (Number.isNaN(nextDate.getTime())) return false;
      void checkScheduledPeriodReports();
      const previousDate = appClock.value;
      const previousKey = formatDateKey(previousDate);
      const nextKey = formatDateKey(nextDate);
      if (previousKey === nextKey) {
        appClock.value = nextDate;
        scheduleDateRefresh();
        return false;
      }

      const calendarWasOnPreviousCurrentMonth =
        calendarCursor.value.getFullYear() === previousDate.getFullYear() &&
        calendarCursor.value.getMonth() === previousDate.getMonth();

      appClock.value = nextDate;
      if (calendarWasOnPreviousCurrentMonth) {
        calendarCursor.value = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
      }
      if (selectedDateKey.value === previousKey) {
        selectedDateKey.value = nextKey;
      }
      if (
        previousDate.getFullYear() !== nextDate.getFullYear() &&
        yearbookYear.value === previousDate.getFullYear()
      ) {
        const previousComparisonYear = previousDate.getFullYear() - 1;
        yearbookYear.value = nextDate.getFullYear();
        if (yearbookComparisonYear.value === previousComparisonYear) {
          yearbookComparisonYear.value = nextDate.getFullYear() - 1;
        }
      }

      appendDebug(`日期已自动切换：${previousKey} → ${nextKey}`, "success");
      scheduleDateRefresh();
      return true;
    }

    function handleVisibilityRefresh() {
      if (!document.hidden) {
        refreshCurrentDate();
        void syncFolderNow({ quiet: true });
      }
    }

    function handleWindowDateRefresh() {
      refreshCurrentDate();
      void syncFolderNow({ quiet: true });
    }

    function startDateRefreshWatch() {
      scheduleDateRefresh();
      dateCheckInterval = setInterval(() => refreshCurrentDate(), 60000);
      document.addEventListener("visibilitychange", handleVisibilityRefresh);
      window.addEventListener("focus", handleWindowDateRefresh);
      window.addEventListener("pageshow", handleWindowDateRefresh);
      unsubscribeSystemResume = window.bgmApi.onSystemResume?.(() => {
        refreshCurrentDate();
        void syncFolderNow({ quiet: true });
      });
    }

    function stopDateRefreshWatch() {
      if (dateRolloverTimer) clearTimeout(dateRolloverTimer);
      if (dateCheckInterval) clearInterval(dateCheckInterval);
      dateRolloverTimer = null;
      dateCheckInterval = null;
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleWindowDateRefresh);
      window.removeEventListener("pageshow", handleWindowDateRefresh);
      unsubscribeSystemResume?.();
      unsubscribeSystemResume = null;
    }

    function moveCalendarMonth(delta) {
      calendarCursor.value = new Date(
        calendarCursor.value.getFullYear(),
        calendarCursor.value.getMonth() + delta,
        1
      );
    }

    function selectCalendarDate(day) {
      if (!day.key) return;
      selectedDateKey.value = day.key;
      activeMonth.value = "";
      activeTag.value = "";
      activeEmotion.value = "";
      currentTab.value = "timeline";
      currentArticle.value = null;
      showToast(`正在查看 ${day.key} 的记录。`);
    }

    function setTimelineFilter(value) {
      timelineFilter.value = value;
    }

    function setPostScope(value) {
      postScopeFilter.value = value;
    }

    function clearTimelineFilters() {
      postScopeFilter.value = "all";
      timelineFilter.value = "all";
      selectedDateKey.value = "";
      activeTag.value = "";
      activeMonth.value = "";
      activeEmotion.value = "";
      searchTerm.value = "";
    }

    function filterByTag(tag) {
      activeTag.value = tag;
      activeMonth.value = "";
      selectedDateKey.value = "";
      activeEmotion.value = "";
      currentTab.value = "timeline";
      currentArticle.value = null;
      showToast(`已筛选 #${tag}。`);
    }

    function clearTagFilter() {
      activeTag.value = "";
    }

    function filterByMonth(key) {
      activeMonth.value = key;
      activeTag.value = "";
      selectedDateKey.value = "";
      activeEmotion.value = "";
      currentTab.value = "timeline";
      currentArticle.value = null;
      showToast(`已筛选 ${key.replace("-", " 年 ")} 月。`);
    }

    function filterByEmotion(code) {
      activeEmotion.value = code;
      activeTag.value = "";
      activeMonth.value = "";
      selectedDateKey.value = "";
      currentTab.value = "timeline";
      showToast(`已筛选包含 ${code} 的记录。`);
    }

    function runGlobalSearch() {
      if (!searchTerm.value) {
        showToast("输入标题、正文、Tag 或 (bgm编号) 后即可搜索。");
        return;
      }
      if (currentTab.value !== "timeline" && currentTab.value !== "blog") currentTab.value = "timeline";
      showToast(`找到 ${filteredTimelinePosts.value.length} 条包含“${searchTerm.value}”的记录。`);
    }

    const profileInitial = computed(() => {
      const name = database.value.profile?.nickname || database.value.profile?.username || "我";
      return Array.from(String(name).trim())[0] || "我";
    });

    const timelineFinding = computed(() => {
      const todayCount = database.value.posts.filter((post) => formatDateKey(post.createdAt) === todayKey.value).length;
      return `即时记录 ${database.value.posts.length} 条，今天写下 ${todayCount} 条。所有内容先保存到本机。`;
    });

    const subjectFinding = computed(() => {
      const total = database.value.collections.length;
      const doing = database.value.collections.filter((subject) => Number(subject.status) === 3).length;
      return total ? `全量收藏 ${total} 部，其中 ${doing} 部正在看或正在玩。` : "同步后可按作品类型与收藏状态筛选全部档案。";
    });

    const subjectCacheSubjects = computed(() => Object.values(database.value.subjectCache || {}).map(normalizeSubject));

    const allSubjects = computed(() => {
      const map = new Map();
      for (const subject of database.value.collections) map.set(subject.key, subject);
      for (const subject of subjectCacheSubjects.value) {
        if (!subject?.bangumiId) continue;
        const existing = map.get(subject.key);
        map.set(subject.key, existing ? mergeSubjects(existing, subject) : subject);
      }
      for (const post of database.value.posts) {
        if (!post.subject) continue;
        const subject = normalizeSubject(post.subject);
        if (!subject) continue;
        const existing = map.get(subject.key);
        map.set(subject.key, existing ? mergeSubjects(existing, subject) : subject);
      }
      return [...map.values()].sort((left, right) => {
        const leftDate = new Date(left.updatedAt || 0).getTime();
        const rightDate = new Date(right.updatedAt || 0).getTime();
        return rightDate - leftDate || left.name.localeCompare(right.name, "zh-CN");
      });
    });

    const subjectCategoryCounts = computed(() => {
      const counts = new Map(subjectCategories.map((category) => [category.value, 0]));
      for (const subject of allSubjects.value) {
        const type = Number(subject.type);
        const key = ["1", "2", "3", "4", "6"].includes(String(type)) ? String(type) : "other";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return subjectCategories.map((category) => ({
        ...category,
        count: counts.get(category.value) || 0
      }));
    });
    const currentSubjectCategoryLabel = computed(() =>
      `${subjectCategories.find((category) => category.value === subjectTypeFilter.value)?.label || "作品"}档案`
    );

    const filteredSubjects = computed(() => {
      return allSubjects.value.filter((subject) => {
        if (String(subject.type) !== String(subjectTypeFilter.value)) {
          return false;
        }
        if (subjectStatusFilter.value !== "all" && String(subject.status) !== String(subjectStatusFilter.value)) return false;
        if (normalisedSearch.value && !`${subject.name} ${subject.originalName} ${subject.comment}`.toLowerCase().includes(normalisedSearch.value)) return false;
        return true;
      });
    });

    function setSubjectCategory(value) {
      subjectTypeFilter.value = String(value);
      subjectStatusFilter.value = "all";
    }

    function resetSubjectFilters() {
      const populated = subjectCategoryCounts.value.find((category) => category.count > 0);
      subjectTypeFilter.value = populated?.value || "2";
      subjectStatusFilter.value = "all";
      searchTerm.value = "";
    }

    const watchingSubjects = computed(() => {
      return allSubjects.value.filter((subject) => Number(subject.status) === 3).slice(0, 6);
    });

    function currentQueueSubject(item) {
      const current = allSubjects.value.find((subject) => subject.key === item.subjectKey);
      return current ? mergeSubjects(item.subject, current) : item.subject;
    }

    const queueLanes = computed(() => {
      const queue = Array.isArray(database.value.watchQueue) ? database.value.watchQueue : [];
      return QUEUE_TYPES.map((type) => {
        const active = queue
          .filter((item) => Number(item.type) === Number(type.value) && !item.completedAt)
          .map((item) => ({ ...item, subject: currentQueueSubject(item) }))
          .sort((left, right) => left.order - right.order || new Date(left.addedAt) - new Date(right.addedAt));
        const completed = queue.filter((item) =>
          Number(item.type) === Number(type.value) && item.completedAt
        );
        return {
          ...type,
          active,
          next: active[0] || null,
          rest: active.slice(1),
          completedCount: completed.length
        };
      });
    });

    const queueActiveCount = computed(() =>
      queueLanes.value.reduce((sum, lane) => sum + lane.active.length, 0)
    );

    const queuePickerResults = computed(() => {
      const type = Number(queuePickerType.value);
      const query = queuePickerQuery.value.trim().toLowerCase();
      const activeKeys = new Set(
        (database.value.watchQueue || [])
          .filter((item) => !item.completedAt)
          .map((item) => item.subjectKey)
      );
      return allSubjects.value
        .filter((subject) =>
          Number(subject.type) === type &&
          !activeKeys.has(subject.key) &&
          (!query || `${subject.name} ${subject.originalName}`.toLowerCase().includes(query))
        )
        .sort((left, right) =>
          Number(right.status === 1) - Number(left.status === 1) ||
          left.name.localeCompare(right.name, "zh-CN")
        );
    });

    function openQueuePicker(type) {
      queuePickerType.value = String(type);
      queuePickerQuery.value = "";
      showQueuePicker.value = true;
    }

    function closeQueuePicker() {
      showQueuePicker.value = false;
    }

    async function addToNextQueue(subject) {
      const normalized = normalizeSubject(subject);
      if (!normalized || ![1, 2, 4].includes(Number(normalized.type))) return;
      const queue = database.value.watchQueue;
      const existing = queue.find((item) => item.subjectKey === normalized.key);
      const completedAt = null;
      if (existing) {
        existing.completedAt = completedAt;
        existing.subject = mergeSubjects(existing.subject, normalized);
      } else {
        const sameType = queue.filter((item) => Number(item.type) === Number(normalized.type));
        const order = sameType.length ? Math.max(...sameType.map((item) => Number(item.order) || 0)) + 1 : 0;
        queue.push({
          id: createId("queue"),
          subjectKey: normalized.key,
          subject: normalized,
          type: Number(normalized.type),
          order,
          addedAt: new Date().toISOString(),
          completedAt
        });
      }
      await persistDatabase();
      showToast(`已将《${normalized.name}》加入接下来。`);
    }

    async function removeQueueItem(item) {
      const index = database.value.watchQueue.findIndex((candidate) => candidate.id === item.id);
      if (index < 0) return;
      markSyncDeleted("watchQueue", item.id);
      database.value.watchQueue.splice(index, 1);
      await persistDatabase();
      showToast(`已从接下来移除《${item.subject?.name || "作品"}》。`);
    }

    async function moveQueueItem(item, direction) {
      const lane = queueLanes.value.find((entry) => Number(entry.value) === Number(item.type));
      if (!lane) return;
      const index = lane.active.findIndex((candidate) => candidate.id === item.id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= lane.active.length) return;
      const currentRecord = database.value.watchQueue.find((candidate) => candidate.id === item.id);
      const targetRecord = database.value.watchQueue.find((candidate) => candidate.id === lane.active[targetIndex].id);
      if (!currentRecord || !targetRecord) return;
      const currentOrder = currentRecord.order;
      currentRecord.order = targetRecord.order;
      targetRecord.order = currentOrder;
      await persistDatabase();
    }

    async function setQueueItemNext(item) {
      const lane = queueLanes.value.find((entry) => Number(entry.value) === Number(item.type));
      if (!lane?.active.length) return;
      const minimum = Math.min(...lane.active.map((entry) => Number(entry.order) || 0));
      const record = database.value.watchQueue.find((candidate) => candidate.id === item.id);
      if (!record) return;
      record.order = minimum - 1;
      await persistDatabase();
      showToast(`《${item.subject?.name || "这部作品"}》已设为下一部。`);
    }

    async function completeQueueItem(item) {
      const record = database.value.watchQueue.find((candidate) => candidate.id === item.id);
      if (!record) return;
      record.completedAt = new Date().toISOString();
      const next = (database.value.watchQueue || [])
        .filter((candidate) =>
          Number(candidate.type) === Number(item.type) &&
          !candidate.completedAt &&
          candidate.id !== item.id
        )
        .sort((left, right) => left.order - right.order)[0];
      await persistDatabase();
      const nextSubject = next ? currentQueueSubject(next) : null;
      showToast(
        nextSubject
          ? `完成《${item.subject?.name || "作品"}》。接下来${item.type === 4 ? "玩" : item.type === 1 ? "读" : "看"}《${nextSubject.name}》。`
          : `完成《${item.subject?.name || "作品"}》。这一分类暂时没有下一项。`
      );
    }

    function openQueueSubject(item) {
      if (item?.subject) void openSubjectDetail(item.subject);
    }

    const visibleQueueRecommendations = computed(() => {
      const activeKeys = new Set(
        (database.value.watchQueue || [])
          .filter((item) => !item.completedAt)
          .map((item) => item.subjectKey)
      );
      return queueRecommendationResults.value.filter((item) => !activeKeys.has(item.subject.key));
    });

    const visibleQueueRecommendationGroups = computed(() => {
      const definitions = [
        { source: "inventory", title: "从收藏补位", hint: "想看和搁置优先" },
        { source: "discovery", title: "新作发现", hint: "参考口味，不重复收藏" }
      ];
      return definitions
        .map((definition) => ({
          ...definition,
          items: visibleQueueRecommendations.value.filter((item) => item.source === definition.source)
        }))
        .filter((group) => group.items.length);
    });

    function recommendationSeedScore(subject, index) {
      const rating = Number(subject.myScore) || 0;
      const status = Number(subject.status) || 0;
      if (status === 5) return -20 + Math.max(0, 5 - rating) - index * 0.1;
      if (rating > 0 && rating <= 5) return -10 + (5 - rating) - index * 0.1;
      const statusBoost = status === 3 ? 5 : status === 1 || status === 4 ? 1.5 : 0;
      const ratingBoost = rating >= 6 ? rating : 0;
      return statusBoost + ratingBoost + Math.max(0, 3 - index * 0.1);
    }

    async function recommendationTagsForSeed(subject) {
      const cacheKey = `tags:${subject.bangumiId}`;
      if (queueRecommendationCache.has(cacheKey)) return queueRecommendationCache.get(cacheKey);
      if (Array.isArray(subject.tags) && subject.tags.length >= 4) {
        queueRecommendationCache.set(cacheKey, subject.tags);
        return subject.tags;
      }
      try {
        const raw = await bgmRequest(`/subjects/${subject.bangumiId}`, { quiet: true });
        const tags = (raw?.tags || [])
          .filter((tag) => tag?.name && Number(tag.count) >= 2)
          .sort((left, right) => Number(right.count) - Number(left.count))
          .slice(0, 12)
          .map((tag) => tag.name);
        queueRecommendationCache.set(cacheKey, tags);
        return tags;
      } catch (error) {
        appendDebug(`推荐标签读取失败 ${subject.name}：${error.message}`, "error");
        return [];
      }
    }

    async function mapWithConcurrency(items, limit, worker) {
      const results = new Array(items.length);
      let cursor = 0;
      const runners = Array.from(
        { length: Math.min(Math.max(1, limit), items.length) },
        async () => {
          while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
          }
        }
      );
      await Promise.all(runners);
      return results;
    }

    function isUsefulRecommendationTag(tag) {
      const value = String(tag || "").trim();
      if (!value || value.length > 12 || RECOMMENDATION_TAG_BLOCKLIST.has(value)) return false;
      if (/^(19|20)\d{2}(年|年代|年.+)?$/.test(value)) return false;
      if (/^\d+$/.test(value)) return false;
      return true;
    }

    async function refreshQueueRecommendations(force = false) {
      if (queueRecommendationLoading.value) return;
      const type = Number(queueRecommendationType.value);
      const typeInfo = QUEUE_TYPES.find((entry) => Number(entry.value) === type);
      if (!typeInfo) return;
      if (!force && queueRecommendationCache.has(`results:${type}`)) {
        const cached = queueRecommendationCache.get(`results:${type}`);
        queueRecommendationResults.value = cached.results;
        queueRecommendationNarrative.value = cached.narrative;
        queueRecommendationBasis.value = cached.basis;
        queueRecommendationProfile.value = cached.profile || null;
        return;
      }

      queueRecommendationLoading.value = true;
      queueRecommendationError.value = "";
      try {
        const engine = window.RecommendationEngine;
        if (!engine) throw new Error("推荐引擎未加载，请重新启动应用。");
        const typeSubjects = allSubjects.value.filter((subject) =>
          Number(subject.type) === type && subject.bangumiId
        );
        const positiveSeeds = typeSubjects
          .filter((subject) =>
            Number(subject.status) === 3 ||
            Number(subject.myScore) >= 7
          )
          .map((subject, index) => ({ subject, index, weight: recommendationSeedScore(subject, index) }))
          .sort((left, right) => right.weight - left.weight || new Date(right.subject.updatedAt) - new Date(left.subject.updatedAt))
          .slice(0, 5)
          .map((entry) => entry.subject);
        const negativeSeeds = typeSubjects
          .filter((subject) =>
            Number(subject.status) === 5 ||
            (Number(subject.myScore) > 0 && Number(subject.myScore) <= 5)
          )
          .sort((left, right) =>
            recommendationSeedScore(left, 0) - recommendationSeedScore(right, 0) ||
            new Date(right.updatedAt) - new Date(left.updatedAt)
          )
          .slice(0, 2);
        const inventorySeeds = typeSubjects
          .filter((subject) => [1, 4].includes(Number(subject.status)))
          .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
          .slice(0, 8);
        const seedSelection = [...new Map(
          [...positiveSeeds, ...negativeSeeds, ...inventorySeeds].map((subject) => [subject.key, subject])
        ).values()].slice(0, 15);
        if (!seedSelection.length) throw new Error("这个分类还没有足够的在看、评分或库存记录。");

        const taggedSeeds = (await mapWithConcurrency(seedSelection, 3, async (subject) => ({
          subject,
          tags: await recommendationTagsForSeed(subject)
        }))).filter((entry) => entry.tags.length);
        const profileSubjects = taggedSeeds.map((entry) => ({
          ...entry.subject,
          tags: entry.tags
        }));
        const profile = engine.buildTasteProfile(profileSubjects, {
          blocklist: RECOMMENDATION_TAG_BLOCKLIST
        });
        const topTags = profile.favoriteTags
          .map((entry) => entry.name)
          .filter(isUsefulRecommendationTag)
          .slice(0, 4);
        if (!topTags.length) throw new Error("还不能从收藏和高低分记录中提取足够的偏好标签。");

        const ownedIds = new Set(allSubjects.value.map((subject) => Number(subject.bangumiId)));
        const candidateMap = new Map();
        const searchRound = force ? ++queueRecommendationRound : queueRecommendationRound;
        await mapWithConcurrency(topTags, 3, async (tag, tagIndex) => {
          const offset = (searchRound * 20 + tagIndex * 7) % 80;
          let response;
          try {
            response = await bgmRequest(`/search/subjects?limit=20&offset=${offset}`, {
              method: "POST",
              quiet: true,
              body: {
                keyword: "",
                sort: "score",
                filter: {
                  type: [type],
                  tag: [tag],
                  rating: [">=6.5"],
                  rating_count: [">=30"],
                  nsfw: false
                }
              }
            });
          } catch (error) {
            appendDebug(`推荐标签「${tag}」搜索失败：${error.message}`, "error");
            return;
          }
          for (const raw of Array.isArray(response?.data) ? response.data : []) {
            const subject = normalizeSubject(raw);
            if (!subject?.bangumiId || ownedIds.has(Number(subject.bangumiId))) continue;
            const existing = candidateMap.get(subject.key);
            const score = Number(raw.rating?.score) || 0;
            const receivedTags = Array.isArray(raw.tags) ? raw.tags.map((entry) => entry.name).filter(Boolean) : [];
            if (!existing) {
              candidateMap.set(subject.key, {
                subject,
                ratingScore: score,
                ratingCount: Number(raw.rating?.total) || 0,
                doingCount: Number(raw.collection?.doing) || 0,
                matchedTags: [tag],
                tags: receivedTags.slice(0, 5)
              });
            } else if (!existing.matchedTags.includes(tag)) {
              existing.matchedTags.push(tag);
              existing.ratingScore = Math.max(existing.ratingScore, score);
            }
          }
        });

        const inventory = taggedSeeds
          .filter((entry) => [1, 4].includes(Number(entry.subject.status)))
          .map((entry) => ({
            subject: entry.subject,
            tags: entry.tags,
            ratingScore: Number(entry.subject.score) || 0,
            ratingCount: 0,
            doingCount: 0
          }));
        const excludedKeys = new Set(
          allSubjects.value
            .filter((subject) => !([1, 4].includes(Number(subject.status))))
            .map((subject) => subject.key)
        );
        const queuedKeys = new Set(
          (database.value.watchQueue || [])
            .filter((item) => !item.completedAt)
            .map((item) => item.subjectKey)
        );
        const ranked = engine.rankRecommendations({
          profile,
          inventory,
          discovery: [...candidateMap.values()],
          queuedKeys,
          excludedKeys,
          inventoryLimit: 3,
          discoveryLimit: 5
        });
        const results = [...ranked.inventory, ...ranked.discovery];
        if (!results.length) throw new Error("Bangumi 暂时没有返回合适的候选。");

        const inventoryNote = ranked.inventory.length
          ? `先还${ranked.inventory.length}笔库存债，再拿${ranked.discovery.length}部新作试探。`
          : `库存里没挑出合适的，先给你${ranked.discovery.length}部新作。`;
        queueRecommendationResults.value = results;
        queueRecommendationNarrative.value = `${engine.buildRecommendationNarrative(profile)}${inventoryNote}`;
        queueRecommendationBasis.value = topTags;
        queueRecommendationProfile.value = profile;
        queueRecommendationCache.set(`results:${type}`, {
          results,
          narrative: queueRecommendationNarrative.value,
          basis: topTags,
          profile
        });
      } catch (error) {
        queueRecommendationError.value = error.message;
        queueRecommendationResults.value = [];
        queueRecommendationNarrative.value = "我还没找到足够可靠的偏好线索。多同步一些收藏、评分或在看作品后再来问我。";
        queueRecommendationBasis.value = [];
        queueRecommendationProfile.value = null;
        appendDebug(`春菜推荐失败：${error.message}`, "error");
      } finally {
        queueRecommendationLoading.value = false;
      }
    }

    function selectQueueRecommendationType(type) {
      queueRecommendationType.value = String(type);
      void refreshQueueRecommendations(false);
    }

    const currentAiringWeekday = computed(() => {
      const day = appClock.value.getDay();
      return day === 0 ? 7 : day;
    });

    const todayAiringAll = computed(() => {
      const day = airingCalendarDays.value.find((entry) =>
        Number(entry.weekday?.id) === currentAiringWeekday.value
      );
      return (day?.items || []).map((item) => ({
        ...item,
        subject: normalizeSubject(item),
        score: Number(item.rating?.score) || 0,
        doing: Number(item.collection?.doing) || 0
      }));
    });

    const visibleTodayAiringAll = computed(() =>
      showAllAiring.value ? todayAiringAll.value : todayAiringAll.value.slice(0, 12)
    );

    const airingCalendarItemMap = computed(() => {
      const map = new Map();
      for (const day of airingCalendarDays.value) {
        for (const item of day.items || []) {
          map.set(Number(item.id), item);
        }
      }
      return map;
    });

    function parseAiringDate(episode) {
      const value = String(episode?.airdate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      return new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10))
      );
    }

    function nextUnwatchedEpisode(subject) {
      const episodes = database.value.calendarCache?.episodes?.[subject.bangumiId] ||
        database.value.episodeCache?.[subject.bangumiId] ||
        [];
      const watched = Number(subject.episode) || 0;
      const next = episodes
        .filter((episode) => Number(episode.type) === 0 && Number(episode.sort || episode.ep || 0) > watched)
        .sort((left, right) => Number(left.sort || left.ep || 0) - Number(right.sort || right.ep || 0))[0];
      if (!next) return null;
      const date = parseAiringDate(next);
      return {
        ...next,
        sort: Number(next.sort || next.ep || 0),
        date,
        dateKey: date ? formatDateKey(date) : ""
      };
    }

    function airingEpisodeLabel(episode) {
      if (!episode?.date) return "下一集日期待同步";
      const difference = Math.round(
        (new Date(episode.date.getFullYear(), episode.date.getMonth(), episode.date.getDate()) -
          new Date(appClock.value.getFullYear(), appClock.value.getMonth(), appClock.value.getDate())) /
        86400000
      );
      if (difference === 0) return `今天更新 · EP.${String(episode.sort).padStart(2, "0")}`;
      if (difference === 1) return `明天更新 · EP.${String(episode.sort).padStart(2, "0")}`;
      if (difference < 0) return `已更新待看 · EP.${String(episode.sort).padStart(2, "0")}`;
      return `${difference} 天后 · EP.${String(episode.sort).padStart(2, "0")}`;
    }

    const personalAiringSchedule = computed(() => {
      return allSubjects.value
        .filter((subject) => Number(subject.status) === 3 && Number(subject.type) === 2 && subject.bangumiId)
        .map((subject) => {
          const item = airingCalendarItemMap.value.get(Number(subject.bangumiId));
          const nextEpisode = nextUnwatchedEpisode(subject);
          return {
            key: subject.key,
            subject,
            calendarItem: item || null,
            nextEpisode,
            airsToday: Number(item?.air_weekday) === currentAiringWeekday.value
          };
        })
        .sort((left, right) => {
          const leftDate = left.nextEpisode?.date?.getTime() ?? Number.POSITIVE_INFINITY;
          const rightDate = right.nextEpisode?.date?.getTime() ?? Number.POSITIVE_INFINITY;
          return leftDate - rightDate || left.subject.name.localeCompare(right.subject.name, "zh-CN");
        });
    });

    const todayPersonalAiring = computed(() =>
      personalAiringSchedule.value.filter((entry) =>
        entry.airsToday || entry.nextEpisode?.dateKey === todayKey.value
      )
    );

    const thisWeekAiring = computed(() => {
      const offset = (appClock.value.getDay() + 6) % 7;
      const start = new Date(
        appClock.value.getFullYear(),
        appClock.value.getMonth(),
        appClock.value.getDate() - offset
      );
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59);
      return personalAiringSchedule.value
        .filter((entry) => {
          const date = entry.nextEpisode?.date;
          return date && date >= start && date <= end;
        })
        .sort((left, right) => left.nextEpisode.date - right.nextEpisode.date);
    });

    const nextAiringEpisodes = computed(() =>
      personalAiringSchedule.value
        .filter((entry) => entry.nextEpisode?.date)
        .slice(0, 8)
    );

    function mergeSubjects(primary, secondary) {
      return {
        ...primary,
        ...Object.fromEntries(Object.entries(secondary).filter(([_key, value]) => value !== "" && value !== null && value !== undefined && value !== 0)),
        myScore: secondary.myScore || primary.myScore,
        status: secondary.status || primary.status,
        episode: secondary.episode || primary.episode,
        epTotal: secondary.epTotal || primary.epTotal,
        comment: secondary.comment || primary.comment
      };
    }

    const subjectPosts = computed(() => {
      if (!selectedSubject.value) return [];
      return allPostsSorted.value.filter((post) => {
        if (!post.subject) return false;
        if (selectedSubject.value.kind === "event" || String(selectedSubject.value.key).startsWith("event:")) {
          return post.subject.key === selectedSubject.value.key;
        }
        return Number(post.subject.bangumiId) === Number(selectedSubject.value.bangumiId);
      });
    });

    const displayedSubjectPosts = computed(() => {
      if (!selectedDetailEpisode.value) return subjectPosts.value;
      return subjectPosts.value.filter((post) => episodeMatchesPost(selectedDetailEpisode.value, post));
    });

    function episodeMatchesPost(episode, post) {
      if (!episode || !post?.subject) return false;
      if (episode.id && post.subject.episodeId) return String(post.subject.episodeId) === String(episode.id);
      return Number(post.subject.episode) === Number(episode.sort || episode.ep || 0);
    }

    function episodePosts(episode) {
      return subjectPosts.value.filter((post) => episodeMatchesPost(episode, post));
    }

    function episodeKindLabel(type) {
      return ({ 0: "本篇", 1: "SP", 2: "OP", 3: "ED", 4: "PV", 5: "MAD", 6: "其他" })[Number(type)] || "章节";
    }

    function episodePrefix(episode, subject = selectedSubject.value) {
      const number = Number(episode?.sort || episode?.ep || 0);
      if (Number(subject?.type) === 1) return `第 ${number} 章`;
      if (Number(subject?.type) === 3) return `TRACK ${padNumber(number, 2)}`;
      return `EP.${padNumber(number, 2)}`;
    }

    function episodeDisplayTitle(episode) {
      return episode?.name_cn || episode?.name || "未命名章节";
    }

    const activeWatchSession = computed(() =>
      (database.value.watchSessions || []).find((session) => !session.endAt) || null
    );

    const currentSubjectWatchSessions = computed(() => {
      if (!selectedSubject.value) return [];
      return (database.value.watchSessions || [])
        .filter((session) =>
          session.subjectKey === selectedSubject.value.key &&
          Boolean(session.endAt)
        )
        .sort((left, right) => new Date(right.startAt) - new Date(left.startAt));
    });

    const activeWatchSessionForSubject = computed(() =>
      activeWatchSession.value?.subjectKey === selectedSubject.value?.key
        ? activeWatchSession.value
        : null
    );

    const watchSessionElapsedMs = computed(() => {
      const session = activeWatchSession.value;
      if (!session) return 0;
      return Math.max(0, watchSessionNow.value - new Date(session.startAt).getTime());
    });

    const defaultWatchEpisode = computed(() => {
      if (selectedDetailEpisode.value) return selectedDetailEpisode.value;
      const mainEpisodes = subjectEpisodes.value
        .filter((episode) => Number(episode.type) === 0)
        .sort((left, right) => Number(left.sort || left.ep) - Number(right.sort || right.ep));
      if (!mainEpisodes.length) return subjectEpisodes.value[0] || null;
      const watched = Number(selectedSubject.value?.episode) || 0;
      return mainEpisodes.find((episode) => Number(episode.sort || episode.ep) > watched) ||
        mainEpisodes[Math.max(0, mainEpisodes.length - 1)] ||
        null;
    });

    function watchEpisodeLabel(episode) {
      if (!episode) return "未选章节";
      if (Number(episode.sort) > 0) return episodePrefix(episode);
      return String(episode.label || "未选章节");
    }

    function watchSessionEpisodeRange(session) {
      const start = watchEpisodeLabel(session?.startEpisode);
      const end = watchEpisodeLabel(session?.endEpisode);
      return start === end ? start : `${start} → ${end}`;
    }

    function watchSessionCountForEpisode(episode) {
      const number = Number(episode?.sort || episode?.ep || 0);
      if (!number) return 0;
      return currentSubjectWatchSessions.value.filter((session) =>
        Number(session.startEpisode?.sort) <= number &&
        Number(session.endEpisode?.sort) >= number
      ).length;
    }

    watch(activeWatchSession, (session) => {
      if (watchSessionTickTimer) {
        clearInterval(watchSessionTickTimer);
        watchSessionTickTimer = null;
      }
      if (!session) return;
      watchSessionNow.value = Date.now();
      watchSessionTickTimer = setInterval(() => {
        watchSessionNow.value = Date.now();
      }, 1000);
    }, { immediate: true });

    const currentToc = computed(() => currentArticle.value ? extractToc(currentArticle.value.content) : []);
    const tocEntries = currentToc;

    const stats = computed(() => {
      const posts = database.value.posts;
      const notes = posts.filter((post) => post.kind === "note").length;
      const words = posts.reduce((sum, post) => sum + countWords(post.content), 0);
      const ratings = database.value.collections
        .map((subject) => Number(subject.myScore))
        .filter((rating) => rating >= 1 && rating <= 10);
      const ratingDistribution = Array.from({ length: 10 }, (_value, index) => {
        const score = 10 - index;
        const count = ratings.filter((rating) => rating === score).length;
        return {
          score,
          count,
          percent: ratings.length ? Math.round((count / ratings.length) * 100) : 0
        };
      });
      const emojiCounts = new Map();
      for (const post of posts) {
        const matches = String(post.content || "").match(/\(bgm(\d+)\)/g) || [];
        for (const code of matches) {
          const number = Number(code.match(/\d+/)?.[0]);
          if (number < 24 || number > 125) continue;
          emojiCounts.set(code, (emojiCounts.get(code) || 0) + 1);
        }
      }
      const topEmoji = [...emojiCounts.entries()]
        .map(([code, count]) => ({ code, count, url: emojiUrl(Number(code.match(/\d+/)?.[0])) }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
        .slice(0, 5);
      return {
        totalPosts: posts.length,
        notes,
        articles: posts.length - notes,
        words,
        ratedSubjects: ratings.length,
        ratingDistribution,
        topEmoji
      };
    });

    const statsFinding = computed(() =>
      `总计 ${stats.value.totalPosts} 条日志、${formatNumber(stats.value.words)} 字；个人评分来自 ${stats.value.ratedSubjects} 部已评分收藏。`
    );

    const yearbookYears = computed(() => {
      const currentYear = new Date().getFullYear();
      const years = new Set(Array.from(
        { length: Math.max(1, currentYear - 2017) },
        (_value, index) => currentYear - index
      ));
      for (const post of database.value.posts) {
        const date = new Date(post.createdAt);
        if (!Number.isNaN(date.getTime())) years.add(date.getFullYear());
      }
      for (const subject of database.value.collections) {
        const date = new Date(subject.updatedAt);
        if (!Number.isNaN(date.getTime()) && date.getFullYear() > 1970) years.add(date.getFullYear());
      }
      return [...years].sort((left, right) => right - left);
    });

    function belongsToYear(value, year) {
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(year);
    }

    const yearbook = computed(() => {
      const year = Number(yearbookYear.value);
      const posts = allPostsSorted.value
        .filter((post) => belongsToYear(post.createdAt, year))
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
      const workMap = new Map();
      const activityByDay = new Map();
      const activityDetailsByDay = new Map();
      const activityEvents = [];
      const postActiveDays = new Set();
      const collectionActiveDays = new Set();
      let collectionUpdates = 0;
      let completedWorks = 0;

      function addActivity(value, source, label = "", meta = "") {
        const key = formatDateKey(value);
        if (!key) return;
        if (!activityByDay.has(key)) activityByDay.set(key, new Set());
        activityByDay.get(key).add(source);
        const date = new Date(value);
        const time = Number.isNaN(date.getTime())
          ? ""
          : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        if (!activityDetailsByDay.has(key)) activityDetailsByDay.set(key, []);
        activityDetailsByDay.get(key).push({ time, source, label, meta });
        activityEvents.push({
          dateKey: key,
          hour: Number.isNaN(date.getTime()) ? null : date.getHours(),
          source
        });
      }

      function ensureWork(subject) {
        const normalized = normalizeSubject(subject);
        if (!normalized) return null;
        if (![1, 2, 3, 4, 6].includes(Number(normalized.type))) return null;
        const key = normalized.key;
        if (!workMap.has(key)) {
          workMap.set(key, {
            key,
            subject: normalized,
            posts: [],
            words: 0,
            episodes: new Set()
          });
        }
        return workMap.get(key);
      }

      for (const post of posts) {
        if (post.subject) {
          const work = ensureWork(post.subject);
          if (work) {
            work.posts.push(post);
            work.words += countWords(post.content);
            if (post.subject.episodeLabel) work.episodes.add(post.subject.episodeLabel);
          }
        }
        const dateKey = formatDateKey(post.createdAt);
        if (dateKey) postActiveDays.add(dateKey);
        const postLabel = post.title || excerpt(post.content, 46) || "无题记录";
        const postMeta = post.subject?.name
          ? `${post.subject.name}${post.subject.episodeLabel ? ` · ${post.subject.episodeLabel}` : ""}`
          : "";
        addActivity(post.createdAt, post.kind === "article" ? "长文" : "即时记录", postLabel, postMeta);
      }

      for (const subject of database.value.collections) {
        if (!belongsToYear(subject.updatedAt, year)) continue;
        collectionUpdates += 1;
        const dateKey = formatDateKey(subject.updatedAt);
        if (dateKey) collectionActiveDays.add(dateKey);
        if (Number(subject.status) === 2) completedWorks += 1;
        const normalized = normalizeSubject(subject);
        const rating = Number(subject.myScore || subject.rate) || 0;
        const progress = Number(subject.epStatus || subject.ep_status) || 0;
        const collectionMeta = [
          rating ? `${rating} 分` : "",
          progress ? `进度 ${progress}` : ""
        ].filter(Boolean).join(" · ");
        addActivity(
          subject.updatedAt,
          collectionStatusLabel(subject.status, subject.type),
          normalized?.name || "未知条目",
          collectionMeta
        );
        const work = ensureWork(subject);
        if (work) work.subject = mergeSubjects(work.subject, normalizeSubject(subject));
      }

      const works = [...workMap.values()]
        .map((work) => ({
          ...work,
          rating: Number(work.subject.myScore) || 0,
          episodeCount: work.episodes.size,
          activityScore: (Number(work.subject.myScore) || 0) * 10 + work.posts.length * 3 + work.words / 100
        }))
        .sort((left, right) => right.activityScore - left.activityScore || left.subject.name.localeCompare(right.subject.name, "zh-CN"));

      const categoryTypes = [
        { value: 2, label: "动画" },
        { value: 1, label: "书籍" },
        { value: 4, label: "游戏" },
        { value: 3, label: "音乐" },
        { value: 6, label: "三次元" }
      ];
      const completedKeys = new Set(
        database.value.collections
          .filter((subject) =>
            Number(subject.status) === 2 &&
            belongsToYear(subject.updatedAt, year)
          )
          .map((subject) => normalizeSubject(subject)?.key)
          .filter(Boolean)
      );
      const categoryWinners = categoryTypes.map((category) => ({
        ...category,
        completed: works.filter((work) =>
          Number(work.subject.type) === Number(category.value) &&
          completedKeys.has(work.key)
        ).length,
        work: works.find((work) =>
          Number(work.subject.type) === Number(category.value) &&
          completedKeys.has(work.key)
        ) || null
      }));
      const categoryGroups = categoryTypes.map((category) => {
        const categoryWorks = works.filter((work) =>
          Number(work.subject.type) === Number(category.value) &&
          completedKeys.has(work.key)
        );
        return {
          ...category,
          works: categoryWorks.slice(0, 15),
          total: categoryWorks.length,
          completed: categoryWorks.length
        };
      });

      const episodeMap = new Map();
      for (const post of posts) {
        if (!post.subject?.episodeLabel) continue;
        const key = `${post.subject.key || post.subject.bangumiId}:${post.subject.episodeId || post.subject.episode}`;
        if (!episodeMap.has(key)) {
          episodeMap.set(key, {
            key,
            subject: normalizeSubject(post.subject),
            episode: {
              id: post.subject.episodeId || null,
              sort: Number(post.subject.episode) || 0,
              ep: Number(post.subject.episode) || 0,
              name_cn: post.subject.episodeLabel || "",
              type: 0
            },
            label: post.subject.episodeLabel,
            posts: [],
            words: 0
          });
        }
        const group = episodeMap.get(key);
        group.posts.push(post);
        group.words += countWords(post.content);
      }
      const topEpisode = [...episodeMap.values()]
        .sort((left, right) => right.posts.length - left.posts.length || right.words - left.words)[0] || null;

      const articles = posts.filter((post) => post.kind === "article");
      const notes = posts.filter((post) => post.kind === "note");
      const dailyNotes = notes.filter((post) => !post.subject);
      const topArticle = [...articles].sort((left, right) => countWords(right.content) - countWords(left.content))[0] || null;
      const topDaily = [...dailyNotes].sort((left, right) => countWords(right.content) - countWords(left.content))[0]
        || [...notes].sort((left, right) => countWords(right.content) - countWords(left.content))[0]
        || null;

      const yearTagCounts = new Map();
      const emojiCounts = new Map();
      for (const post of posts) {
        for (const tag of visiblePostTags(post)) yearTagCounts.set(tag, (yearTagCounts.get(tag) || 0) + 1);
        for (const code of String(post.content || "").match(/\(bgm(\d+)\)/g) || []) {
          const number = Number(code.match(/\d+/)?.[0]);
          if (number >= 24 && number <= 125) emojiCounts.set(code, (emojiCounts.get(code) || 0) + 1);
        }
      }
      const topTag = [...yearTagCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"))[0] || null;
      const topEmoji = [...emojiCounts.entries()]
        .map(([code, count]) => ({ code, count, url: emojiUrl(Number(code.match(/\d+/)?.[0])) }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))[0] || null;

      const monthly = Array.from({ length: 12 }, (_value, index) => {
        const monthPosts = posts.filter((post) => new Date(post.createdAt).getMonth() === index);
        const monthKey = `${year}-${String(index + 1).padStart(2, "0")}`;
        const activeDays = [...activityByDay.keys()].filter((key) => key.startsWith(monthKey)).length;
        const collectionEvents = database.value.collections.filter((subject) =>
          formatDateKey(subject.updatedAt).startsWith(monthKey)
        ).length;
        return {
          month: index + 1,
          count: monthPosts.length,
          activeDays,
          collectionEvents,
          words: monthPosts.reduce((sum, post) => sum + countWords(post.content), 0)
        };
      });
      const topMonth = [...monthly].sort((left, right) => right.activeDays - left.activeDays || right.count - left.count || right.words - left.words)[0];
      const maxMonthCount = Math.max(1, ...monthly.map((month) => month.activeDays));
      const ratedWorks = works.filter((work) => work.rating > 0);
      const activeDayKeys = [...activityByDay.keys()].sort();
      let longestStreak = 0;
      let streak = 0;
      let previousDate = null;
      for (const key of activeDayKeys) {
        const currentDate = new Date(`${key}T00:00:00Z`);
        if (previousDate && Math.round((currentDate - previousDate) / 86400000) === 1) streak += 1;
        else streak = 1;
        longestStreak = Math.max(longestStreak, streak);
        previousDate = currentDate;
      }
      const weekendDays = activeDayKeys.filter((key) => {
        const day = new Date(`${key}T00:00:00Z`).getUTCDay();
        return day === 0 || day === 6;
      }).length;
      const lateNightEvents = activityEvents.filter((event) =>
        event.hour !== null && (event.hour >= 22 || event.hour < 6)
      ).length;
      const ratingDistribution = Array.from({ length: 10 }, (_value, index) => {
        const score = 10 - index;
        return {
          score,
          count: ratedWorks.filter((work) => work.rating === score).length
        };
      });
      const sortedRatings = ratedWorks.map((work) => work.rating).sort((left, right) => left - right);
      const ratingSummary = {
        rated: sortedRatings.length,
        average: sortedRatings.length ? sortedRatings.reduce((sum, rating) => sum + rating, 0) / sortedRatings.length : 0,
        median: sortedRatings.length
          ? sortedRatings.length % 2
            ? sortedRatings[Math.floor(sortedRatings.length / 2)]
            : (sortedRatings[sortedRatings.length / 2 - 1] + sortedRatings[sortedRatings.length / 2]) / 2
          : 0,
        highRatio: sortedRatings.length
          ? sortedRatings.filter((rating) => rating >= 8).length / sortedRatings.length * 100
          : 0,
        lowRatio: sortedRatings.length
          ? sortedRatings.filter((rating) => rating <= 4).length / sortedRatings.length * 100
          : 0
      };

      const topWork = works[0] || null;
      const awards = [
        topWork && {
          key: "work",
          label: "年度作品",
          value: topWork.subject.name,
          detail: `${topWork.rating ? `${topWork.rating}/10` : "未评分"} · ${topWork.posts.length} 条记录`,
          kind: "subject",
          subject: topWork.subject
        },
        topEpisode && {
          key: "episode",
          label: "年度单集",
          value: `${topEpisode.label}${topEpisode.subject?.name ? ` · ${topEpisode.subject.name}` : ""}`,
          detail: `${topEpisode.posts.length} 条相关记录 · ${topEpisode.words} 字`,
          kind: "episode",
          subject: topEpisode.subject,
          episode: topEpisode.episode
        },
        topArticle && {
          key: "article",
          label: "年度长文",
          value: topArticle.title || "无题长文",
          detail: `${countWords(topArticle.content)} 字 · ${formatDate(topArticle.createdAt)}`,
          kind: "article",
          post: topArticle
        },
        topDaily && {
          key: "daily",
          label: "年度日常",
          value: excerpt(topDaily.content, 42),
          detail: `${countWords(topDaily.content)} 字 · ${formatDate(topDaily.createdAt)}`,
          kind: "note",
          post: topDaily
        },
        topTag && {
          key: "tag",
          label: "年度关键词",
          value: `#${topTag.name}`,
          detail: `出现 ${topTag.count} 次`,
          kind: "tag",
          tag: topTag.name
        },
        topEmoji && {
          key: "emoji",
          label: "年度表情",
          value: topEmoji.code,
          detail: `使用 ${topEmoji.count} 次`,
          kind: "emoji",
          emoji: topEmoji
        },
        topMonth?.activeDays > 0 && {
          key: "month",
          label: "高光月份",
          value: `${year} 年 ${topMonth.month} 月`,
          detail: `${topMonth.activeDays} 个活跃日 · ${topMonth.count} 条记录`,
          kind: "month",
          month: `${year}-${String(topMonth.month).padStart(2, "0")}`
        }
      ].filter(Boolean);

      const topPosts = [...posts]
        .sort((left, right) => countWords(right.content) - countWords(left.content))
        .slice(0, 4);

      return {
        year,
        posts,
        works,
        topWork,
        topEpisode,
        topArticle,
        topDaily,
        topTag,
        topEmoji,
        topMonth,
        awards,
        topPosts,
        categoryWinners,
        categoryGroups,
        ratingDistribution,
        ratingSummary,
        monthly,
        maxMonthCount,
        activityDays: Object.fromEntries(
          [...activityByDay.entries()].map(([key, sources]) => [key, [...sources]])
        ),
        activityDetails: Object.fromEntries(
          [...activityDetailsByDay.entries()].map(([key, details]) => [key, details])
        ),
        stats: {
          records: posts.length,
          notes: notes.length,
          articles: articles.length,
          words: posts.reduce((sum, post) => sum + countWords(post.content), 0),
          works: works.length,
          episodes: topEpisode ? episodeMap.size : 0,
          images: posts.reduce((sum, post) => sum + (post.images?.length || 0), 0),
          activeDays: activityByDay.size,
          postActiveDays: postActiveDays.size,
          collectionActiveDays: collectionActiveDays.size,
          collectionUpdates,
          completedWorks,
          longestStreak,
          weekendRatio: activeDayKeys.length ? (weekendDays / activeDayKeys.length) * 100 : 0,
          lateNightRatio: activityEvents.length ? (lateNightEvents / activityEvents.length) * 100 : 0,
          averageRating: ratedWorks.length
            ? ratedWorks.reduce((sum, work) => sum + work.rating, 0) / ratedWorks.length
            : 0
        }
      };
    });

    const yearbookFinding = computed(() => {
      const value = yearbook.value;
      if (!value.posts.length && !value.works.length) {
        return `${value.year} 年还没有留下可评选的记录。`;
      }
      return `${value.stats.records} 条记录、${value.stats.works} 部作品、${formatNumber(value.stats.words)} 字，构成你的 ${value.year}。`;
    });

    function buildYearbookSnapshot(year) {
      const numericYear = Number(year);
      const posts = allPostsSorted.value.filter((post) => belongsToYear(post.createdAt, numericYear));
      const workMap = new Map();
      const activeDays = new Set();
      for (const post of posts) {
        activeDays.add(formatDateKey(post.createdAt));
        if (!post.subject || ![1, 2, 3, 4, 6].includes(Number(post.subject.type))) continue;
        const subject = normalizeSubject(post.subject);
        if (subject) workMap.set(subject.key, subject);
      }
      for (const subject of database.value.collections) {
        if (!belongsToYear(subject.updatedAt, numericYear) || ![1, 2, 3, 4, 6].includes(Number(subject.type))) continue;
        activeDays.add(formatDateKey(subject.updatedAt));
        const normalized = normalizeSubject(subject);
        if (normalized) workMap.set(normalized.key, normalized);
      }
      const works = [...workMap.values()];
      const ratings = works
        .map((subject) => Number(subject.myScore))
        .filter((rating) => rating >= 1 && rating <= 10);
      const sortedRatings = [...ratings].sort((left, right) => left - right);
      return {
        year: numericYear,
        stats: {
          records: posts.length,
          articles: posts.filter((post) => post.kind === "article").length,
          notes: posts.filter((post) => post.kind === "note").length,
          words: posts.reduce((sum, post) => sum + countWords(post.content), 0),
          works: works.length,
          activeDays: activeDays.size,
          averageRating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0
        },
        ratingDistribution: Array.from({ length: 10 }, (_value, index) => {
          const score = 10 - index;
          return { score, count: ratings.filter((rating) => rating === score).length };
        }),
        ratingSummary: {
          rated: sortedRatings.length,
          average: sortedRatings.length ? sortedRatings.reduce((sum, rating) => sum + rating, 0) / sortedRatings.length : 0,
          median: sortedRatings.length
            ? sortedRatings.length % 2
              ? sortedRatings[Math.floor(sortedRatings.length / 2)]
              : (sortedRatings[sortedRatings.length / 2 - 1] + sortedRatings[sortedRatings.length / 2]) / 2
            : 0,
          highRatio: sortedRatings.length
            ? sortedRatings.filter((rating) => rating >= 8).length / sortedRatings.length * 100
            : 0,
          lowRatio: sortedRatings.length
            ? sortedRatings.filter((rating) => rating <= 4).length / sortedRatings.length * 100
            : 0
        }
      };
    }

    const yearbookComparison = computed(() => buildYearbookSnapshot(yearbookComparisonYear.value));

    watch(yearbookYear, (year) => {
      if (!yearbookCompareEnabled.value) return;
      const previousYear = Number(year) - 1;
      yearbookComparisonYear.value = yearbookYears.value.includes(previousYear)
        ? previousYear
        : (yearbookYears.value.find((item) => Number(item) !== Number(year)) || previousYear);
    });

    watch(yearbookCompareEnabled, (enabled) => {
      if (!enabled) return;
      if (Number(yearbookComparisonYear.value) === Number(yearbookYear.value)) {
        const previousYear = Number(yearbookYear.value) - 1;
        yearbookComparisonYear.value = yearbookYears.value.includes(previousYear)
          ? previousYear
          : (yearbookYears.value.find((item) => Number(item) !== Number(yearbookYear.value)) || previousYear);
      }
    });

    const yearbookComparisonMetrics = computed(() => {
      const current = yearbook.value.stats;
      const baseline = yearbookComparison.value.stats;
      return [
        { key: "records", label: "记录", current: current.records, baseline: baseline.records, unit: "条" },
        { key: "works", label: "作品", current: current.works, baseline: baseline.works, unit: "部" },
        { key: "words", label: "字数", current: current.words, baseline: baseline.words, unit: "字" },
        { key: "activeDays", label: "活跃日", current: current.activeDays, baseline: baseline.activeDays, unit: "天" },
        { key: "averageRating", label: "平均分", current: current.averageRating, baseline: baseline.averageRating, unit: "" }
      ].map((metric) => ({
        ...metric,
        delta: metric.current - metric.baseline
      }));
    });

    const yearbookRatingComparison = computed(() => {
      const currentMap = new Map(yearbook.value.ratingDistribution.map((item) => [item.score, item.count]));
      const baselineMap = new Map(yearbookComparison.value.ratingDistribution.map((item) => [item.score, item.count]));
      const maximum = Math.max(1, ...currentMap.values(), ...baselineMap.values());
      return Array.from({ length: 10 }, (_value, index) => {
        const score = 10 - index;
        const current = currentMap.get(score) || 0;
        const baseline = baselineMap.get(score) || 0;
        return {
          score,
          current,
          baseline,
          currentPercent: current / maximum * 100,
          baselinePercent: baseline / maximum * 100
        };
      });
    });

    const yearbookRatingMetrics = computed(() => {
      const current = yearbook.value.ratingSummary;
      const baseline = yearbookComparison.value.ratingSummary;
      return [
        { key: "rated", label: "已评分", current: current.rated, baseline: baseline.rated, suffix: "" },
        { key: "average", label: "平均分", current: current.average, baseline: baseline.average, suffix: "", digits: 1 },
        { key: "median", label: "中位数", current: current.median, baseline: baseline.median, suffix: "", digits: 1 },
        { key: "high", label: "高分段 8–10", current: current.highRatio, baseline: baseline.highRatio, suffix: "%", digits: 1 },
        { key: "low", label: "低分段 1–4", current: current.lowRatio, baseline: baseline.lowRatio, suffix: "%", digits: 1 }
      ].map((metric) => ({
        ...metric,
        delta: metric.current - metric.baseline
      }));
    });

    const collectionStatusGroups = computed(() =>
      subjectCategories.slice(0, 5).map((category) => {
        const items = database.value.collections.filter((subject) =>
          Number(subject.type) === Number(category.value)
        );
        return {
          ...category,
          total: items.length,
          statuses: collectionStatuses.map((status) => ({
            ...status,
            label: collectionStatusLabel(status.value, category.value),
            count: items.filter((subject) => Number(subject.status) === Number(status.value)).length
          }))
        };
      })
    );

    const yearbookCommentary = computed(() =>
      database.value.yearbookComments?.[String(yearbookYear.value)] || null
    );

    function localYearbookCritique(value, comparison = null) {
      const notes = value.stats.notes;
      const articles = value.stats.articles;
      const topGroup = [...value.categoryGroups].sort((left, right) => right.total - left.total)[0];
      const totalWorks = Math.max(1, value.stats.works);
      const topShare = topGroup ? topGroup.total / totalWorks : 0;
      const activeDelta = comparison ? value.stats.activeDays - comparison.stats.activeDays : 0;
      const wordsDelta = comparison ? value.stats.words - comparison.stats.words : 0;
      const observations = [];
      if (!value.stats.records && value.stats.works) {
        observations.push("收藏夹很满，日志很干净……像是只负责登记，不负责感受。");
      } else if (articles === 0 && notes > 0) {
        observations.push("你写了很多句子，却没给任何想法留下完整尸体。");
      } else if (articles > 0 && notes === 0) {
        observations.push("每句话都穿上了长文的外套——不累吗？");
      } else if (value.stats.records) {
        observations.push(`记录 ${value.stats.records} 条，真正被展开的却没几件。碎片很诚实，也很会逃。`);
      }
      if (topGroup?.total && topShare > 0.6) {
        observations.push(`${topGroup.label}占了大半江山——这已经不像偏爱，更像惯性。`);
      } else if (value.stats.works >= 3) {
        observations.push("你确实四处张望过，只是很难说哪一部真的留下了抓痕。");
      }
      if (value.stats.activeDays && value.stats.lateNightRatio >= 35) {
        observations.push(`${value.stats.lateNightRatio.toFixed(0)}% 的活动发生在深夜——热爱和失眠有时穿同一件衣服。`);
      }
      if (comparison && Number(comparison.year) !== Number(value.year)) {
        if (activeDelta > 0) observations.push(`比 ${comparison.year} 年多活跃 ${activeDelta} 天，至少没有把变化全推给算法。`);
        else if (activeDelta < 0) observations.push(`比 ${comparison.year} 年少活跃 ${Math.abs(activeDelta)} 天——这不是克制，是失踪。`);
        if (wordsDelta > 0) observations.push(`多写 ${formatNumber(wordsDelta)} 字；希望其中有一部分不是解释自己。`);
        else if (wordsDelta < 0) observations.push(`少写 ${formatNumber(Math.abs(wordsDelta))} 字，沉默也被统计得很体面。`);
      }
      observations.push("明年挑一部作品，把评分、私心和失败都写在同一段里。别再交给进度条。");
      return observations.slice(0, 3).join("\n\n");
    }

    async function generateYearbookCritique(useAi = true) {
      if (yearbookCritiqueBusy.value) return;
      yearbookCritiqueBusy.value = true;
      const value = yearbook.value;
      const comparison = yearbookCompareEnabled.value ? yearbookComparison.value : null;
      let content = "";
      let source = "local";
      try {
        if (useAi && aiConfigured.value) {
          const summary = {
            year: value.year,
            stats: value.stats,
            ...(comparison ? {
              comparisonYear: comparison.year,
              comparisonStats: comparison.stats
            } : {}),
            categories: value.categoryGroups.map((group) => ({
              label: group.label,
              works: group.total,
              completed: group.completed
            })),
            awards: value.awards.map((award) => ({ label: award.label, value: award.value })),
            topTags: [...new Map(
              value.posts.flatMap((post) => visiblePostTags(post).map((tag) => [tag, true]))
            ).keys()].slice(0, 8)
          };
          const response = await window.bgmApi.aiChat({
            baseUrl: database.value.settings.aiBaseUrl,
            apiKey: aiApiKey.value,
            model: database.value.settings.aiModel,
            messages: [
              {
                role: "system",
                content: `${database.value.settings.aiSystemPrompt || HARUNA_SYSTEM_PROMPT}
你要锐评整份年度年鉴。输出2到3段，总长80到160字。必须指出一个实际偏好、一个数据盲点，并给一条不那么体面的建议。${comparison ? "还要指出一个与对比年份的差异。" : "本次没有启用同比，不要虚构或提及对比年份。"}不要泛泛夸奖，不要写标题。`
              },
              { role: "user", content: `年鉴数据：${JSON.stringify(summary)}` }
            ]
          });
          if (response.ok) {
            content = String(response.content || "").trim().slice(0, 800);
            source = "ai";
          } else {
            appendDebug(`春菜年鉴锐评请求失败，使用本地分析：${response.error}`, "error");
          }
        }
        if (!content) content = localYearbookCritique(value, comparison);
        database.value.yearbookComments[String(value.year)] = {
          content,
          source,
          generatedAt: new Date().toISOString()
        };
        await persistDatabase();
        showToast(source === "ai" ? "春菜完成了年鉴锐评。" : "春菜用本地数据重写了年鉴锐评。");
      } catch (error) {
        appendDebug(`春菜年鉴锐评异常：${error.message}`, "error");
        showToast(`年鉴锐评失败：${error.message}`, true);
      } finally {
        yearbookCritiqueBusy.value = false;
      }
    }

    const yearbookActivityCalendar = computed(() => {
      const year = Number(yearbookYear.value);
      const activityDays = yearbook.value.activityDays || {};
      const activityDetails = yearbook.value.activityDetails || {};
      return Array.from({ length: 12 }, (_value, index) => {
        const month = index + 1;
        const first = new Date(year, index, 1);
        const offset = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(year, index + 1, 0).getDate();
        const cells = Array.from({ length: offset }, () => ({
          key: "",
          label: "",
          title: "",
          classes: "blank"
        }));
        for (let day = 1; day <= daysInMonth; day += 1) {
          const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const sources = activityDays[key] || [];
          const details = activityDetails[key] || [];
          const hasLog = sources.some((source) => ["即时记录", "长文"].includes(source));
          const hasCollection = sources.some((source) => !["即时记录", "长文"].includes(source));
          const title = details.length
            ? `${key}\n${details.map((detail) => {
                const head = [detail.time, detail.source].filter(Boolean).join(" ");
                return [head, detail.label, detail.meta].filter(Boolean).join(" · ");
              }).join("\n")}`
            : key;
          cells.push({
            key,
            label: String(day),
            title,
            details,
            classes: [
              sources.length ? "active" : "",
              hasLog ? "has-log" : "",
              hasCollection ? "has-collection" : ""
            ].filter(Boolean).join(" ")
          });
        }
        while (cells.length % 7 !== 0) {
          cells.push({ key: "", label: "", title: "", classes: "blank" });
        }
        return {
          month,
          label: `${month} 月`,
          activeDays: Object.keys(activityDays).filter((key) => key.startsWith(`${year}-${String(month).padStart(2, "0")}`)).length,
          cells
        };
      });
    });

    function showYearbookDay(event, day) {
      if (!day?.details?.length) return;
      const tooltipWidth = 318;
      const visibleDetails = day.details.slice(0, 6);
      const estimatedHeight = 54 + visibleDetails.length * 34;
      const targetBounds = event.currentTarget.getBoundingClientRect();
      const anchorX = event.clientX || targetBounds.right;
      const anchorY = event.clientY || targetBounds.bottom;
      const x = Math.max(8, Math.min(anchorX + 14, window.innerWidth - tooltipWidth - 8));
      const y = anchorY + estimatedHeight + 18 > window.innerHeight
        ? Math.max(8, anchorY - estimatedHeight - 12)
        : anchorY + 14;
      yearbookDayHover.value = {
        key: day.key,
        details: visibleDetails,
        remaining: Math.max(0, day.details.length - visibleDetails.length),
        x,
        y
      };
    }

    function hideYearbookDay() {
      yearbookDayHover.value = null;
    }

    function periodDateLabel(date) {
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }

    function getPeriodDescriptor(type, cutoffValue) {
      const cutoff = new Date(cutoffValue);
      if (type === "quarter") return getQuarterDescriptor(cutoff);
      if (type === "month") {
        const start = new Date(cutoff.getFullYear(), cutoff.getMonth(), 1);
        return {
          key: `month:${formatMonthKey(start)}`,
          type: "month",
          label: `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`,
          start,
          cutoff
        };
      }
      const dayOffset = (cutoff.getDay() + 6) % 7;
      const start = new Date(
        cutoff.getFullYear(),
        cutoff.getMonth(),
        cutoff.getDate() - dayOffset,
        0,
        0,
        0,
        0
      );
      return {
        key: `week:${formatDateKey(start)}`,
        type: "week",
        label: `${periodDateLabel(start)} – ${periodDateLabel(cutoff)}`,
        start,
        cutoff
      };
    }

    function periodTypeLabel(type) {
      if (type === "quarter") return "季度总结";
      if (type === "month") return "月记";
      return "周记";
    }

    function periodReviewLabel(type) {
      if (type === "quarter") return "本季度回顾";
      if (type === "month") return "本月回顾";
      return "本周回顾";
    }

    function localPeriodCritique(report) {
      const prefix = report.type === "week"
        ? "这一周"
        : report.type === "month"
          ? "这个月"
          : "这个季度";
      if (!report.stats.records) {
        return `${prefix}几乎没有留下可争辩的证据……不是生活不存在，是你懒得让未来的自己知道。先写一句，再谈回顾。`;
      }
      const observations = [
        `${prefix}留下 ${report.stats.records} 条记录、${formatNumber(report.stats.words)} 字。`
      ];
      if (report.type === "quarter") {
        observations.push(
          `本季新番 ${report.quarterAwards.newAnimeCount} 部，弃番 ${report.quarterAwards.droppedCount} 部。`
        );
        if (report.quarterAwards.surpriseWork) {
          observations.push(
            `最意外的《${report.quarterAwards.surpriseWork.name}》比站内均分${report.quarterAwards.surpriseDelta >= 0 ? "高" : "低"} ${Math.abs(report.quarterAwards.surpriseDelta).toFixed(1)} 分。`
          );
        }
      }
      if (report.watchingWorks.length) {
        const episodeCount = report.watchingWorks.reduce((sum, work) => sum + work.loggedEpisodeCount, 0);
        observations.push(
          episodeCount
            ? `还有 ${report.watchingWorks.length} 部作品挂在“在看”，其中具体记录到 ${episodeCount} 集。进度确实动了，至于记忆有没有跟上，另说。`
            : `${report.watchingWorks.length} 部作品正在“在看”，却没有一集留下名字。进度条比你的感受更积极。`
        );
      }
      if (!report.stats.completedWorks && report.watchingWorks.length) {
        observations.push("开了不少坑，完成数依然是零格外醒目。");
      } else if (report.stats.completedWorks) {
        observations.push(`完成 ${report.stats.completedWorks} 部，至少不是只负责开始。`);
      }
      if (report.moods[0]) {
        observations.push(`正文里的情绪词最常指向「${report.moods[0].label}」，这只是线索，不是心理诊断。`);
      } else {
        observations.push("没有出现足够明确的情绪词，感受大概被你藏在句号里了。");
      }
      return observations.slice(0, 3).join(" ");
    }

    function cachedQuarterCharacters(works) {
      return mergeQuarterCharacters(
        (Array.isArray(works) ? works : [])
          .map((work) => ({
            work,
            characters: database.value.subjectCharacterCache?.[work.bangumiId] || []
          }))
          .filter((group) => group.characters.length)
      );
    }

    function buildPeriodReport(type, cutoffValue, trigger = "preview") {
      const period = getPeriodDescriptor(type, cutoffValue);
      const startTime = period.start.getTime();
      const cutoffTime = period.cutoff.getTime();
      const watchSummary = summarizeWatchSessions(
        database.value.watchSessions,
        period.start,
        period.cutoff
      );
      const quarterAwards = type === "quarter"
        ? buildQuarterAwards({
            collections: database.value.collections,
            startAt: period.start,
            endAt: period.cutoff
          })
        : {
            watchedWorks: [],
            newAnime: [],
            newAnimeCount: 0,
            droppedWorks: [],
            droppedCount: 0,
            highestRated: null,
            surpriseWork: null,
            surpriseDelta: 0
          };
      const quarterCharacters = type === "quarter"
        ? cachedQuarterCharacters(quarterAwards.watchedWorks)
        : [];
      const selectedQuarterCharacterIds = new Set(
        (database.value.quarterCharacterSelections?.[period.key] || []).map(Number)
      );
      const quarterSelectedCharacters = type === "quarter"
        ? quarterCharacters.filter((character) => selectedQuarterCharacterIds.has(Number(character.id)))
        : [];
      const posts = allPostsSorted.value.filter((post) => {
        const time = new Date(post.createdAt).getTime();
        return time >= startTime && time <= cutoffTime;
      });
      const articles = posts.filter((post) => post.kind === "article");
      const notes = posts.filter((post) => post.kind === "note");
      const words = posts.reduce((sum, post) => sum + countWords(post.content), 0);
      const activeDays = new Set(posts.map((post) => formatDateKey(post.createdAt)).filter(Boolean));

      const episodeMap = new Map();
      for (const post of posts) {
        if (!post.subject?.episodeLabel) continue;
        const key = `${post.subject.key || post.subject.bangumiId}:${post.subject.episodeId || post.subject.episodeLabel}`;
        if (!episodeMap.has(key)) {
          episodeMap.set(key, {
            key,
            subject: normalizeSubject(post.subject),
            episodeLabel: post.subject.episodeLabel,
            episode: {
              id: post.subject.episodeId || null,
              sort: Number(post.subject.episode) || 0,
              ep: Number(post.subject.episode) || 0,
              name_cn: post.subject.episodeLabel || "",
              type: 0
            },
            latestAt: post.createdAt,
            posts: [],
            words: 0
          });
        }
        const episode = episodeMap.get(key);
        episode.posts.push(post);
        episode.words += countWords(post.content);
        if (new Date(post.createdAt) > new Date(episode.latestAt)) episode.latestAt = post.createdAt;
      }
      const episodes = [...episodeMap.values()]
        .sort((left, right) => new Date(right.latestAt) - new Date(left.latestAt));

      const collectionStatusByKey = new Map(
        database.value.collections.map((subject) => {
          const normalized = normalizeSubject(subject);
          return [normalized?.key, Number(subject.status)];
        })
      );
      const watchingMap = new Map();
      for (const subject of database.value.collections) {
        if (Number(subject.status) !== 3) continue;
        const normalized = normalizeSubject(subject);
        if (!normalized) continue;
        watchingMap.set(normalized.key, {
          key: normalized.key,
          subject: normalized,
          episodes: [],
          latestAt: normalized.updatedAt,
          loggedEpisodeCount: 0
        });
      }
      for (const post of posts) {
        if (!post.subject) continue;
        const normalized = normalizeSubject(post.subject);
        if (!normalized) continue;
        const currentStatus = collectionStatusByKey.has(normalized.key)
          ? collectionStatusByKey.get(normalized.key)
          : Number(post.subject.status);
        if (currentStatus !== 3) continue;
        if (!watchingMap.has(normalized.key)) {
          watchingMap.set(normalized.key, {
            key: normalized.key,
            subject: normalized,
            episodes: [],
            latestAt: post.createdAt,
            loggedEpisodeCount: 0
          });
        }
        const work = watchingMap.get(normalized.key);
        work.subject = mergeSubjects(work.subject, normalized);
        if (new Date(post.createdAt) > new Date(work.latestAt)) work.latestAt = post.createdAt;
        if (!post.subject.episodeLabel) continue;
        if (work.episodes.some((episode) => episode.label === post.subject.episodeLabel)) continue;
        work.episodes.push({
          label: post.subject.episodeLabel,
          latestAt: post.createdAt
        });
      }
      const watchingWorks = [...watchingMap.values()]
        .map((work) => ({
          ...work,
          episodes: work.episodes.sort((left, right) => new Date(right.latestAt) - new Date(left.latestAt)),
          loggedEpisodeCount: work.episodes.length
        }))
        .sort((left, right) =>
          right.loggedEpisodeCount - left.loggedEpisodeCount ||
          new Date(right.latestAt) - new Date(left.latestAt)
        )
        .slice(0, 12);

      const completedMap = new Map();
      for (const subject of database.value.collections) {
        if (Number(subject.status) !== 2) continue;
        const time = new Date(subject.updatedAt).getTime();
        if (time < startTime || time > cutoffTime) continue;
        const normalized = normalizeSubject(subject);
        if (normalized) completedMap.set(normalized.key, normalized);
      }
      const completedWorks = [...completedMap.values()]
        .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));

      const moodCounts = new Map();
      for (const post of posts) {
        const moodValue = post.mood || inferMoodSignal(`${post.title || ""} ${post.content || ""}`);
        if (!moodValue) continue;
        moodCounts.set(moodValue, (moodCounts.get(moodValue) || 0) + 1);
      }
      const moodTotal = [...moodCounts.values()].reduce((sum, count) => sum + count, 0);
      const moods = [...moodCounts.entries()]
        .map(([value, count]) => ({
          value,
          label: moodLabel(value),
          count,
          percent: moodTotal ? Math.round(count / moodTotal * 100) : 0
        }))
        .sort((left, right) => right.count - left.count);

      const highlights = [...posts]
        .map((post) => ({
          post,
          score: countWords(post.content) +
            (post.kind === "article" ? 40 : 0) +
            (post.images?.length || 0) * 15 +
            (post.harunaComment ? 8 : 0)
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map(({ post }) => ({
          id: post.id,
          title: post.title || excerpt(post.content, 44) || "无题记录",
          excerpt: excerpt(post.content, 110),
          createdAt: post.createdAt,
          kind: post.kind,
          mood: post.mood || "",
          subject: post.subject ? normalizeSubject(post.subject) : null
        }));

      const prefix = type === "week" ? "本周" : type === "month" ? "本月" : "本季度";
      const summaryParts = posts.length
        ? [`${prefix}写下 ${posts.length} 条记录，共 ${formatNumber(words)} 字`]
        : [`${prefix}还没有留下记录`];
      if (episodes.length) summaryParts.push(`记录了 ${episodes.length} 集相关内容`);
      if (completedWorks.length) summaryParts.push(`完成 ${completedWorks.length} 部作品`);
      if (watchSummary.sessionCount) {
        summaryParts.push(
          `观看 ${watchSummary.sessionCount} 场、${formatWatchDuration(watchSummary.durationMs)}`
        );
      }
      if (type === "quarter") {
        summaryParts.push(
          `本季新番 ${quarterAwards.newAnimeCount} 部、弃番 ${quarterAwards.droppedCount} 部`
        );
        if (quarterAwards.highestRated) {
          summaryParts.push(
            `最高分《${quarterAwards.highestRated.name}》${quarterAwards.highestRated.myScore}/10`
          );
        }
      }
      if (moods[0]) summaryParts.push(`情绪词最常指向「${moods[0].label}」`);

      const report = {
        key: period.key,
        type,
        label: period.label,
        startAt: period.start.toISOString(),
        endAt: period.cutoff.toISOString(),
        generatedAt: trigger === "preview" ? null : new Date().toISOString(),
        snapshotAt: trigger === "preview" ? null : period.cutoff.toISOString(),
        trigger,
        summary: `${summaryParts.join("，")}。`,
        stats: {
          records: posts.length,
          notes: notes.length,
          articles: articles.length,
          words,
          activeDays: activeDays.size,
          episodes: episodes.length,
          completedWorks: completedWorks.length,
          watchingWorks: watchingWorks.length,
          images: posts.reduce((sum, post) => sum + (post.images?.length || 0), 0),
          watchSessionCount: watchSummary.sessionCount,
          watchDurationMs: watchSummary.durationMs,
          watchedEpisodes: watchSummary.episodeCount,
          rewatchSessions: watchSummary.rewatchCount
        },
        moods,
        moodTotal,
        episodes,
        watchingWorks,
        completedWorks,
        highlights,
        quarterAwards,
        quarterCharacters,
        quarterSelectedCharacters
      };
      report.harunaComment = {
        content: localPeriodCritique(report),
        source: "local",
        generatedAt: trigger === "preview" ? null : new Date().toISOString()
      };
      return report;
    }

    function latestWeeklyCutoff(now = new Date()) {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - cutoff.getDay());
      cutoff.setHours(3, 0, 0, 0);
      if (cutoff.getTime() > now.getTime()) cutoff.setDate(cutoff.getDate() - 7);
      return cutoff;
    }

    function latestMonthlyCutoff(now = new Date()) {
      const currentMonthEnd = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        3,
        0,
        0,
        0
      );
      if (now.getTime() >= currentMonthEnd.getTime()) return currentMonthEnd;
      return new Date(now.getFullYear(), now.getMonth(), 0, 3, 0, 0, 0);
    }

    async function loadQuarterCharacterGroup(work) {
      const cached = database.value.subjectCharacterCache?.[work.bangumiId];
      if (Array.isArray(cached) && cached.length) {
        return { work, characters: cached };
      }
      const response = await bgmRequest(`/subjects/${work.bangumiId}/characters`, { quiet: true });
      const characters = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : [];
      database.value.subjectCharacterCache[work.bangumiId] = characters;
      return { work, characters };
    }

    async function ensureQuarterCharacters(report, force = false) {
      if (report?.type !== "quarter") return [];
      const works = (report.quarterAwards?.watchedWorks || [])
        .filter((work) => work.bangumiId);
      if (!works.length) {
        quarterCharacterError.value = "";
        return [];
      }
      const missing = force
        ? works
        : works.filter((work) => !Array.isArray(database.value.subjectCharacterCache?.[work.bangumiId]));
      if (!missing.length) {
        quarterCharacterError.value = "";
        return cachedQuarterCharacters(works);
      }
      if (quarterCharacterLoading.value) return report.quarterCharacters || [];

      quarterCharacterLoading.value = true;
      quarterCharacterError.value = "";
      const failures = [];
      try {
        await mapWithConcurrency(missing, 3, async (work) => {
          try {
            await loadQuarterCharacterGroup(work);
          } catch (error) {
            failures.push(work.name);
            appendDebug(`季度角色读取失败 ${work.name}：${error.message}`, "error");
          }
        });
        await persistDatabase();
        quarterCharacterError.value = failures.length
          ? `${failures.length} 部作品的角色读取失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? "…" : ""}`
          : "";
        return cachedQuarterCharacters(works);
      } finally {
        quarterCharacterLoading.value = false;
      }
    }

    async function checkScheduledPeriodReports() {
      if (!databaseLoaded || periodReportCheckBusy) return;
      periodReportCheckBusy = true;
      try {
        const reports = database.value.periodReports || (database.value.periodReports = {});
        let changed = false;
        const now = new Date();
        const schedules = [
          ["week", latestWeeklyCutoff(now)],
          ["month", latestMonthlyCutoff(now)],
          ["quarter", latestQuarterCutoff(now)]
        ];
        for (const [type, cutoff] of schedules) {
          const report = buildPeriodReport(type, cutoff, "auto");
          if (reports[report.key]?.snapshotAt === report.snapshotAt) continue;
          reports[report.key] = report;
          changed = true;
          appendDebug(`已生成${periodTypeLabel(type)}：${report.label}`, "success");
        }
        if (changed) await persistDatabase();
      } catch (error) {
        appendDebug(`自动生成周月记失败：${error.message}`, "error");
      } finally {
        periodReportCheckBusy = false;
      }
    }

    const periodReviewReport = computed(() =>
      periodReviewKey.value === "current"
        ? buildPeriodReport(periodReviewType.value, new Date(), "preview")
        : normalizePeriodReport(database.value.periodReports?.[periodReviewKey.value])
    );

    const periodReviewOptions = computed(() => {
      const current = buildPeriodReport(periodReviewType.value, new Date(), "preview");
      const history = Object.values(database.value.periodReports || {})
        .filter((report) => report?.type === periodReviewType.value)
        .sort((left, right) => new Date(right.endAt) - new Date(left.endAt));
      return [
        { key: "current", label: `本期实时 · ${current.label}` },
        ...history.map((report) => ({ key: report.key, label: `已保存 · ${report.label}` }))
      ];
    });

    const quarterCharacterWorks = computed(() =>
      periodReviewReport.value?.quarterAwards?.watchedWorks || []
    );

    const activeQuarterCharacterWork = computed(() =>
      quarterCharacterWorks.value.find((work) => work.key === quarterActiveWorkKey.value) ||
      quarterCharacterWorks.value[0] ||
      null
    );

    watch(quarterCharacterWorks, (works) => {
      if (!works.some((work) => work.key === quarterActiveWorkKey.value)) {
        quarterActiveWorkKey.value = works[0]?.key || "";
      }
    }, { immediate: true });

    const quarterCharactersForActiveWork = computed(() => {
      const activeWork = activeQuarterCharacterWork.value;
      if (!activeWork) return [];
      return (periodReviewReport.value?.quarterCharacters || [])
        .filter((character) =>
          character.works?.some((work) => work.key === activeWork.key)
        );
    });

    const quarterCharactersForRole = computed(() =>
      filterQuarterCharacters(
        quarterCharactersForActiveWork.value,
        quarterCharacterFilter.value
      )
    );

    const quarterCharacterRoleCounts = computed(() => ({
      main: filterQuarterCharacters(quarterCharactersForActiveWork.value, "main").length,
      support: filterQuarterCharacters(quarterCharactersForActiveWork.value, "support").length
    }));

    const selectedQuarterCharacterIds = computed(() => {
      const report = periodReviewReport.value;
      if (!report) return [];
      const stored = database.value.quarterCharacterSelections?.[report.key];
      if (Array.isArray(stored)) return stored.map(Number);
      return (report.quarterSelectedCharacters || []).map((character) => Number(character.id));
    });

    const quarterSelectedCharacters = computed(() => {
      const selectedIds = new Set(selectedQuarterCharacterIds.value);
      return (periodReviewReport.value?.quarterCharacters || [])
        .filter((character) => selectedIds.has(Number(character.id)));
    });

    function isQuarterCharacterSelected(character) {
      return selectedQuarterCharacterIds.value.includes(Number(character?.id));
    }

    async function toggleQuarterCharacter(character) {
      const report = periodReviewReport.value;
      if (report?.type !== "quarter" || !character?.id) return;
      const selections = database.value.quarterCharacterSelections ||
        (database.value.quarterCharacterSelections = {});
      const nextIds = toggleQuarterCharacterSelection(
        selectedQuarterCharacterIds.value,
        character.id
      );
      selections[report.key] = nextIds;
      if (database.value.periodReports?.[report.key]) {
        const selected = new Set(nextIds);
        database.value.periodReports[report.key].quarterSelectedCharacters =
          (database.value.periodReports[report.key].quarterCharacters || [])
            .filter((item) => selected.has(Number(item.id)));
      }
      await persistDatabase();
    }

    function setPeriodReviewType(type) {
      periodReviewType.value = ["week", "month", "quarter"].includes(type) ? type : "week";
      periodReviewKey.value = "current";
      quarterCharacterPickerOpen.value = false;
      if (type === "quarter") quarterCharacterFilter.value = "main";
    }

    watch([periodReviewType, periodReviewKey], () => {
      quarterCharacterPickerOpen.value = false;
      if (periodReviewType.value !== "quarter") {
        quarterCharacterError.value = "";
      }
    });

    function openQuarterCharacterPicker() {
      quarterCharacterPickerOpen.value = true;
      void ensureQuarterCharacters(periodReviewReport.value);
    }

    function closeQuarterCharacterPicker() {
      quarterCharacterPickerOpen.value = false;
    }

    async function generateSelectedPeriodReport() {
      if (periodReviewBusy.value) return;
      const selected = periodReviewReport.value;
      if (!selected) return;
      periodReviewBusy.value = true;
      try {
        const cutoff = periodReviewKey.value === "current"
          ? new Date()
          : new Date(selected.endAt);
        const report = buildPeriodReport(periodReviewType.value, cutoff, "manual");
        database.value.periodReports[report.key] = report;
        await persistDatabase();
        if (periodReviewKey.value !== "current") periodReviewKey.value = report.key;
        showToast(`${periodTypeLabel(report.type)}已重新汇总。`);
      } catch (error) {
        showToast(`周月记生成失败：${error.message}`, true);
      } finally {
        periodReviewBusy.value = false;
      }
    }

    async function generatePeriodCritique(useAi = true) {
      if (periodReviewCritiqueBusy.value) return;
      const selected = periodReviewReport.value;
      if (!selected) return;
      periodReviewCritiqueBusy.value = true;
      try {
        const cutoff = periodReviewKey.value === "current"
          ? new Date()
          : new Date(selected.endAt);
        const report = buildPeriodReport(periodReviewType.value, cutoff, "manual");
        let content = report.harunaComment.content;
        let source = "local";
        if (useAi && aiConfigured.value) {
          const summary = {
            type: report.type,
            label: report.label,
            stats: report.stats,
            moods: report.moods,
            watchingWorks: report.watchingWorks.map((work) => ({
              name: work.subject.name,
              progress: progressLabel(work.subject),
              episodes: work.episodes.map((episode) => episode.label)
            })),
            completedWorks: report.completedWorks.map((work) => work.name),
            highlights: report.highlights.map((highlight) => highlight.title),
            ...(report.type === "quarter" ? {
              quarterAwards: {
                newAnimeCount: report.quarterAwards.newAnimeCount,
                droppedCount: report.quarterAwards.droppedCount,
                highestRated: report.quarterAwards.highestRated?.name || "",
                surpriseWork: report.quarterAwards.surpriseWork?.name || "",
                surpriseDelta: report.quarterAwards.surpriseDelta
              },
              mainCharacters: filterQuarterCharacters(report.quarterCharacters, "main")
                .slice(0, 8)
                .map((character) => character.name),
              supportCharacters: filterQuarterCharacters(report.quarterCharacters, "support")
                .slice(0, 8)
                .map((character) => character.name)
            } : {})
          };
          const response = await window.bgmApi.aiChat({
            baseUrl: database.value.settings.aiBaseUrl,
            apiKey: aiApiKey.value,
            model: database.value.settings.aiModel,
            messages: [
              {
                role: "system",
                content: `${database.value.settings.aiSystemPrompt || HARUNA_SYSTEM_PROMPT}
你要总结并锐评一份${periodTypeLabel(report.type)}。输出2到3句、80到160字。必须结合计数、自动提取的情绪线索（不要当作心理诊断）、在看作品的具体集数、完成作品和代表性记录，指出一个自我欺骗或数据盲点，并给一条具体而不客套的建议。${report.type === "quarter" ? "还要结合季度奖项和本季角色档案。" : ""}不要写标题。`
              },
              { role: "user", content: `回顾数据：${JSON.stringify(summary)}` }
            ]
          });
          if (response.ok && String(response.content || "").trim()) {
            content = String(response.content).trim().slice(0, 800);
            source = "ai";
          } else {
            appendDebug(`周月记 AI 锐评失败，使用本地吐槽：${response.error || "空回复"}`, "error");
          }
        }
        report.harunaComment = {
          content,
          source,
          generatedAt: new Date().toISOString()
        };
        database.value.periodReports[report.key] = report;
        await persistDatabase();
        periodReviewKey.value = report.key;
        showToast(source === "ai" ? "春菜完成了本期总结。" : "春菜用本地数据重写了本期吐槽。");
      } catch (error) {
        appendDebug(`期间回顾春菜总结异常：${error.message}`, "error");
        showToast(`春菜总结失败：${error.message}`, true);
      } finally {
        periodReviewCritiqueBusy.value = false;
      }
    }

    function openPeriodHighlight(highlight) {
      const post = database.value.posts.find((item) => item.id === highlight?.id);
      if (!post) return;
      if (post.kind === "article") openArticle(post);
      else void openYearbookAward({ kind: "note", post });
    }

    function generateYearbook(showFeedback = true) {
      yearbookGeneratedAt.value = new Date().toISOString();
      const key = String(yearbookYear.value);
      if (!database.value.yearbookComments[key]) {
        database.value.yearbookComments[key] = {
          content: localYearbookCritique(
            yearbook.value,
            yearbookCompareEnabled.value ? yearbookComparison.value : null
          ),
          source: "local",
          generatedAt: new Date().toISOString()
        };
        void persistDatabase();
      }
      if (showFeedback) {
        updateMascot(`${yearbookYear.value} 年的记录已经重新摆上桌……有些东西最好别细看。`);
        showToast(`${yearbookYear.value} 年个人年鉴已重新评选。`);
      }
    }

    async function openYearbookAward(award) {
      if (!award) return;
      if (award.kind === "subject") {
        await openSubjectDetail(award.subject);
      } else if (award.kind === "episode") {
        await openSubjectDetail(award.subject, award.episode);
      } else if (award.kind === "article" && award.post) {
        openArticle(award.post);
      } else if (award.kind === "note" && award.post) {
        selectedDateKey.value = formatDateKey(award.post.createdAt);
        activeTag.value = "";
        activeMonth.value = "";
        activeEmotion.value = "";
        currentArticle.value = null;
        currentTab.value = "timeline";
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (award.kind === "tag") {
        filterByTag(award.tag);
      } else if (award.kind === "emoji") {
        filterByEmotion(award.emoji.code);
      } else if (award.kind === "month") {
        filterByMonth(award.month);
      }
    }

    function loadCaptureImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("无法读取年鉴截图区块。"));
        image.src = dataUrl;
      });
    }

    function waitForPagePaint() {
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    async function captureYearbookLongImage(root, filePath) {
      const totalHeight = Math.ceil(root.scrollHeight);
      const viewportHeight = window.innerHeight;
      const firstBounds = root.getBoundingClientRect();
      const captureWidth = Math.ceil(firstBounds.width);
      const captureX = Math.max(0, Math.floor(firstBounds.left));
      const canvas = document.createElement("canvas");
      let context = null;
      let scale = 1;
      let targetY = 0;
      let previousY = -1;

      while (targetY < totalHeight) {
        window.scrollTo(0, targetY);
        await waitForPagePaint();
        const actualY = Math.round(window.scrollY);
        if (actualY === previousY) break;
        previousY = actualY;
        const capture = await window.bgmApi.captureYearbookViewport({
          rect: {
            x: captureX,
            y: 0,
            width: captureWidth,
            height: viewportHeight
          }
        });
        if (!capture.ok) throw new Error(capture.error || "截取年鉴区块失败。");
        const image = await loadCaptureImage(capture.dataUrl);
        if (!context) {
          scale = image.naturalWidth / captureWidth;
          canvas.width = image.naturalWidth;
          canvas.height = Math.ceil(totalHeight * scale);
          context = canvas.getContext("2d");
          if (!context) throw new Error("无法创建长图画布。");
        }
        const remainingCss = Math.max(0, totalHeight - actualY);
        const sourceHeight = Math.min(image.naturalHeight, Math.round(Math.min(viewportHeight, remainingCss) * scale));
        if (sourceHeight <= 0) break;
        context.drawImage(
          image,
          0,
          0,
          image.naturalWidth,
          sourceHeight,
          0,
          Math.round(actualY * scale),
          image.naturalWidth,
          sourceHeight
        );
        targetY = actualY + viewportHeight;
      }

      if (!context) throw new Error("年鉴长图没有生成任何内容。");
      const dataUrl = canvas.toDataURL("image/png");
      const result = await window.bgmApi.saveYearbookImage({ filePath, dataUrl });
      return {
        ...result,
        size: result.ok ? { width: canvas.width, height: canvas.height } : null
      };
    }

    async function exportYearbook() {
      if (yearbookExportBusy.value) return;
      if (!platformCapabilities.yearbookImage) {
        showToast("当前平台暂不支持年鉴长图导出。", true);
        return;
      }
      const value = yearbook.value;
      if (!value.posts.length && !value.works.length) {
        showToast("这一年还没有可导出的年鉴内容。", true);
        return;
      }
      const destination = await window.bgmApi.chooseYearbookImage({
        filename: `${value.year}-personal-yearbook.png`
      });
      if (destination.canceled) return;
      if (!destination.ok || !destination.filePath) {
        showToast(`无法选择长图保存位置：${destination.error || "未知错误"}`, true);
        return;
      }

      const root = yearbookExportRef.value;
      if (!root) {
        showToast("年鉴内容尚未准备好。", true);
        return;
      }
      const previousScroll = { x: window.scrollX, y: window.scrollY };
      const previousWidth = root.style.width;
      yearbookExportBusy.value = true;
      yearbookExporting.value = true;
      yearbookDayHover.value = null;
      let result = { ok: false, error: "未生成截图。" };
      try {
        document.body.classList.add("yearbook-exporting");
        root.style.width = `${Math.min(1120, Math.max(320, Math.floor(window.innerWidth - 48)))}px`;
        window.scrollTo(0, 0);
        await nextTick();
        await document.fonts?.ready;
        const images = [...root.querySelectorAll("img")];
        await Promise.race([
          Promise.all(images.map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            });
          })),
          new Promise((resolve) => setTimeout(resolve, 4000))
        ]);
        await waitForPagePaint();
        window.scrollTo(0, 0);
        result = await captureYearbookLongImage(root, destination.filePath);
      } catch (error) {
        result = { ok: false, error: error.message };
      } finally {
        document.body.classList.remove("yearbook-exporting");
        root.style.width = previousWidth;
        yearbookExporting.value = false;
        yearbookExportBusy.value = false;
        window.scrollTo(previousScroll.x, previousScroll.y);
      }
      if (result.ok) {
        const size = result.size ? ` · ${result.size.width}×${result.size.height}` : "";
        appendDebug(`年度年鉴长图导出成功：${result.path}${size}`, "success");
        showToast("年度年鉴长图已导出。");
      } else {
        showToast(`年鉴长图导出失败：${result.error}`, true);
      }
    }

    const aiConfigured = computed(() =>
      Boolean(String(database.value.settings.aiBaseUrl || "").trim() && String(database.value.settings.aiModel || "").trim())
    );
    const aiDisplayMessages = computed(() => {
      const messages = database.value.chatMessages.slice(-10);
      if (messages.length) return messages;
      return [{
        id: "assistant-welcome",
        role: "assistant",
        content: aiConfigured.value
          ? "我已经连上你配置的 AI 服务。可以一起回顾记录、整理标签，或者把最近的碎碎念变成一篇长文。"
          : "我还处在本地建议模式。可以先让我回顾记录、建议标签或起标题；连接 AI 后会在这里进行完整对话。"
      }];
    });
    const aiWebSrc = computed(() => String(database.value.settings.aiWebUrl || "").trim());

    function localAssistantReply(text) {
      const prompt = String(text || "").toLowerCase();
      if (prompt.includes("回顾") || prompt.includes("总结")) {
        const emoji = stats.value.topEmoji[0] ? `最常用的是 ${stats.value.topEmoji[0].code}。` : "还没有常用表情数据。";
        return `最近一共留下 ${stats.value.totalPosts} 条记录、${formatNumber(stats.value.words)} 字。${emoji} 你可以在下方“记录回顾”里查看评分分布，或点击标签和日历继续筛选。`;
      }
      if (prompt.includes("标签")) {
        const tags = topTags.value.slice(0, 5).map((tag) => `#${tag.name}`).join("、");
        return tags ? `根据现有记录，可以继续沿用这些标签：${tags}。写日志时用空格分隔多个标签，它们会自动出现在即时博客顶部。` : "现在还没有标签。发布第一条记录时写 `#动画`、`#随笔` 之类的标签，就会生成顶部筛选栏。";
      }
      if (prompt.includes("标题")) {
        const recent = allPostsSorted.value[0];
        return recent ? `可以从最近这条记录里提炼标题：《${excerpt(recent.title || recent.content, 18)}》。再短一点，也可以直接用作品名加一个动作。` : "先写一段内容，我就能根据正文帮你提炼更具体的标题。";
      }
      if (prompt.includes("背景") || prompt.includes("主题")) {
        return "打开右上角系统设置，在“外观与背景”里可以更换主题色、选择本地背景图片并调整图片强度。设置会即时生效并保存在本机。";
      }
      return "我现在可以离线帮你回顾记录、整理标签和起草标题。配置 OpenAI 兼容接口后，就能在这里进行真正的 AI 对话，也可以在设置里指定 AI 网页地址并在应用内打开。";
    }

    function buildAiContext() {
      const recentPosts = allPostsSorted.value.slice(0, 6).map((post) => {
        return `- ${formatDate(post.createdAt)} ${post.kind === "article" ? "长文" : "碎碎念"}：${excerpt(`${post.title || ""} ${post.content}`, 220)}`;
      });
      const collections = watchingSubjects.value.slice(0, 5).map((subject) =>
        `- ${subject.name}：${collectionStatusLabel(subject.status, subject.type)}，${progressLabel(subject)}`
      );
      return [
        recentPosts.length ? `最近记录：\n${recentPosts.join("\n")}` : "",
        collections.length ? `正在看或玩：\n${collections.join("\n")}` : ""
      ].filter(Boolean).join("\n\n").slice(0, 7000);
    }

    async function scrollAiThreadToBottom() {
      await nextTick();
      if (aiThread.value) aiThread.value.scrollTop = aiThread.value.scrollHeight;
    }

    async function sendAiMessage(preset = "") {
      const content = String(preset || aiInput.value || "").trim();
      if (!content || aiBusy.value) return;
      aiError.value = "";
      database.value.chatMessages.push({
        id: createId("chat"),
        role: "user",
        content,
        createdAt: new Date().toISOString()
      });
      aiInput.value = "";
      aiBusy.value = true;
      await scrollAiThreadToBottom();
      try {
        let reply = "";
        if (aiConfigured.value) {
          const system = [
            database.value.settings.aiSystemPrompt || "你是番组手帐里的春菜，用简洁、温暖的中文回答。",
            buildAiContext()
          ].filter(Boolean).join("\n\n");
          const messages = [
            { role: "system", content: system },
            ...database.value.chatMessages.slice(-12).map((message) => ({
              role: message.role,
              content: String(message.content).slice(0, 8000)
            }))
          ];
          const response = await window.bgmApi.aiChat({
            baseUrl: database.value.settings.aiBaseUrl,
            apiKey: aiApiKey.value,
            model: database.value.settings.aiModel,
            messages
          });
          if (!response.ok) throw new Error(response.error || "AI 请求失败。");
          reply = String(response.content || "").trim();
          appendDebug(`AI 对话完成 · HTTP ${response.status}`, "success");
        } else {
          await new Promise((resolve) => setTimeout(resolve, 180));
          reply = localAssistantReply(content);
        }
        if (reply) {
          database.value.chatMessages.push({
            id: createId("chat"),
            role: "assistant",
            content: reply.slice(0, 12000),
            createdAt: new Date().toISOString()
          });
          database.value.chatMessages = database.value.chatMessages.slice(-60);
          mascotLine.value = reply.slice(0, 120);
          await persistDatabase();
        }
      } catch (error) {
        aiError.value = error.message;
        appendDebug(`春菜 AI 请求失败：${error.message}`, "error");
      } finally {
        aiBusy.value = false;
        await scrollAiThreadToBottom();
      }
    }

    const harunaEvaluatingIds = ref([]);

    function isHarunaEvaluating(postId) {
      return harunaEvaluatingIds.value.includes(postId);
    }

    function trimHarunaComment(value) {
      const clean = String(value || "")
        .replace(/^["“”']+|["“”']+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return Array.from(clean).slice(0, 40).join("");
    }

    function localHarunaEvaluation(post) {
      const content = String(post.content || "");
      const subjectName = post.subject?.name || "";
      if (post.kind === "article" && content.length > 260) return "写这么长，像在跟谁较劲……算了，我会勉强看完。";
      if (post.kind === "article") return "字数是够了——可认真这件事，装起来不累吗？先留着。";
      if (post.images?.length) return "图倒像证据；情绪嘛，还在努力找借口吧？";
      if (subjectName) return `为《${subjectName.slice(0, 10)}》留下这句……至少这次没交给进度条。`;
      if (content.length < 30) return "挺会说。日志可不会替你承担后果……继续。";
      return "情绪写得挺诚实——诚实到让人有点不想接话。然后呢？";
    }

    async function evaluatePublishedPost(post) {
      if (!post?.id) return;
      harunaEvaluatingIds.value = [...harunaEvaluatingIds.value, post.id];
      const task = [
        `请评价刚发布的${post.kind === "article" ? "长文" : "即时吐槽"}。`,
        "只输出20-40字短评，不要标题、列表或解释。",
        post.subject?.name ? `关联作品：${post.subject.name}` : "",
        post.subject?.episodeLabel ? `关联章节：${post.subject.episodeLabel}` : "",
        post.title ? `标题：${post.title}` : "",
        `正文：${String(post.content || "").slice(0, 5000)}`
      ].filter(Boolean).join("\n");
      let comment = "";
      try {
        if (aiConfigured.value) {
          const response = await window.bgmApi.aiChat({
            baseUrl: database.value.settings.aiBaseUrl,
            apiKey: aiApiKey.value,
            model: database.value.settings.aiModel,
            messages: [
              {
                role: "system",
                content: `${database.value.settings.aiSystemPrompt || HARUNA_SYSTEM_PROMPT}\n只输出20-40字短评，不附加标题或解释。`
              },
              { role: "user", content: task }
            ]
          });
          if (response.ok) comment = trimHarunaComment(response.content);
          else appendDebug(`春菜发布短评失败，使用本地吐槽：${response.error}`, "error");
        }
        if (!comment) comment = localHarunaEvaluation(post);
        const stored = database.value.posts.find((item) => item.id === post.id);
        if (stored) {
          stored.harunaComment = comment;
          stored.harunaCommentAt = new Date().toISOString();
        }
        await persistDatabase();
      } catch (error) {
        appendDebug(`春菜发布短评异常：${error.message}`, "error");
      } finally {
        harunaEvaluatingIds.value = harunaEvaluatingIds.value.filter((id) => id !== post.id);
      }
    }

    function clearAiConversation() {
      askConfirm("确定清空与春菜的全部对话吗？日志、主题和 Bangumi 数据不会受影响。", async () => {
        database.value.chatMessages = [];
        await persistDatabase();
        showToast("春菜对话已清空。");
      }, "清空对话");
    }

    async function testAiConnection() {
      if (aiTesting.value) return;
      const baseUrl = settingsForm.aiBaseUrl.trim().replace(/\/+$/, "");
      const model = settingsForm.aiModel.trim();
      aiTestStatus.value = "";
      if (!baseUrl || !model) {
        aiTestStatus.value = "请先填写 API 地址和模型名称。";
        showToast(aiTestStatus.value, true);
        return;
      }
      try {
        validateAiBaseUrl(baseUrl);
      } catch (error) {
        aiTestStatus.value = error.message;
        showToast(error.message, true);
        return;
      }

      aiTesting.value = true;
      aiTestStatus.value = "正在通过系统代理连接 AI 服务…";
      try {
        const response = await window.bgmApi.aiChat({
          baseUrl,
          apiKey: aiApiKey.value,
          model,
          messages: [
            { role: "system", content: "只回复“连接成功”。" },
            { role: "user", content: "测试连接" }
          ]
        });
        if (!response.ok) throw new Error(response.error || "AI 服务没有返回有效结果。");
        aiTestStatus.value = `连接成功 · HTTP ${response.status} · ${String(response.content || "").slice(0, 30)}`;
        showToast("春菜 AI 连接成功。");
        appendDebug(`AI 连接测试成功 · HTTP ${response.status}`, "success");
      } catch (error) {
        aiTestStatus.value = `连接失败：${error.message}`;
        showToast(`AI 连接失败：${error.message}`, true);
        appendDebug(`AI 连接测试失败：${error.message}`, "error");
      } finally {
        aiTesting.value = false;
      }
    }

    async function saveAiSettings(showMessage = true) {
      const baseUrl = settingsForm.aiBaseUrl.trim().replace(/\/+$/, "");
      const model = settingsForm.aiModel.trim();
      const webUrl = settingsForm.aiWebUrl.trim();
      if (baseUrl) {
        try {
          const parsed = new URL(baseUrl);
          if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))) {
            throw new Error("AI API 地址必须使用 HTTPS，或使用 localhost 本地服务。");
          }
        } catch (error) {
          showToast(error.message, true);
          return false;
        }
      }
      if (webUrl) {
        try {
          const parsed = new URL(webUrl);
          if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))) {
            throw new Error("AI 网页地址必须使用 HTTPS。");
          }
        } catch (error) {
          showToast(error.message, true);
          return false;
        }
      }
      database.value.settings.aiBaseUrl = baseUrl;
      database.value.settings.aiModel = model;
      database.value.settings.aiSystemPrompt = settingsForm.aiSystemPrompt.trim();
      database.value.settings.aiWebUrl = webUrl;
      aiApiKey.value = aiApiKey.value.trim();
      if (aiApiKey.value) localStorage.setItem(STORAGE_AI_KEY, aiApiKey.value);
      else localStorage.removeItem(STORAGE_AI_KEY);
      await persistDatabase();
      if (showMessage) showToast("AI 设置已保存。");
      return true;
    }

    async function openAiWeb() {
      settingsForm.aiWebUrl = settingsForm.aiWebUrl.trim();
      if (!settingsForm.aiWebUrl) {
        showToast("请先填写 AI 网页地址。", true);
        return;
      }
      if (!await saveAiSettings(false)) return;
      showAiWeb.value = true;
      showSettings.value = false;
    }

    function closeAiWeb() {
      showAiWeb.value = false;
    }

    async function focusAiInput() {
      await nextTick();
      aiInputRef.value?.focus();
    }

    async function greetHaruna() {
      harunaGreeting.value = false;
      await nextTick();
      harunaGreeting.value = true;
      mascotLine.value = ["今天也一起记录吧。", "我在这里，想聊哪一段？", "先写一句，也算今天留下了什么。"][Math.floor(Math.random() * 3)];
      setTimeout(() => {
        harunaGreeting.value = false;
      }, 1100);
      await focusAiInput();
    }

    const importableCollectionCount = computed(() => {
      const imported = new Set(database.value.posts.map((post) => post.sourceKey).filter(Boolean));
      return database.value.collections.filter((subject) => {
        return (subject.comment || subject.myScore) && !imported.has(`bangumi-collection:${subject.bangumiId}`);
      }).length;
    });

    function subjectTypeLabel(type) {
      return subjectTypes.find((entry) => Number(entry.value) === Number(type))?.label || "其他";
    }

    function moodLabel(value) {
      return MOOD_OPTIONS.find((option) => option.value === value)?.label || "未记录";
    }

    function inferMoodSignal(content) {
      const text = String(content || "");
      if (!text) return "";
      let winner = "";
      let winnerScore = 0;
      for (const [value, keywords] of Object.entries(MOOD_KEYWORDS)) {
        const score = keywords.reduce(
          (sum, keyword) => sum + (text.includes(keyword) ? text.split(keyword).length - 1 : 0),
          0
        );
        if (score > winnerScore) {
          winner = value;
          winnerScore = score;
        }
      }
      return winner;
    }

    function collectionStatusLabel(status, type = 2) {
      const labels = Number(type) === 1
        ? ["未收藏", "想读", "读过", "在读", "搁置", "抛弃"]
        : Number(type) === 4
          ? ["未收藏", "想玩", "玩过", "在玩", "搁置", "抛弃"]
          : Number(type) === 3
            ? ["未收藏", "想听", "听过", "在听", "搁置", "抛弃"]
            : ["未收藏", "想看", "看过", "在看", "搁置", "抛弃"];
      return labels[Number(status)] || "未收藏";
    }

    function progressPercent(subject) {
      if (!subject.epTotal || !subject.episode) return 0;
      return Math.min(100, Math.max(0, Math.round((subject.episode / subject.epTotal) * 100)));
    }

    function progressLabel(subject) {
      if (subject.epTotal) return `${subject.episode || 0} / ${subject.epTotal} 话`;
      if (subject.episode) return `EP.${padNumber(subject.episode, 2)}`;
      return collectionStatusLabel(subject.status, subject.type);
    }

    function setTab(tab) {
      if (tab === "blog") currentArticle.value = null;
      currentTab.value = tab;
      if (tab === "yearbook") generateYearbook(false);
      if (tab === "reviews") void checkScheduledPeriodReports();
      if (tab === "subjects") {
        void loadAiringCalendar();
        if (!queueRecommendationResults.value.length) void refreshQueueRecommendations(false);
      }
      const viewLines = {
        timeline: "即时博客把碎碎念和长文放在一起，今天也留一句吧。",
        blog: "长文会在右侧展开目录，章节再多也不会迷路。",
        subjects: "档案库会按类型和收藏状态整理全部作品。",
        reviews: "周记收住这一周，月记替你翻出那些没有被遗忘的记录。",
        yearbook: "把这一年的偏爱、后悔和废话一起装订起来。"
      };
      if (viewLines[tab]) updateMascot(viewLines[tab]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function goSubjectDetailTab() {
      if (selectedSubject.value) {
        currentTab.value = "subject-detail";
      } else if (allSubjects.value.length) {
        openSubjectDetail(allSubjects.value[0]);
      } else {
        setTab("subjects");
        showToast("先从档案库同步或选择一部作品。");
      }
    }

    function openArticle(post) {
      if (!post || post.kind !== "article") return;
      currentArticle.value = post;
      currentTab.value = "blog";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function closeArticle() {
      currentArticle.value = null;
      currentTab.value = "timeline";
    }

    function scrollToHeading(id) {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function setEditorKind(kind) {
      editor.kind = kind;
      nextTick(() => (kind === "article" ? titleInput.value : editorInput.value)?.focus());
    }

    function focusComposer() {
      currentTab.value = "timeline";
      nextTick(() => editorInput.value?.focus());
    }

    function syncEditorContentFromDom(value) {
      const content = typeof value === "string" ? value : "";
      if (editor.content !== content) editor.content = content;
    }

    function handleEditorContentInput(event) {
      syncEditorContentFromDom(event?.target?.value);
    }

    function applyEditorContentToDom(value) {
      const textarea = editorInput.value;
      const content = String(value ?? "");
      if (textarea && textarea.value !== content) textarea.value = content;
    }

    function setEditorContent(value) {
      editor.content = String(value ?? "");
      nextTick(() => applyEditorContentToDom(editor.content));
    }

    function resetEditor() {
      editor.kind = "note";
      editor.title = "";
      setEditorContent("");
      editor.category = "";
      editor.tagsText = "";
      editor.images = [];
      editor.subject = null;
      editor.rating = 0;
      editor.pinned = false;
      editor.harunaCommentEnabled = false;
      editor.privacy = "public";
      editor.preview = false;
      editor.editingId = null;
      editorError.value = "";
      availableEpisodes.value = [];
    }

    function editPost(post) {
      currentTab.value = "timeline";
      currentArticle.value = null;
      editor.kind = post.kind;
      editor.title = post.title || "";
      setEditorContent(post.content || "");
      editor.category = post.category || "";
      editor.tagsText = (post.tags || []).join(" ");
      editor.images = JSON.parse(JSON.stringify(post.images || []));
      editor.subject = post.subject ? normalizeSubject(post.subject) : null;
      editor.rating = Number(post.rating) || 0;
      editor.pinned = Boolean(post.pinned);
      editor.harunaCommentEnabled = false;
      editor.privacy = post.privacy || "public";
      editor.preview = false;
      editor.editingId = post.id;
      editorError.value = "";
      availableEpisodes.value = [];
      if (editor.subject?.bangumiId) loadEpisodesFor(editor.subject);
      nextTick(() => editorInput.value?.focus());
    }

    function tagsFromEditor(content, tagsText) {
      const tags = new Set(
        String(tagsText || "")
          .split(/[\s,，]+/)
          .map((tag) => tag.replace(/^#/, "").trim())
          .filter(Boolean)
      );
      const matches = String(content || "").match(/(^|\s)#([\p{L}\p{N}_-]+)/gu) || [];
      for (const match of matches) {
        const tag = match.replace(/^\s*#/, "");
        if (tag) tags.add(tag);
      }
      return [...tags].slice(0, 20);
    }

    async function publishPost() {
      editorError.value = "";
      const requestHarunaComment = editor.harunaCommentEnabled;
      const hasContent = Boolean(editor.content.trim());
      const hasImages = editor.images.length > 0;
      if (!hasContent && !hasImages) {
        editorError.value = "写点文字或加入一张图片后即可发布。";
        editorInput.value?.focus();
        return;
      }

      const now = new Date().toISOString();
      const existing = editor.editingId
        ? database.value.posts.find((post) => post.id === editor.editingId)
        : null;
      const post = normalizePost({
        id: existing?.id || createId("post"),
        kind: editor.kind,
        title: editor.title.trim(),
        content: editor.content,
        category: editor.category.trim(),
        tags: tagsFromEditor(editor.content, editor.tagsText),
        images: JSON.parse(JSON.stringify(editor.images)),
        subject: editor.subject ? JSON.parse(JSON.stringify(editor.subject)) : null,
        rating: editor.rating,
        pinned: editor.pinned,
        harunaComment: existing?.harunaComment || "",
        harunaCommentAt: existing?.harunaCommentAt || "",
        privacy: "public",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        sourceKey: existing?.sourceKey || ""
      });

      if (existing) {
        const index = database.value.posts.findIndex((item) => item.id === existing.id);
        database.value.posts.splice(index, 1, post);
        showToast("日志已更新并保存到本地。");
        updateMascot("修改已经写回本机，阅读入口也同步更新了。");
      } else {
        database.value.posts.unshift(post);
        showToast("发布成功，内容已保存到本地。");
        updateMascot("发布成功。新记录已经写进本地数据库。");
      }

      if (post.subject?.bangumiId) {
        const cached = normalizeSubject(post.subject);
        database.value.subjectCache[post.subject.bangumiId] = cached;
      }
      appendDebug(`${existing ? "更新" : "发布"}日志 ${post.id}，${countWords(post.content)} 字`, "success");
      await persistDatabase();
      resetEditor();
      if (requestHarunaComment) void evaluatePublishedPost(post);
    }

    function askConfirm(message, action, confirmLabel = "确认") {
      confirmState.value = { message, action, confirmLabel };
    }

    function closeConfirm() {
      confirmState.value = null;
    }

    async function runConfirm() {
      const action = confirmState.value?.action;
      confirmState.value = null;
      if (typeof action === "function") await action();
    }

    function deletePost(post) {
      askConfirm(`确定删除“${post.title || excerpt(post.content, 24)}”吗？删除后只能通过此前的备份恢复。`, async () => {
        markSyncDeleted("posts", post.id);
        database.value.posts = database.value.posts.filter((item) => item.id !== post.id);
        if (currentArticle.value?.id === post.id) currentArticle.value = null;
        await persistDatabase();
        showToast("日志已删除。");
        updateMascot("这条日志已经从本机删除。");
      }, "删除");
    }

    function triggerImagePicker() {
      imageInput.value?.click();
    }

    async function handleFileInput(event) {
      await addImageFiles(event.target.files);
      event.target.value = "";
    }

    async function handlePaste(event) {
      const files = [...(event.clipboardData?.items || [])]
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      await addImageFiles(files);
    }

    async function handleDrop(event) {
      isDragging.value = false;
      const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
      if (files.length) await addImageFiles(files);
    }

    async function addImageFiles(fileList) {
      const files = [...(fileList || [])];
      if (!files.length) return;
      const remaining = 9 - editor.images.length;
      if (remaining <= 0) {
        showToast("一条日志最多保存 9 张图片。", true);
        return;
      }
      for (const file of files.slice(0, remaining)) {
        try {
          const dataUrl = await compressImage(file);
          editor.images.push({
            id: createId("image"),
            name: file.name || "粘贴图片",
            dataUrl
          });
        } catch (error) {
          appendDebug(`图片处理失败：${file.name || "未知文件"} · ${error.message}`, "error");
          showToast(`无法处理图片：${file.name || "未知文件"}`, true);
        }
      }
      if (files.length > remaining) showToast("超过 9 张的图片未加入。", true);
    }

    async function compressImage(file, maxSide = 1600, quality = 0.82) {
      if (!file.type.startsWith("image/")) throw new Error("不是图片文件");
      if (file.size > 18 * 1024 * 1024) throw new Error("单张图片超过 18MB");
      const objectUrl = URL.createObjectURL(file);
      try {
        const image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error("图片解码失败"));
          element.src = objectUrl;
        });
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: true });
        context.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL("image/webp", quality);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    function removeEditorImage(index) {
      editor.images.splice(index, 1);
    }

    function insertText(text) {
      const textarea = editorInput.value;
      const current = textarea?.value ?? editor.content;
      const start = emojiInsertRange?.start ?? textarea?.selectionStart ?? current.length;
      const end = emojiInsertRange?.end ?? textarea?.selectionEnd ?? current.length;
      setEditorContent(`${current.slice(0, start)}${text}${current.slice(end)}`);
      emojiInsertRange = { start: start + text.length, end: start + text.length };
      nextTick(() => {
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
      });
    }

    function insertMask() {
      insertText("[mask]在这里写剧透内容[/mask]");
      showToast("黑幕已插入，可替换中间文字。");
    }

    function insertQuote() {
      insertText("[quote]引用内容[/quote]");
    }

    function openImageUrlModal() {
      imageUrlInput.value = "";
      showImageUrlModal.value = true;
      nextTick(() => document.querySelector(".image-url-form input")?.focus());
    }

    function closeImageUrlModal() {
      showImageUrlModal.value = false;
    }

    function insertImageUrl() {
      const url = imageUrlInput.value.trim();
      if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) {
        showToast("请输入有效的 http(s) 图片地址。", true);
        return;
      }
      insertText(`\n![外链图片](${url})\n`);
      showImageUrlModal.value = false;
      showToast("外链图片 Markdown 已插入。");
    }

    function openEmojiPicker() {
      const textarea = editorInput.value;
      emojiInsertRange = {
        start: textarea?.selectionStart ?? editor.content.length,
        end: textarea?.selectionEnd ?? editor.content.length
      };
      lastInsertedEmoji.value = "";
      showEmojiPicker.value = true;
      nextTick(() => document.querySelector(".emoji-grid button")?.focus());
    }

    function closeEmojiPicker() {
      showEmojiPicker.value = false;
      emojiInsertRange = null;
      lastInsertedEmoji.value = "";
    }

    function insertEmojiCode(code) {
      insertText(code);
      lastInsertedEmoji.value = code;
    }

    function emojiPreviewUrl(code) {
      const match = String(code || "").match(/^\(bgm(\d+)\)$/);
      if (!match) return "";
      const number = Number(match[1]);
      return number >= 24 && number <= 125 ? emojiUrl(number) : "";
    }

    function tvEmojiUrl(number) {
      return emojiUrl(number);
    }

    function addCustomEmoji() {
      const name = customEmojiForm.name.trim().replace(/[^\p{L}\p{N}_-]/gu, "");
      const url = customEmojiForm.url.trim();
      if (!name) {
        showToast("请输入自定义表情名称。", true);
        return;
      }
      if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) {
        showToast("请输入图片 URL 或 data:image 地址。", true);
        return;
      }
      const existing = database.value.settings.customEmojis.find((emoji) => emoji.name === name);
      if (existing) existing.url = url;
      else database.value.settings.customEmojis.push({ name, url });
      CUSTOM_EMOJI_MAP.set(name, url);
      customEmojiForm.name = "";
      customEmojiForm.url = "";
      showToast(`已导入自定义表情 [emoji:${name}]。`);
    }

    function removeCustomEmoji(name) {
      markSyncDeleted("customEmojis", name);
      database.value.settings.customEmojis = database.value.settings.customEmojis.filter((emoji) => emoji.name !== name);
      CUSTOM_EMOJI_MAP.delete(name);
    }

    function openLightbox(image, index) {
      lightboxImage.value = { ...image, name: `${image.name || "图片"} · ${index + 1}` };
    }

    function closeLightbox() {
      lightboxImage.value = null;
    }

    async function bgmRequest(path, options = {}) {
      const { method = "GET", body, quiet = false } = options;
      const url = path.startsWith("https://") ? path : `https://api.bgm.tv/v0${path}`;
      const response = await window.bgmApi.requestBangumi({
        url,
        method,
        body,
        token: token.value
      });
      if (!quiet) {
        const status = response.status || 0;
        const level = response.ok ? "success" : "error";
        appendDebug(`${method} ${url} → ${status} ${response.statusText || ""}`.trim(), level);
      }
      if (!response.ok) {
        const detail = response.error || response.data?.description || response.data?.message || response.statusText || "请求失败";
        throw new Error(`HTTP ${response.status || 0}: ${detail}`);
      }
      return response.data;
    }

    async function fetchAllCollections(realUsername, onProgress) {
      let items = [];
      let offset = 0;
      const limit = 50;
      while (true) {
        const url = `/users/${encodeURIComponent(realUsername)}/collections?limit=${limit}&offset=${offset}`;
        const json = await bgmRequest(url);
        const page = Array.isArray(json?.data) ? json.data : [];
        if (!page.length) break;
        items.push(...page);
        offset += limit;
        if (typeof onProgress === "function") onProgress(items.length, Number(json.total) || items.length);
        if (Number.isFinite(Number(json.total)) && items.length >= Number(json.total)) break;
        if (page.length < limit) break;
      }
      return items;
    }

    function mapCollection(item) {
      const source = item?.subject || {};
      const subject = normalizeSubject({
        ...source,
        id: item.subject_id || source.id,
        bangumiId: item.subject_id || source.id,
        type: item.subject_type || source.type,
        subject_type: item.subject_type,
        status: item.type,
        typeCollection: item.type,
        myScore: item.rate,
        rate: item.rate,
        comment: item.comment,
        episode: item.ep_status,
        ep_status: item.ep_status,
        updatedAt: item.updated_at,
        updated_at: item.updated_at
      });
      return subject;
    }

    async function syncBangumiData(options = {}) {
      if (options instanceof Event) options = {};
      const silentIfUnconfigured = Boolean(options.silentIfUnconfigured);
      if (syncing.value) return;
      const username = cleanUsername(database.value.settings.username || settingsForm.username);
      const accessToken = token.value.trim();
      if (!username && !accessToken) {
        if (!silentIfUnconfigured) {
          showToast("请先在设置中填写 Bangumi 用户名或 Access Token。", true);
          openSettings();
        }
        return;
      }
      syncing.value = true;
      syncStatus.state = "active";
      syncStatus.text = "正在验证身份 /v0/me…";
      syncStatus.short = "验证身份";
      updateMascot("正在确认 Bangumi 身份，本地界面可以继续使用。");
      try {
        let me = null;
        let userData = null;
        let realUsername = username;
        if (accessToken) {
          syncStatus.text = "正在验证身份 /v0/me…";
          me = await bgmRequest("/me");
          realUsername = String(me.username || me.id || username);
          if (realUsername) {
            userData = await bgmRequest(`/users/${encodeURIComponent(realUsername)}`, { quiet: true }).catch(() => null);
          }
        } else {
          syncStatus.text = `正在读取用户 ${username}…`;
          userData = await bgmRequest(`/users/${encodeURIComponent(username)}`);
          realUsername = String(userData.username || username);
        }
        if (!realUsername) throw new Error("无法从 Bangumi 返回结果中识别真实 UID/用户名。");

        const profileSource = { ...(userData || {}), ...(me || {}) };
        const avatar = profileSource.avatar || userData?.avatar || {};
        database.value.profile = {
          id: profileSource.id || userData?.id || null,
          username: profileSource.username || userData?.username || realUsername,
          nickname: profileSource.nickname || profileSource.username || realUsername,
          sign: profileSource.sign || userData?.sign || "",
          avatar: avatar.large || avatar.medium || avatar.small || profileSource.avatar?.large || ""
        };
        database.value.settings.username = realUsername;
        settingsForm.username = realUsername;
        appendDebug(`真实用户：${database.value.profile.nickname} (@${database.value.profile.username})`, "success");

        syncStatus.text = "正在拉取收藏 (0 / ?)…";
        const rawCollections = await fetchAllCollections(realUsername, (count, total) => {
          syncStatus.text = `正在拉取收藏 (${count} / ${total || "?"})…`;
          syncStatus.short = `${count} / ${total || "?"}`;
          if (count === 50 || count % 100 === 0) appendDebug(`收藏分页进度：${count} / ${total || "?"}`);
        });
        const collections = rawCollections.map(mapCollection).filter(Boolean);
        appendDebug(`收藏接口返回总数：${rawCollections.length} 部`, "success");
        const cache = { ...(database.value.subjectCache || {}) };
        for (const subject of collections) cache[subject.bangumiId] = subject;
        database.value.collections = collections;
        database.value.subjectCache = cache;
        database.value.lastSyncAt = new Date().toISOString();
        const importedComments = await importCollectionComments({ silent: true, persist: false });
        syncStatus.state = "ok";
        syncStatus.text = `已成功同步 ${collections.length} 部作品${importedComments ? `，导入 ${importedComments} 条漫评` : ""}`;
        syncStatus.short = `同步 ${collections.length} 部`;
        updateMascot(`同步完成，${collections.length} 部收藏回到了本地档案库。${importedComments ? `新增 ${importedComments} 条 Bangumi 漫评。` : ""}`);
        appendDebug(`同步完成：${collections.length} 部作品${importedComments ? `，自动导入 ${importedComments} 条漫评` : ""}`, "success");
        await persistDatabase();
        void loadAiringCalendar(true);
      } catch (error) {
        syncStatus.state = "error";
        syncStatus.text = `同步失败：${error.message}`;
        syncStatus.short = "同步失败";
        updateMascot("同步失败了，但本地日志和已有收藏没有被删除。");
        appendDebug(`同步失败：${error.message}`, "error");
        showToast(`Bangumi 同步失败：${error.message}`, true, 5000);
      } finally {
        syncing.value = false;
      }
    }

    async function loadSubjectDetail(subject) {
      if (!subject?.bangumiId) return subject;
      const cached = database.value.subjectCache?.[subject.bangumiId];
      try {
        const raw = await bgmRequest(`/subjects/${subject.bangumiId}`);
        const merged = normalizeSubject({ ...raw, ...raw, id: raw.id || subject.bangumiId, type: raw.type || subject.type });
        const finalSubject = mergeSubjects(subject, merged);
        database.value.subjectCache[subject.bangumiId] = finalSubject;
        return finalSubject;
      } catch (error) {
        if (cached) return normalizeSubject(cached);
        throw error;
      }
    }

    async function openSubjectDetail(subject, episodeHint = null) {
      if (!subject) return;
      let target = normalizeSubject(subject);
      if (!target) return;
      selectedSubject.value = target;
      selectedDetailEpisode.value = episodeHint ? {
        id: episodeHint.id || null,
        sort: Number(episodeHint.sort || episodeHint.ep || episodeHint.episode || 0),
        ep: Number(episodeHint.ep || episodeHint.sort || episodeHint.episode || 0),
        name: episodeHint.name || "",
        name_cn: episodeHint.name_cn || episodeHint.episodeLabel || "",
        type: episodeHint.type || 0
      } : null;
      currentArticle.value = null;
      currentTab.value = "subject-detail";
      window.scrollTo({ top: 0, behavior: "smooth" });
      const episodePromise = target.bangumiId
        ? loadSubjectEpisodes(target, episodeHint)
        : Promise.resolve();
      if (target.bangumiId) {
        syncStatus.state = "active";
        syncStatus.text = `正在读取条目 ${target.bangumiId}…`;
        syncStatus.short = "读取条目";
        try {
          target = await loadSubjectDetail(target);
          selectedSubject.value = target;
          syncStatus.state = "ok";
          syncStatus.text = `已读取 ${target.name}`;
          syncStatus.short = "条目已就绪";
        } catch (error) {
          syncStatus.state = "error";
          syncStatus.text = `条目读取失败：${error.message}`;
          syncStatus.short = "条目读取失败";
          appendDebug(`条目读取失败：${error.message}`, "error");
          showToast("未拿到最新条目资料，继续显示本地缓存。", true);
        }
      }
      await episodePromise;
      return target;
    }

    async function refreshSubjectDetail(subject) {
      if (!subject?.bangumiId) return;
      try {
        const updated = await loadSubjectDetail(subject);
        selectedSubject.value = updated;
        await loadSubjectEpisodes(updated, selectedDetailEpisode.value);
        showToast("条目资料已更新并缓存。");
      } catch (error) {
        showToast(`更新失败：${error.message}`, true);
      }
    }

    function writeAboutSubject(subject) {
      const normalized = normalizeSubject(subject);
      if (!normalized) return;
      currentTab.value = "timeline";
      currentArticle.value = null;
      editor.kind = "note";
      editor.subject = JSON.parse(JSON.stringify(normalized));
      editor.rating = Number(normalized.myScore) || 0;
      if (normalized.bangumiId) loadEpisodesFor(normalized);
      nextTick(() => editorInput.value?.focus());
    }

    function clearEditorSubject() {
      editor.subject = null;
      editor.rating = 0;
      availableEpisodes.value = [];
    }

    async function fetchAllEpisodes(subjectId) {
      const allEpisodes = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const json = await bgmRequest(
          `/episodes?subject_id=${encodeURIComponent(subjectId)}&limit=${limit}&offset=${offset}`,
          { quiet: true }
        );
        const page = Array.isArray(json?.data) ? json.data : [];
        if (!page.length) break;
        allEpisodes.push(...page);
        const total = Number(json?.total);
        if (Number.isFinite(total) && allEpisodes.length >= total) break;
        if (page.length < limit) break;
        offset += limit;
      }
      return allEpisodes;
    }

    async function loadAiringCalendar(force = false) {
      if (airingCalendarLoading.value) return;
      const cache = database.value.calendarCache || (database.value.calendarCache = {
        syncedAt: null,
        days: [],
        episodes: {}
      });
      if (
        !force &&
        Array.isArray(cache.days) &&
        cache.days.length &&
        cache.syncedAt &&
        Date.now() - new Date(cache.syncedAt).getTime() < 6 * 60 * 60 * 1000
      ) {
        airingCalendarDays.value = cache.days;
        return;
      }

      airingCalendarLoading.value = true;
      airingCalendarError.value = "";
      try {
        const payload = await bgmRequest("https://api.bgm.tv/calendar", { quiet: true });
        const days = (Array.isArray(payload) ? payload : []).map((day) => ({
          weekday: day.weekday,
          items: (day.items || []).map((item) => ({
            id: item.id,
            type: item.type,
            name: item.name,
            name_cn: item.name_cn,
            summary: item.summary || "",
            air_date: item.air_date,
            air_weekday: item.air_weekday,
            images: item.images || {},
            rating: item.rating ? { score: item.rating.score, total: item.rating.total } : null,
            collection: item.collection || {}
          }))
        }));
        cache.days = days;
        cache.syncedAt = new Date().toISOString();
        airingCalendarDays.value = days;

        const calendarIds = new Set(
          days.flatMap((day) => (day.items || []).map((item) => Number(item.id)))
        );
        const targets = allSubjects.value
          .filter((subject) =>
            Number(subject.status) === 3 &&
            Number(subject.type) === 2 &&
            calendarIds.has(Number(subject.bangumiId))
          )
          .slice(0, 24);
        const queue = [...targets];
        const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (queue.length) {
            const subject = queue.shift();
            try {
              const episodes = await fetchAllEpisodes(subject.bangumiId);
              cache.episodes[subject.bangumiId] = episodes;
            } catch (error) {
              appendDebug(`放送章节同步失败 ${subject.name}：${error.message}`, "error");
            }
          }
        });
        await Promise.all(workers);
        await persistDatabase();
        appendDebug(`放送日历已更新 · 今日 ${todayAiringAll.value.length} 部`, "success");
      } catch (error) {
        airingCalendarError.value = error.message;
        airingCalendarDays.value = Array.isArray(cache.days) ? cache.days : [];
        appendDebug(`放送日历读取失败：${error.message}`, "error");
      } finally {
        airingCalendarLoading.value = false;
      }
    }

    async function loadSubjectEpisodes(subject, episodeHint = null) {
      if (!subject?.bangumiId) {
        subjectEpisodes.value = [];
        selectedDetailEpisode.value = episodeHint || null;
        return;
      }
      const cached = database.value.episodeCache?.[subject.bangumiId];
      if (Array.isArray(cached) && cached.length) {
        subjectEpisodes.value = cached;
        if (episodeHint) {
          selectedDetailEpisode.value = cached.find((episode) =>
            (episodeHint.id && String(episode.id) === String(episodeHint.id)) ||
            Number(episode.sort || episode.ep || 0) === Number(episodeHint.sort || episodeHint.ep || 0)
          ) || episodeHint;
        }
      } else {
        subjectEpisodes.value = [];
      }
      subjectEpisodeLoading.value = true;
      try {
        const episodes = await fetchAllEpisodes(subject.bangumiId);
        if (episodes.length) {
          subjectEpisodes.value = episodes;
          database.value.episodeCache[subject.bangumiId] = episodes;
          if (episodeHint) {
            selectedDetailEpisode.value = episodes.find((episode) =>
              (episodeHint.id && String(episode.id) === String(episodeHint.id)) ||
              Number(episode.sort || episode.ep || 0) === Number(episodeHint.sort || episodeHint.ep || 0)
            ) || episodeHint;
          }
        }
        appendDebug(`条目 ${subject.bangumiId} 加载 ${episodes.length} 个章节`);
      } catch (error) {
        appendDebug(`章节读取失败：${error.message}`, "error");
        if (!subjectEpisodes.value.length) showToast("章节列表暂时无法读取。", true);
      } finally {
        subjectEpisodeLoading.value = false;
      }
    }

    async function loadEpisodesFor(subject) {
      if (!subject?.bangumiId) {
        availableEpisodes.value = [];
        return;
      }
      try {
        availableEpisodes.value = await fetchAllEpisodes(subject.bangumiId);
        database.value.episodeCache[subject.bangumiId] = availableEpisodes.value;
        appendDebug(`条目 ${subject.bangumiId} 获取 ${availableEpisodes.value.length} 个章节`);
      } catch (error) {
        availableEpisodes.value = database.value.episodeCache?.[subject.bangumiId] || [];
        appendDebug(`章节读取失败：${error.message}`, "error");
      }
    }

    function selectEpisode(episode) {
      if (!editor.subject) return;
      const number = Number(episode.sort || episode.ep || 0);
      editor.subject.episode = number;
      editor.subject.episodeId = episode.id || null;
      editor.subject.episodeLabel = `${episodePrefix(episode, editor.subject)}${episode.name_cn || episode.name ? ` ${episode.name_cn || episode.name}` : ""}`;
    }

    async function selectSubjectEpisode(episode) {
      selectedDetailEpisode.value = episode;
      await nextTick();
      episodeRecordsRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function openEpisodeFromPost(post) {
      if (!post?.subject?.bangumiId) return;
      const episodeHint = {
        id: post.subject.episodeId || null,
        sort: Number(post.subject.episode) || 0,
        ep: Number(post.subject.episode) || 0,
        type: 0,
        name_cn: post.subject.episodeLabel || ""
      };
      await openSubjectDetail(post.subject, episodeHint);
      await nextTick();
      episodeRecordsRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function startWatchSession() {
      if (activeWatchSession.value) {
        showToast("已经有一场观看正在进行，先结束或取消它。", true);
        return;
      }
      const subject = selectedSubject.value;
      const episode = defaultWatchEpisode.value;
      if (!subject?.bangumiId) {
        showToast("请先从番组档案进入作品详情。", true);
        return;
      }
      if (!episode) {
        showToast("这个条目没有可用章节，暂时不能开始观看场次。", true);
        return;
      }
      const session = createWatchSession({
        id: createId("watch"),
        subject,
        episode,
        now: new Date()
      });
      if (!session) {
        showToast("观看场次创建失败。", true);
        return;
      }
      database.value.watchSessions.unshift(session);
      watchSessionNow.value = Date.now();
      await persistDatabase();
      showToast(`开始记录 ${watchEpisodeLabel(episode)}。`);
    }

    async function setWatchSessionRewatch(isRewatch) {
      const session = activeWatchSessionForSubject.value;
      if (!session) return;
      session.isRewatch = Boolean(isRewatch);
      await persistDatabase();
    }

    async function finishActiveWatchSession() {
      const session = activeWatchSessionForSubject.value;
      if (!session) return;
      const finished = finishWatchSession(session, {
        episode: selectedDetailEpisode.value || session.endEpisode || session.startEpisode,
        now: new Date(),
        isRewatch: session.isRewatch
      });
      const index = database.value.watchSessions.findIndex((item) => item.id === session.id);
      if (!finished || index < 0) {
        showToast("结束观看场次失败。", true);
        return;
      }
      database.value.watchSessions.splice(index, 1, finished);
      watchSessionNow.value = Date.now();
      await persistDatabase();
      showToast(
        `已记录 ${watchSessionEpisodeRange(finished)} · ${formatWatchDuration(finished.durationMs)}`
      );
    }

    function cancelActiveWatchSession() {
      const session = activeWatchSessionForSubject.value;
      if (!session) return;
      askConfirm("取消这场观看后，本次开始/结束时间和集数都不会保留。继续吗？", async () => {
        markSyncDeleted("watchSessions", session.id);
        database.value.watchSessions = database.value.watchSessions
          .filter((item) => item.id !== session.id);
        await persistDatabase();
        showToast("已取消当前观看场次。");
      }, "取消场次");
    }

    function writeEpisodePost(episode) {
      if (!selectedSubject.value) return;
      writeAboutSubject(selectedSubject.value);
      selectEpisode(episode);
      showToast(`已关联 ${episodePrefix(episode)}，写一条即时吐槽。`);
      nextTick(() => editorInput.value?.focus());
    }

    function openSettings() {
      settingsForm.username = database.value.settings.username || "";
      settingsForm.token = token.value;
      settingsForm.aiBaseUrl = database.value.settings.aiBaseUrl || "";
      settingsForm.aiModel = database.value.settings.aiModel || "";
      settingsForm.aiSystemPrompt = database.value.settings.aiSystemPrompt || "";
      settingsForm.aiWebUrl = database.value.settings.aiWebUrl || "";
      showSettings.value = true;
      void refreshFolderSyncInfo();
      nextTick(() => document.getElementById("settings-username")?.focus());
    }

    function closeSettings() {
      showSettings.value = false;
    }

    async function saveAndSync() {
      database.value.settings.username = cleanUsername(settingsForm.username);
      settingsForm.username = database.value.settings.username;
      token.value = settingsForm.token.trim();
      if (token.value) localStorage.setItem(STORAGE_TOKEN_KEY, token.value);
      else localStorage.removeItem(STORAGE_TOKEN_KEY);
      await persistDatabase();
      showSettings.value = false;
      await syncBangumiData();
    }

    function mapSearchSubject(item) {
      return normalizeSubject({
        ...item,
        id: item.id,
        bangumiId: item.id,
        name: item.name,
        name_cn: item.name_cn,
        type: item.type,
        score: item.score ?? item.rating?.score,
        date: item.date,
        images: item.images || {},
        status: 0
      });
    }

    async function searchSubjects() {
      if (subjectSearchMode.value === "local") {
        const query = subjectQuery.value.toLowerCase();
        subjectSearchResults.value = database.value.collections
          .filter((subject) => {
            if (!query) return true;
            return `${subject.name} ${subject.originalName}`.toLowerCase().includes(query);
          })
          .slice(0, 30);
        return;
      }
      if (!subjectQuery.value.trim()) {
        subjectSearchResults.value = [];
        if (subjectSearchMode.value === "local") return;
        showToast("请输入搜索关键词。", true);
        return;
      }
      subjectSearchLoading.value = true;
      try {
        if (subjectSearchMode.value === "character") {
          const response = await bgmRequest("/search/characters", {
            method: "POST",
            body: { keyword: subjectQuery.value, filter: { nsfw: false } }
          });
          subjectSearchResults.value = (response?.data || response || []).slice(0, 20).map((character) => ({
            ...normalizeSubject(character, { kind: "character" }),
            kind: "character",
            name: character.name_cn || character.name || `角色 ${character.id}`,
            originalName: character.name || "",
            image: character.images?.medium || character.images?.grid || character.images?.small || ""
          }));
        } else {
          const selectedType = Number(subjectSearchType.value);
          const response = await bgmRequest("/search/subjects", {
            method: "POST",
            body: { keyword: subjectQuery.value, filter: { type: [selectedType] } }
          });
          subjectSearchResults.value = (response?.data || response || [])
            .slice(0, 20)
            .map(mapSearchSubject)
            .filter(Boolean);
        }
      } catch (error) {
        subjectSearchResults.value = [];
        appendDebug(`Bangumi 搜索失败：${error.message}`, "error");
        showToast(`搜索失败：${error.message}`, true);
      } finally {
        subjectSearchLoading.value = false;
      }
    }

    function switchToLocalSearch() {
      subjectSearchMode.value = "local";
      searchSubjects();
    }

    function openSubjectSearch() {
      showSubjectSearch.value = true;
      subjectQuery.value = "";
      subjectSearchResults.value = [];
      if (database.value.collections.length) {
        subjectSearchMode.value = "local";
        subjectSearchResults.value = database.value.collections.slice(0, 30);
      } else {
        subjectSearchMode.value = "bangumi";
      }
      nextTick(() => document.querySelector(".search-layout input")?.focus());
    }

    function closeSubjectSearch() {
      showSubjectSearch.value = false;
    }

    async function selectSearchResult(result) {
      if (result.kind === "character") {
        insertText(`[bgm:char:${result.id}]`);
        showToast("角色内嵌卡片已插入正文。");
        showSubjectSearch.value = false;
        return;
      }
      const normalized = normalizeSubject(result);
      if (!normalized) return;
      const collection = database.value.collections.find((subject) => Number(subject.bangumiId) === Number(normalized.bangumiId));
      editor.subject = collection ? JSON.parse(JSON.stringify(mergeSubjects(normalized, collection))) : JSON.parse(JSON.stringify(normalized));
      editor.rating = Number(editor.subject.myScore) || 0;
      if (editor.subject.bangumiId) await loadEpisodesFor(editor.subject);
      showToast(`已关联《${editor.subject.name}》。`);
    }

    function selectManualEvent() {
      const name = subjectQuery.value.trim() || "生活记录";
      editor.subject = normalizeSubject({
        key: `event:${Date.now()}`,
        type: 0,
        name,
        status: 2,
        updatedAt: new Date().toISOString()
      });
      editor.rating = 0;
      showToast(`已将“${name}”作为生活事件关联。`);
    }

    async function handleContentClick(event) {
      const card = event.target.closest("[data-bgm-type]");
      if (card) {
        event.preventDefault();
        event.stopPropagation();
        const type = card.dataset.bgmType;
        const id = card.dataset.bgmId;
        if (type === "char") {
          await openCharacterDetail(id);
        } else {
          const cached = database.value.subjectCache?.[id] || database.value.collections.find((subject) => Number(subject.bangumiId) === Number(id));
          await openSubjectDetail(cached || normalizeSubject({
            id: Number(id),
            bangumiId: Number(id),
            type: 2,
            name: `Bangumi 条目 #${id}`
          }));
        }
        return;
      }
      const anchor = event.target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      event.preventDefault();
      if (href.startsWith("#")) {
        document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        showToast("外部网页跳转已停用。请在应用内打开 Bangumi 条目。", true);
      }
    }

    async function openCharacterDetail(id) {
      let cached = database.value.characterCache?.[id];
      if (!cached) {
        try {
          const raw = await bgmRequest(`/characters/${id}`);
          cached = {
            ...raw,
            image: raw.images?.medium || raw.images?.large || raw.images?.grid || ""
          };
          database.value.characterCache[id] = cached;
        } catch (error) {
          showToast(`角色资料读取失败：${error.message}`, true);
          return;
        }
      }
      characterDetail.value = {
        id,
        name: cached.name_cn || cached.name || `角色 #${id}`,
        nameCn: cached.name || "",
        summary: cached.summary || "",
        image: cached.image || cached.images?.medium || cached.images?.grid || ""
      };
    }

    async function ensureShortcodes() {
      const content = [
        ...filteredTimelinePosts.value.map((post) => post.content),
        currentArticle.value?.content || "",
        selectedSubject.value ? subjectPosts.value.map((post) => post.content).join("\n") : ""
      ].join("\n");
      const seen = new Set();
      const pendingSubjects = [];
      const pendingCharacters = [];
      for (const match of content.matchAll(/\[bgm:(?:(subject|char):)?(\d+)\]/g)) {
        const type = match[1] === "char" ? "char" : "subject";
        const id = match[2];
        const key = `${type}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (type === "char" && !database.value.characterCache?.[id]) pendingCharacters.push(id);
        if (type === "subject" && !database.value.subjectCache?.[id]) pendingSubjects.push(id);
      }

      for (const id of pendingSubjects.slice(0, 8)) {
        try {
          const raw = await bgmRequest(`/subjects/${id}`, { quiet: true });
          database.value.subjectCache[id] = normalizeSubject(raw);
          appendDebug(`正文短代码缓存条目 #${id}`, "success");
        } catch (error) {
          appendDebug(`短代码条目 #${id} 读取失败：${error.message}`, "error");
        }
      }
      for (const id of pendingCharacters.slice(0, 8)) {
        try {
          const raw = await bgmRequest(`/characters/${id}`, { quiet: true });
          database.value.characterCache[id] = raw;
          appendDebug(`正文短代码缓存角色 #${id}`, "success");
        } catch (error) {
          appendDebug(`短代码角色 #${id} 读取失败：${error.message}`, "error");
        }
      }
    }

    const shortcodeWatchSource = computed(() =>
      filteredTimelinePosts.value.map((post) => post.content).join("\n") + (currentArticle.value?.content || "")
    );
    watch(shortcodeWatchSource, ensureShortcodes, { immediate: false });

    async function exportBackup() {
      const result = await window.bgmApi.exportBackup(snapshotDatabase());
      if (result.ok) {
        appendDebug(`已导出 JSON 备份：${result.path}`, "success");
        showToast(`备份已导出：${result.path}`);
      } else if (!result.canceled) {
        showToast(`导出失败：${result.error}`, true);
      }
    }

    function triggerBackupImport() {
      if (platformCapabilities.backupImport) window.bgmApi.importBackup().then(handleBackupResult);
      else backupInput.value?.click();
    }

    async function handleBackupResult(result) {
      if (!result || result.canceled) return;
      if (!result.ok) {
        showToast(`导入失败：${result.error}`, true);
        return;
      }
      askConfirm(`将用“${result.path}”中的备份替换当前本地数据库，继续吗？`, async () => {
        database.value = normalizeDatabase(result.data);
        settingsForm.username = database.value.settings.username || "";
        settingsForm.aiBaseUrl = database.value.settings.aiBaseUrl || "";
        settingsForm.aiModel = database.value.settings.aiModel || "";
        settingsForm.aiSystemPrompt = database.value.settings.aiSystemPrompt || "";
        settingsForm.aiWebUrl = database.value.settings.aiWebUrl || "";
        theme.value = database.value.settings.theme === "dark" ? "dark" : "light";
        applyTheme();
        await persistDatabase();
        showSettings.value = false;
        showToast("备份恢复完成。");
        updateMascot("备份已经恢复，文章和收藏都回来了。");
        appendDebug(`导入备份成功：${result.path}`, "success");
      }, "导入并替换");
    }

    async function handleBackupFile(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        await handleBackupResult({ ok: true, data: JSON.parse(await file.text()), path: file.name });
      } catch (error) {
        showToast(`备份解析失败：${error.message}`, true);
      }
    }

    async function exportAllMarkdown() {
      const result = await window.bgmApi.exportAllMarkdown(database.value.posts);
      if (result.ok) {
        appendDebug(`导出 ${result.count} 篇 Markdown 到 ${result.path}`, "success");
        showToast(`已导出 ${result.count} 篇长文。`);
      } else if (!result.canceled) {
        showToast(`导出失败：${result.error}`, true);
      }
    }

    async function exportSingleMarkdown(post) {
      const result = await window.bgmApi.exportOneMarkdown(post);
      if (result.ok) showToast("Markdown 已导出。");
      else if (!result.canceled) showToast(`导出失败：${result.error}`, true);
    }

    async function revealDatabase() {
      if (!platformCapabilities.revealDatabase) {
        showToast(
          databasePath.value
            ? `当前平台无法打开文件管理器。数据库位置：${databasePath.value}`
            : "当前平台无法打开文件管理器。",
          true
        );
        return;
      }
      const result = await window.bgmApi.revealDatabase();
      if (result.ok) {
        databasePath.value = result.path;
        showToast("已在文件管理器中定位数据库。");
      }
    }

    async function importCollectionComments({ silent = false, persist = true } = {}) {
      const existing = new Set(database.value.posts.map((post) => post.sourceKey).filter(Boolean));
      let imported = 0;
      for (const subject of database.value.collections) {
        const sourceKey = `bangumi-collection:${subject.bangumiId}`;
        if (!subject.bangumiId || existing.has(sourceKey)) continue;
        if (!subject.comment && !subject.myScore) continue;
        const content = subject.comment ||
          `给《${subject.name}》打了 ${subject.myScore}/10 分。`;
        const post = normalizePost({
          id: createId("import"),
          kind: "note",
          content,
          tags: ["Bangumi导入"],
          subject: { ...subject, status: subject.status },
          rating: subject.myScore,
          createdAt: subject.updatedAt || new Date().toISOString(),
          updatedAt: subject.updatedAt || new Date().toISOString(),
          sourceKey
        });
        database.value.posts.push(post);
        existing.add(sourceKey);
        imported += 1;
      }
      if (!imported) {
        if (!silent) showToast("没有新的收藏短评需要导入。");
        return 0;
      }
      if (persist) await persistDatabase();
      if (!silent) showToast(`已从 Bangumi 收藏导入 ${imported} 条碎碎念。`);
      if (!silent) updateMascot(`从收藏里找回了 ${imported} 条旧短评。`);
      appendDebug(`导入 ${imported} 条 Bangumi 收藏吐槽`, "success");
      return imported;
    }

    function closeAnyModal() {
      if (confirmState.value) {
        closeConfirm();
        return true;
      }
      if (lightboxImage.value) {
        closeLightbox();
        return true;
      }
      if (characterDetail.value) {
        characterDetail.value = null;
        return true;
      }
      if (showImageUrlModal.value) {
        closeImageUrlModal();
        return true;
      }
      if (showEmojiPicker.value) {
        closeEmojiPicker();
        return true;
      }
      if (showSubjectSearch.value) {
        closeSubjectSearch();
        return true;
      }
      if (showQueuePicker.value) {
        closeQueuePicker();
        return true;
      }
      if (showAiWeb.value) {
        closeAiWeb();
        return true;
      }
      if (showSettings.value) {
        closeSettings();
        return true;
      }
      return false;
    }

    function handleEscape(event) {
      if (event.key === "Escape" && closeAnyModal()) event.preventDefault();
    }

    async function loadInitialData() {
      try {
        const result = await window.bgmApi.loadDatabase();
        const pathResult = await window.bgmApi.getDatabasePath();
        databasePath.value = result.path ||
          (typeof pathResult === "string" ? pathResult : "当前平台不提供数据库路径");
        if (result.ok && result.data) {
          database.value = normalizeDatabase(result.data);
          airingCalendarDays.value = database.value.calendarCache?.days || [];
          appendDebug(`已读取本地数据库：${result.path || databasePath.value}`, "success");
        } else if (result.error) {
          appendDebug(`数据库读取失败：${result.error}`, "error");
        } else {
          appendDebug(`首次启动，等待写入：${databasePath.value}`);
        }
        if (!database.value.settings.theme) database.value.settings.theme = theme.value;
        theme.value = database.value.settings.theme === "dark" ? "dark" : "light";
        applyTheme();
        settingsForm.username = database.value.settings.username || "";
        settingsForm.token = token.value;
        settingsForm.aiBaseUrl = database.value.settings.aiBaseUrl || "";
        settingsForm.aiModel = database.value.settings.aiModel || "";
        settingsForm.aiSystemPrompt = database.value.settings.aiSystemPrompt || "";
        settingsForm.aiWebUrl = database.value.settings.aiWebUrl || "";
        for (const emoji of database.value.settings.customEmojis) {
          if (emoji.name && emoji.url) CUSTOM_EMOJI_MAP.set(emoji.name, emoji.url);
        }
      } catch (error) {
        appendDebug(`初始化本地数据失败：${error.message}`, "error");
      }
      try {
        await syncBangumiData({ silentIfUnconfigured: true });
      } catch (error) {
        appendDebug(`初始化同步未阻塞界面：${error.message}`, "error");
      }
      databaseLoaded = true;
      void checkScheduledPeriodReports();
      void loadAiringCalendar();
      if (folderSyncCapable) {
        await refreshFolderSyncInfo();
        if (folderSyncState.configured) void syncFolderNow({ quiet: true });
      }
    }

    onMounted(() => {
      window.addEventListener("keydown", handleEscape);
      appendDebug("界面已就绪，开始异步读取本地数据");
      updateMascot(mascotLine.value);
      startDateRefreshWatch();
      loadInitialData();
      if (folderSyncCapable) {
        folderSyncTimer = setInterval(() => {
          if (!document.hidden) void syncFolderNow({ quiet: true });
        }, 45000);
      }
      setTimeout(ensureShortcodes, 600);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("keydown", handleEscape);
      stopDateRefreshWatch();
      if (watchSessionTickTimer) clearInterval(watchSessionTickTimer);
      if (scheduledSave) clearTimeout(scheduledSave);
      if (scheduledFolderSnapshot) clearTimeout(scheduledFolderSnapshot);
      if (folderSyncTimer) clearInterval(folderSyncTimer);
      persistDatabase();
    });

    return {
      currentTab,
      database,
      databasePath,
      settingsForm,
      editorInput,
      titleInput,
      imageInput,
      backupInput,
      backgroundInput,
      aiInputRef,
      aiApiKey,
      aiTesting,
      aiTestStatus,
      editor,
      editorError,
      moodLabel,
      searchTerm,
      postScopeFilter,
      postScopeFilters,
      postScopeCounts,
      timelineFilter,
      selectedDateKey,
      activeTag,
      activeMonth,
      activeEmotion,
      visiblePostLimit,
      selectedSubject,
      currentArticle,
      currentToc,
      tocEntries,
      availableEpisodes,
      subjectEpisodes,
      subjectEpisodeLoading,
      selectedDetailEpisode,
      episodeRecordsRef,
      activeWatchSession,
      activeWatchSessionForSubject,
      currentSubjectWatchSessions,
      watchSessionElapsedMs,
      defaultWatchEpisode,
      subjectTypeFilter,
      subjectStatusFilter,
      showSettings,
      showSubjectSearch,
      showQueuePicker,
      queuePickerType,
      queuePickerQuery,
      showEmojiPicker,
      showAiWeb,
      showImageUrlModal,
      isDragging,
      openDebug,
      lightboxImage,
      characterDetail,
      confirmState,
      imageUrlInput,
      subjectQuery,
      subjectSearchMode,
      subjectSearchType,
      subjectSearchResults,
      subjectSearchLoading,
      emojiTab,
      lastInsertedEmoji,
      customEmojiForm,
      aiBusy,
      aiError,
      aiInput,
      aiThread,
      aiDisplayMessages,
      aiConfigured,
      aiWebSrc,
      platformCapabilities,
      embeddedAiWeb,
      folderSyncSupported: folderSyncCapable,
      folderSyncState,
      harunaGreeting,
      syncing,
      syncStatus,
      debugLogs,
      toast,
      mascotLine,
      weekdays,
      timelineFilters,
      subjectTypes,
      collectionStatuses,
      kaomojiList,
      standardEmoji,
      tvEmojiNumbers,
      accentPresets: ACCENT_PRESETS,
      theme,
      filteredTimelinePosts,
      displayedTimelinePosts,
      timelineDayGroups,
      timelinePeriod,
      hiddenTimelinePostCount,
      showMoreTimelinePosts,
      hasActiveTimelineFilter,
      activeFilterSummary,
      profileInitial,
      timelineFinding,
      subjectFinding,
      allSubjects,
      filteredSubjects,
      subjectCategoryCounts,
      subjectCategories,
      currentSubjectCategoryLabel,
      watchingSubjects,
      queueTypes: QUEUE_TYPES,
      queueLanes,
      queueActiveCount,
      queuePickerResults,
      queueRecommendationType,
      queueRecommendationLoading,
      queueRecommendationError,
      queueRecommendationNarrative,
      queueRecommendationBasis,
      visibleQueueRecommendations,
      visibleQueueRecommendationGroups,
      refreshQueueRecommendations,
      selectQueueRecommendationType,
      airingCalendarDays,
      airingCalendarLoading,
      airingCalendarError,
      airingCalendarMode,
      showAllAiring,
      todayAiringAll,
      visibleTodayAiringAll,
      personalAiringSchedule,
      todayPersonalAiring,
      thisWeekAiring,
      nextAiringEpisodes,
      airingEpisodeLabel,
      loadAiringCalendar,
      subjectPosts,
      displayedSubjectPosts,
      stats,
      statsFinding,
      yearbook,
      yearbookYear,
      yearbookYears,
      yearbookCompareEnabled,
      yearbookComparisonYear,
      yearbookComparison,
      yearbookComparisonMetrics,
      yearbookRatingComparison,
      yearbookRatingMetrics,
      collectionStatusGroups,
      yearbookCommentary,
      yearbookCritiqueBusy,
      yearbookExportBusy,
      yearbookExporting,
      yearbookExportRef,
      yearbookDayHover,
      yearbookGeneratedAt,
      yearbookFinding,
      yearbookActivityCalendar,
      showYearbookDay,
      hideYearbookDay,
      periodReviewType,
      periodReviewKey,
      periodReviewBusy,
      periodReviewCritiqueBusy,
      quarterCharacterFilter,
      quarterCharacterLoading,
      quarterCharacterError,
      quarterCharacterPickerOpen,
      quarterActiveWorkKey,
      quarterCharacterWorks,
      activeQuarterCharacterWork,
      quarterCharactersForRole,
      quarterCharacterRoleCounts,
      quarterSelectedCharacters,
      isQuarterCharacterSelected,
      toggleQuarterCharacter,
      openQuarterCharacterPicker,
      closeQuarterCharacterPicker,
      periodReviewReport,
      periodReviewOptions,
      periodTypeLabel,
      periodReviewLabel,
      setPeriodReviewType,
      generateSelectedPeriodReport,
      generatePeriodCritique,
      openPeriodHighlight,
      latestWeeklyCutoff,
      latestMonthlyCutoff,
      latestQuarterCutoff,
      importableCollectionCount,
      tagCounts,
      topTags,
      monthlyArchives,
      postsByDate,
      calendarTitle,
      calendarDays,
      yearAgoPost,
      yearAgoDateLabel,
      todayKey,
      appClock,
      refreshCurrentDate,
      toggleTheme,
      moveCalendarMonth,
      selectCalendarDate,
      setTimelineFilter,
      setPostScope,
      clearTimelineFilters,
      filterByTag,
      clearTagFilter,
      setSubjectCategory,
      resetSubjectFilters,
      openQueuePicker,
      closeQueuePicker,
      addToNextQueue,
      removeQueueItem,
      moveQueueItem,
      setQueueItemNext,
      completeQueueItem,
      openQueueSubject,
      filterByMonth,
      filterByEmotion,
      runGlobalSearch,
      setTab,
      goSubjectDetailTab,
      generateYearbook,
      generateYearbookCritique,
      openYearbookAward,
      exportYearbook,
      openArticle,
      closeArticle,
      scrollToHeading,
      setEditorKind,
      focusComposer,
      handleEditorContentInput,
      editPost,
      publishPost,
      deletePost,
      triggerImagePicker,
      handleFileInput,
      handlePaste,
      handleDrop,
      removeEditorImage,
      insertMask,
      insertQuote,
      openImageUrlModal,
      closeImageUrlModal,
      insertImageUrl,
      openEmojiPicker,
      closeEmojiPicker,
      insertEmojiCode,
      emojiPreviewUrl,
      tvEmojiUrl,
      addCustomEmoji,
      removeCustomEmoji,
      openLightbox,
      closeLightbox,
      openSubjectDetail,
      refreshSubjectDetail,
      writeAboutSubject,
      clearEditorSubject,
      loadEpisodesFor,
      selectEpisode,
      selectSubjectEpisode,
      openEpisodeFromPost,
      startWatchSession,
      setWatchSessionRewatch,
      finishActiveWatchSession,
      cancelActiveWatchSession,
      writeEpisodePost,
      formatWatchDuration,
      watchEpisodeLabel,
      watchSessionEpisodeRange,
      watchSessionCountForEpisode,
      episodeKindLabel,
      episodePrefix,
      episodeDisplayTitle,
      episodePosts,
      isHarunaEvaluating,
      openSettings,
      closeSettings,
      saveAndSync,
      saveAiSettings,
      testAiConnection,
      openAiWeb,
      closeAiWeb,
      sendAiMessage,
      clearAiConversation,
      focusAiInput,
      greetHaruna,
      triggerBackgroundPicker,
      handleBackgroundFile,
      removeBackground,
      setAccentColor,
      applyAppearance,
      syncBangumiData,
      chooseFolderSyncFolder,
      openFolderSyncFolder,
      syncFolderNow,
      openSubjectSearch,
      closeSubjectSearch,
      switchToLocalSearch,
      searchSubjects,
      selectSearchResult,
      selectManualEvent,
      handleContentClick,
      exportBackup,
      triggerBackupImport,
      handleBackupFile,
      handleBackupResult,
      exportAllMarkdown,
      exportSingleMarkdown,
      revealDatabase,
      importCollectionComments,
      closeConfirm,
      runConfirm,
      renderMarkdown,
      visiblePostTags,
      subjectTypeLabel,
      collectionStatusLabel,
      progressPercent,
      progressLabel,
      wordCount: countWords,
      readingTime: readingMinutes,
      formatDate,
      formatDateTime,
      formatNumber,
      padNumber,
      excerpt,
      cycleMascotLine
    };
  }
});

app.mount("#app");
