(function initPeriodReport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PeriodReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPeriodReport() {
  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizePeriodReport(input) {
    if (!input || typeof input !== "object") return null;
    const watchingWorks = normalizeArray(input.watchingWorks);
    const episodes = normalizeArray(input.episodes);
    const moods = normalizeArray(input.moods);
    const completedWorks = normalizeArray(input.completedWorks);
    const highlights = normalizeArray(input.highlights);
    const quarterCharacters = normalizeArray(input.quarterCharacters);
    const quarterSelectedCharacters = normalizeArray(input.quarterSelectedCharacters);
    const quarterAwardsInput = input.quarterAwards && typeof input.quarterAwards === "object"
      ? input.quarterAwards
      : {};
    const quarterNewAnime = normalizeArray(quarterAwardsInput.newAnime);
    const quarterDroppedWorks = normalizeArray(quarterAwardsInput.droppedWorks);
    const quarterWatchedWorks = normalizeArray(quarterAwardsInput.watchedWorks);
    const stats = input.stats && typeof input.stats === "object" ? input.stats : {};
    const harunaComment = input.harunaComment && typeof input.harunaComment === "object"
      ? input.harunaComment
      : {};

    return {
      ...input,
      key: String(input.key || ""),
      type: ["week", "month", "quarter"].includes(input.type) ? input.type : "month",
      label: String(input.label || "未命名周期"),
      summary: String(input.summary || ""),
      stats: {
        records: finiteNumber(stats.records),
        notes: finiteNumber(stats.notes),
        articles: finiteNumber(stats.articles),
        words: finiteNumber(stats.words),
        activeDays: finiteNumber(stats.activeDays),
        episodes: finiteNumber(stats.episodes, episodes.length),
        completedWorks: finiteNumber(stats.completedWorks, completedWorks.length),
        watchingWorks: finiteNumber(stats.watchingWorks, watchingWorks.length),
        images: finiteNumber(stats.images),
        watchSessionCount: finiteNumber(stats.watchSessionCount),
        watchDurationMs: finiteNumber(stats.watchDurationMs),
        watchedEpisodes: finiteNumber(stats.watchedEpisodes),
        rewatchSessions: finiteNumber(stats.rewatchSessions)
      },
      moods,
      moodTotal: finiteNumber(
        input.moodTotal,
        moods.reduce((sum, mood) => sum + finiteNumber(mood?.count), 0)
      ),
      episodes,
      watchingWorks,
      completedWorks,
      highlights,
      quarterAwards: {
        watchedWorks: quarterWatchedWorks,
        newAnime: quarterNewAnime,
        newAnimeCount: finiteNumber(quarterAwardsInput.newAnimeCount, quarterNewAnime.length),
        droppedWorks: quarterDroppedWorks,
        droppedCount: finiteNumber(quarterAwardsInput.droppedCount, quarterDroppedWorks.length),
        highestRated: quarterAwardsInput.highestRated || null,
        surpriseWork: quarterAwardsInput.surpriseWork || null,
        surpriseDelta: finiteNumber(quarterAwardsInput.surpriseDelta)
      },
      quarterCharacters,
      quarterSelectedCharacters,
      harunaComment: {
        content: String(harunaComment.content || ""),
        source: harunaComment.source === "ai" ? "ai" : "local",
        generatedAt: harunaComment.generatedAt || null
      }
    };
  }

  function normalizePeriodReports(input) {
    if (!input || typeof input !== "object") return {};
    return Object.fromEntries(
      Object.entries(input)
        .map(([key, report]) => [key, normalizePeriodReport(report)])
        .filter(([, report]) => report)
    );
  }

  return {
    normalizePeriodReport,
    normalizePeriodReports
  };
});
