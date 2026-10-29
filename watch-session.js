(function initWatchSession(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WatchSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createWatchSessionApi() {
  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeEpisode(episode) {
    if (!episode || typeof episode !== "object") {
      return { id: null, sort: 0, label: "" };
    }
    return {
      id: episode.id ?? null,
      sort: finiteNumber(episode.sort ?? episode.ep),
      label: String(episode.label || episode.episodeLabel || episode.name_cn || episode.name || "")
    };
  }

  function normalizeWatchSession(input) {
    if (!input || typeof input !== "object") return null;
    const subjectKey = String(input.subjectKey || "");
    const startAt = new Date(input.startAt);
    if (!subjectKey || Number.isNaN(startAt.getTime())) return null;

    const endAt = input.endAt ? new Date(input.endAt) : null;
    const normalizedEnd = endAt && !Number.isNaN(endAt.getTime()) ? endAt : null;
    const startEpisode = normalizeEpisode(input.startEpisode);
    const endEpisode = normalizeEpisode(input.endEpisode || input.startEpisode);
    const episodeCount = Math.max(1, Math.round(finiteNumber(
      input.episodeCount,
      endEpisode.sort >= startEpisode.sort && endEpisode.sort > 0
        ? endEpisode.sort - startEpisode.sort + 1
        : 1
    )));
    const durationMs = normalizedEnd
      ? Math.max(0, finiteNumber(
          input.durationMs,
          normalizedEnd.getTime() - startAt.getTime()
        ))
      : 0;

    return {
      id: String(input.id || `watch:${subjectKey}:${startAt.toISOString()}`),
      subjectKey,
      bangumiId: Number(input.bangumiId) || null,
      subjectName: String(input.subjectName || ""),
      subjectType: finiteNumber(input.subjectType, 2),
      startAt: startAt.toISOString(),
      endAt: normalizedEnd?.toISOString() || null,
      durationMs,
      startEpisode,
      endEpisode,
      episodeCount,
      isRewatch: Boolean(input.isRewatch),
      createdAt: input.createdAt || startAt.toISOString()
    };
  }

  function normalizeWatchSessions(input) {
    return (Array.isArray(input) ? input : [])
      .map(normalizeWatchSession)
      .filter(Boolean);
  }

  function createWatchSession({ id, subject, episode, now = new Date(), isRewatch = false }) {
    const timestamp = new Date(now);
    const normalizedEpisode = normalizeEpisode(episode);
    return normalizeWatchSession({
      id,
      subjectKey: subject?.key,
      bangumiId: subject?.bangumiId,
      subjectName: subject?.name,
      subjectType: subject?.type,
      startAt: timestamp,
      endAt: null,
      durationMs: 0,
      startEpisode: normalizedEpisode,
      endEpisode: normalizedEpisode,
      episodeCount: 1,
      isRewatch,
      createdAt: timestamp
    });
  }

  function finishWatchSession(session, {
    episode,
    now = new Date(),
    isRewatch = session?.isRewatch
  } = {}) {
    const normalized = normalizeWatchSession(session);
    if (!normalized) return null;
    const endEpisode = normalizeEpisode(episode || normalized.endEpisode || normalized.startEpisode);
    const episodeCount = endEpisode.sort >= normalized.startEpisode.sort && endEpisode.sort > 0
      ? endEpisode.sort - normalized.startEpisode.sort + 1
      : 1;
    const endAt = new Date(now);
    return normalizeWatchSession({
      ...normalized,
      endAt,
      endEpisode,
      episodeCount,
      durationMs: Math.max(0, endAt.getTime() - new Date(normalized.startAt).getTime()),
      isRewatch: Boolean(isRewatch)
    });
  }

  function summarizeWatchSessions(sessions, startAt, endAt) {
    const startTime = new Date(startAt).getTime();
    const endTime = new Date(endAt).getTime();
    const summary = {
      sessionCount: 0,
      durationMs: 0,
      episodeCount: 0,
      rewatchCount: 0
    };
    for (const session of normalizeWatchSessions(sessions)) {
      if (!session.endAt) continue;
      const time = new Date(session.startAt).getTime();
      if (!Number.isFinite(time) || time < startTime || time >= endTime) continue;
      summary.sessionCount += 1;
      summary.durationMs += session.durationMs;
      summary.episodeCount += session.episodeCount;
      if (session.isRewatch) summary.rewatchCount += 1;
    }
    return summary;
  }

  function formatWatchDuration(value) {
    const durationMs = Math.max(0, finiteNumber(value));
    if (durationMs > 0 && durationMs < 60_000) return "少于 1 分钟";
    const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} 分钟`;
    if (!minutes) return `${hours} 小时`;
    return `${hours} 小时 ${minutes} 分`;
  }

  return {
    createWatchSession,
    finishWatchSession,
    normalizeWatchSession,
    normalizeWatchSessions,
    summarizeWatchSessions,
    formatWatchDuration
  };
});
