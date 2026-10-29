(function initQuarterReport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QuarterReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createQuarterReport() {
  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function getQuarterDescriptor(cutoffValue = new Date()) {
    const cutoff = new Date(cutoffValue);
    const year = cutoff.getFullYear();
    const quarterIndex = Math.floor(cutoff.getMonth() / 3);
    const start = new Date(year, quarterIndex * 3, 1);
    return {
      key: `quarter:${year}-Q${quarterIndex + 1}`,
      type: "quarter",
      label: `${year} 年 Q${quarterIndex + 1}`,
      start,
      cutoff
    };
  }

  function latestQuarterCutoff(now = new Date()) {
    const current = new Date(now);
    const quarterIndex = Math.floor(current.getMonth() / 3);
    const currentQuarterEnd = new Date(current.getFullYear(), quarterIndex * 3 + 3, 0, 3, 0, 0, 0);
    if (current.getTime() >= currentQuarterEnd.getTime()) return currentQuarterEnd;
    return new Date(current.getFullYear(), quarterIndex * 3, 0, 3, 0, 0, 0);
  }

  function workSnapshot(subject) {
    return {
      key: String(subject.key || ""),
      bangumiId: finiteNumber(subject.bangumiId || subject.id),
      name: String(subject.name || "未命名作品"),
      type: finiteNumber(subject.type, 2),
      status: finiteNumber(subject.status),
      image: String(subject.image || ""),
      myScore: finiteNumber(subject.myScore),
      score: finiteNumber(subject.score),
      date: String(subject.date || ""),
      updatedAt: subject.updatedAt || ""
    };
  }

  function inRange(value, startTime, endTime) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time >= startTime && time < endTime;
  }

  function buildQuarterAwards({ collections, startAt, endAt }) {
    const startTime = new Date(startAt).getTime();
    const endTime = new Date(endAt).getTime();
    const watchedWorks = (Array.isArray(collections) ? collections : [])
      .filter((subject) =>
        finiteNumber(subject.type, 2) === 2 &&
        [2, 3, 5].includes(finiteNumber(subject.status)) &&
        inRange(subject.updatedAt, startTime, endTime)
      )
      .map(workSnapshot)
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));

    const newAnime = watchedWorks
      .filter((subject) => inRange(subject.date, startTime, endTime))
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    const droppedWorks = watchedWorks
      .filter((subject) => subject.status === 5)
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    const rankedWorks = watchedWorks
      .filter((subject) => subject.myScore > 0)
      .sort((left, right) =>
        right.myScore - left.myScore ||
        right.score - left.score ||
        new Date(right.updatedAt) - new Date(left.updatedAt)
      );
    const highestRated = rankedWorks[0] || null;

    const surpriseCandidates = rankedWorks
      .filter((subject) => subject.score > 0)
      .map((subject) => ({
        ...subject,
        surpriseDelta: Math.round((subject.myScore - subject.score) * 10) / 10
      }));
    const positiveSurprises = surpriseCandidates.filter((subject) => subject.surpriseDelta > 0);
    const surpriseWork = [...(positiveSurprises.length ? positiveSurprises : surpriseCandidates)]
      .sort((left, right) =>
        Math.abs(right.surpriseDelta) - Math.abs(left.surpriseDelta) ||
        right.myScore - left.myScore
      )[0] || null;

    return {
      watchedWorks,
      newAnime,
      newAnimeCount: newAnime.length,
      droppedWorks,
      droppedCount: droppedWorks.length,
      highestRated,
      surpriseWork,
      surpriseDelta: surpriseWork?.surpriseDelta || 0
    };
  }

  function normalizeCharacter(raw, work) {
    if (!raw || !raw.id) return null;
    const relation = String(raw.relation || "");
    const role = relation.includes("主角") ? "main" : relation.includes("配角") ? "support" : "";
    if (!role) return null;
    const images = raw.images || {};
    return {
      id: finiteNumber(raw.id),
      name: String(raw.name_cn || raw.name || `角色 ${raw.id}`),
      nameCn: String(raw.name_cn || ""),
      originalName: String(raw.name || ""),
      image: String(images.large || images.medium || images.common || images.grid || ""),
      thumbnail: String(images.small || images.grid || images.common || images.medium || images.large || ""),
      role,
      relations: [relation],
      actors: (Array.isArray(raw.actors) ? raw.actors : []).map((actor) => ({
        id: finiteNumber(actor.id),
        name: String(actor.name || ""),
        image: String(actor.images?.large || actor.images?.medium || actor.images?.grid || "")
      })),
      works: work ? [{
        key: String(work.key || ""),
        bangumiId: finiteNumber(work.bangumiId),
        name: String(work.name || "未命名作品")
      }] : []
    };
  }

  function mergeCharacters(target, incoming) {
    if (incoming.role === "main" && target.role !== "main") target.role = "main";
    if (!target.image && incoming.image) target.image = incoming.image;
    if (!target.thumbnail && incoming.thumbnail) target.thumbnail = incoming.thumbnail;
    if (!target.nameCn && incoming.nameCn) {
      target.nameCn = incoming.nameCn;
      target.name = incoming.nameCn;
    }
    if (!target.actors.length && incoming.actors.length) target.actors = incoming.actors;
    for (const relation of incoming.relations) {
      if (!target.relations.includes(relation)) target.relations.push(relation);
    }
    for (const work of incoming.works) {
      if (!target.works.some((entry) => entry.key === work.key)) target.works.push(work);
    }
  }

  function mergeQuarterCharacters(groups) {
    const characterMap = new Map();
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const raw of Array.isArray(group?.characters) ? group.characters : []) {
        const character = normalizeCharacter(raw, group.work);
        if (!character) continue;
        const existing = characterMap.get(character.id);
        if (existing) mergeCharacters(existing, character);
        else characterMap.set(character.id, character);
      }
    }
    return [...characterMap.values()];
  }

  function filterQuarterCharacters(characters, role) {
    const normalizedRole = role === "support" ? "support" : "main";
    return (Array.isArray(characters) ? characters : [])
      .filter((character) => character?.role === normalizedRole);
  }

  function toggleQuarterCharacterSelection(selectedIds, characterId) {
    const id = finiteNumber(characterId);
    if (!id) return Array.isArray(selectedIds) ? [...selectedIds] : [];
    const selected = [...new Set(
      (Array.isArray(selectedIds) ? selectedIds : [])
        .map((value) => finiteNumber(value))
        .filter(Boolean)
    )];
    return selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
  }

  return {
    getQuarterDescriptor,
    latestQuarterCutoff,
    buildQuarterAwards,
    mergeQuarterCharacters,
    filterQuarterCharacters,
    toggleQuarterCharacterSelection
  };
});
