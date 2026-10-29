(function initRecommendationEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RecommendationEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRecommendationEngine() {
  const DEFAULT_BLOCKLIST = new Set([
    "TV", "WEB", "OVA", "剧场版", "日本", "日本动画", "动画", "漫画改", "原创",
    "游戏", "书籍", "音乐", "短片", "动态漫画", "国产", "欧美", "里番"
  ]);

  function normalizeTag(value) {
    return String(value || "").trim();
  }

  function usefulTag(value, blocklist = DEFAULT_BLOCKLIST) {
    const tag = normalizeTag(value);
    if (!tag || tag.length > 12 || blocklist.has(tag)) return false;
    if (/^(19|20)\d{2}(年|年代|年.+)?$/.test(tag)) return false;
    if (/^\d+$/.test(tag)) return false;
    return true;
  }

  function uniqueTags(subject, blocklist) {
    return [...new Set((Array.isArray(subject?.tags) ? subject.tags : [])
      .map(normalizeTag)
      .filter((tag) => usefulTag(tag, blocklist)))];
  }

  function subjectWeight(subject) {
    const rating = Number(subject?.myScore) || 0;
    const status = Number(subject?.status) || 0;
    let positive = 0;
    let negative = 0;

    if (rating >= 7) positive += rating - 5;
    if (status === 3) positive += 2;
    if (status === 1 || status === 4) positive += 0.5;

    if (status === 5) negative += 4;
    if (rating > 0 && rating <= 5) negative += Math.max(1, 6 - rating);

    return { positive, negative };
  }

  function buildTasteProfile(subjects, options = {}) {
    const blocklist = options.blocklist instanceof Set
      ? options.blocklist
      : new Set([...DEFAULT_BLOCKLIST, ...(Array.isArray(options.blocklist) ? options.blocklist : [])]);
    const tagScores = new Map();
    const anchors = [];

    for (const subject of Array.isArray(subjects) ? subjects : []) {
      if (!subject) continue;
      const tags = uniqueTags(subject, blocklist);
      if (!tags.length) continue;
      const weight = subjectWeight(subject);
      if (!weight.positive && !weight.negative) continue;

      for (const tag of tags) {
        tagScores.set(tag, (tagScores.get(tag) || 0) + weight.positive - weight.negative * 0.8);
      }
      const status = Number(subject.status) || 0;
      if (weight.positive > weight.negative && ![1, 4].includes(status)) {
        anchors.push({
          subject,
          name: String(subject.name || "未命名作品"),
          tags,
          score: weight.positive - weight.negative,
          updatedAt: subject.updatedAt || ""
        });
      }
    }

    const favoriteTags = [...tagScores.entries()]
      .filter(([, score]) => score > 0)
      .map(([name, score]) => ({ name, score: Math.round(score * 100) / 100 }))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"))
      .slice(0, 12);
    const avoidTags = [...tagScores.entries()]
      .filter(([, score]) => score < 0)
      .map(([name, score]) => ({ name, score: Math.round(Math.abs(score) * 100) / 100 }))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"))
      .slice(0, 8);
    anchors.sort((left, right) =>
      right.score - left.score || String(right.updatedAt).localeCompare(String(left.updatedAt))
    );

    return {
      favoriteTags,
      avoidTags,
      anchors,
      positiveCount: anchors.length,
      negativeCount: [...tagScores.values()].filter((score) => score < 0).length
    };
  }

  function candidateTags(candidate) {
    const direct = Array.isArray(candidate?.tags) ? candidate.tags : [];
    const subjectTags = Array.isArray(candidate?.subject?.tags) ? candidate.subject.tags : [];
    const matched = Array.isArray(candidate?.matchedTags) ? candidate.matchedTags : [];
    return [...new Set([...direct, ...subjectTags, ...matched].map(normalizeTag).filter(Boolean))];
  }

  function primaryTagFor(tags, favoriteMap, avoidMap) {
    return tags
      .map((tag) => ({
        tag,
        score: (favoriteMap.get(tag)?.score || 0) - (avoidMap.get(tag)?.score || 0)
      }))
      .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag, "zh-CN"))[0]?.tag || "";
  }

  function seriesIdentity(name) {
    return String(name || "")
      .replace(/\s*(第[0-9一二三四五六七八九十百]+(?:季|期|部|部分)|Season\s*\d+)\s*$/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("zh-CN");
  }

  function bestAnchor(profile, tags) {
    const tagSet = new Set(tags);
    return profile.anchors
      .map((anchor) => ({
        ...anchor,
        sharedTags: anchor.tags.filter((tag) => tagSet.has(tag))
      }))
      .filter((anchor) => anchor.sharedTags.length)
      .sort((left, right) =>
        right.sharedTags.length - left.sharedTags.length ||
        right.score - left.score ||
        String(right.updatedAt).localeCompare(String(left.updatedAt))
      )[0] || null;
  }

  function buildCandidateReason(candidate, profile, primaryTag) {
    const tags = candidateTags(candidate);
    const anchor = bestAnchor(profile, tags);
    const shared = anchor
      ? anchor.sharedTags.slice(0, 2)
      : tags.filter((tag) => profile.favoriteTags.some((entry) => entry.name === tag)).slice(0, 2);
    const tagText = shared.length ? shared.map((tag) => `「${tag}」`).join("、") : `「${primaryTag || tags[0] || "相近口味"}」`;
    const rating = Number(candidate?.ratingScore || candidate?.score || candidate?.subject?.score) || 0;
    const ratingText = rating ? `Bangumi ${rating.toFixed(1)} 分` : "评分资料尚少";

    if (anchor) {
      if (candidate.source === "inventory") {
        const statusText = Number(candidate.subject?.status) === 4 ? "搁置" : "想看";
        return `你把它留在${statusText}里；它和《${anchor.name}》共享${tagText}，库存里该先拆这一封。${ratingText}。`;
      }
      return `你喜欢《${anchor.name}》里的${tagText}；这部保留同一方向，${ratingText}，适合接着往下试。`;
    }
    if (candidate.source === "inventory") {
      return `它已经在你的库存里，并命中偏好${tagText}；${ratingText}，先从手边这部补位。`;
    }
    return `它命中了你的偏好${tagText}；${ratingText}，不是只凭热度乱塞进来的。`;
  }

  function scoreCandidate(candidate, profile) {
    const favoriteMap = new Map(profile.favoriteTags.map((entry) => [entry.name, entry]));
    const avoidMap = new Map(profile.avoidTags.map((entry) => [entry.name, entry]));
    const tags = candidateTags(candidate);
    const matches = tags
      .filter((tag) => favoriteMap.has(tag))
      .sort((left, right) => favoriteMap.get(right).score - favoriteMap.get(left).score);
    const avoidance = tags.reduce((sum, tag) => sum + (avoidMap.get(tag)?.score || 0), 0);
    const affinity = matches.reduce((sum, tag) => sum + favoriteMap.get(tag).score, 0);
    const rating = Number(candidate?.ratingScore || candidate?.score || candidate?.subject?.score) || 0;
    const ratingCount = Number(candidate?.ratingCount) || 0;
    const doingCount = Number(candidate?.doingCount) || 0;
    const primaryTag = primaryTagFor(tags, favoriteMap, avoidMap);
    return {
      ...candidate,
      tags,
      matchedTags: matches,
      primaryTag,
      seriesKey: seriesIdentity(candidate?.subject?.name),
      score: affinity * 10 - avoidance * 8 + rating * 2 +
        Math.log10(ratingCount + 1) + Math.log10(doingCount + 1) * 0.5,
      reason: buildCandidateReason(candidate, profile, primaryTag)
    };
  }

  function selectDiverse(candidates, limit, usedPrimaryTags, usedSeries) {
    const selected = [];
    const perTag = new Map();
    const remaining = [...candidates];

    while (remaining.length && selected.length < limit) {
      const index = remaining.findIndex((candidate) => {
        const tag = candidate.primaryTag || "其他";
        return (perTag.get(tag) || 0) < 2 && !usedSeries.has(candidate.seriesKey);
      });
      if (index < 0) break;
      const [candidate] = remaining.splice(index, 1);
      const tag = candidate.primaryTag || "其他";
      perTag.set(tag, (perTag.get(tag) || 0) + 1);
      usedPrimaryTags.add(tag);
      if (candidate.seriesKey) usedSeries.add(candidate.seriesKey);
      selected.push(candidate);
    }
    return selected;
  }

  function rankGroup(input, profile, source, limit, excluded, usedPrimaryTags, usedSeries) {
    const scored = (Array.isArray(input) ? input : [])
      .map((candidate) => {
        const normalized = candidate?.subject
          ? candidate
          : { subject: candidate, tags: candidate?.tags || [] };
        const key = normalized?.subject?.key || "";
        return key && !excluded.has(key)
          ? scoreCandidate({ ...normalized, source }, profile)
          : null;
      })
      .filter(Boolean)
      .sort((left, right) =>
        right.score - left.score ||
        Number(right.ratingScore || 0) - Number(left.ratingScore || 0) ||
        String(left.subject?.name || "").localeCompare(String(right.subject?.name || ""), "zh-CN")
      );
    return selectDiverse(scored, limit, usedPrimaryTags, usedSeries);
  }

  function rankRecommendations(input) {
    const profile = input?.profile || buildTasteProfile([]);
    const excluded = new Set([
      ...(input?.queuedKeys || []),
      ...(input?.excludedKeys || [])
    ]);
    const usedPrimaryTags = new Set();
    const usedSeries = new Set();
    const inventoryLimit = Number.isFinite(Number(input?.inventoryLimit)) ? Number(input.inventoryLimit) : 3;
    const discoveryLimit = Number.isFinite(Number(input?.discoveryLimit)) ? Number(input.discoveryLimit) : 5;

    const inventory = rankGroup(input?.inventory, profile, "inventory", inventoryLimit, excluded, usedPrimaryTags, usedSeries);
    for (const item of inventory) excluded.add(item.subject.key);
    const discovery = rankGroup(input?.discovery, profile, "discovery", discoveryLimit, excluded, usedPrimaryTags, usedSeries);
    return { inventory, discovery };
  }

  function buildRecommendationNarrative(profile) {
    const tags = (profile?.favoriteTags || []).slice(0, 3).map((entry) => `「${entry.name}」`);
    const anchors = (profile?.anchors || []).slice(0, 2).map((entry) => `《${entry.name}》`);
    const anchorText = anchors.length ? `，尤其是${anchors.join("和")}` : "";
    const tagText = tags.length ? tags.join("、") : "「还没有稳定口味」";
    const avoid = (profile?.avoidTags || []).slice(0, 2).map((entry) => `「${entry.name}」`);
    const avoidText = avoid.length ? `。我也会绕开${avoid.join("、")}，免得又拿同一套东西烦你。` : "。先拿这批试探，不合适就换。";
    return `我从你的记录里看见${tagText}${anchorText}${avoidText}`;
  }

  return {
    buildTasteProfile,
    rankRecommendations,
    buildRecommendationNarrative,
    usefulTag
  };
});
