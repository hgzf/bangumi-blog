(function initFolderSync(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FolderSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFolderSyncApi() {
  const FORMAT = "bgm-local-blog-folder-sync";
  const VERSION = 1;
  const TOMBSTONE_KINDS = ["posts", "watchSessions", "watchQueue", "customEmojis"];

  function timestamp(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function emptyTombstones() {
    return Object.fromEntries(TOMBSTONE_KINDS.map((kind) => [kind, {}]));
  }

  function normalizeTombstones(value) {
    const result = emptyTombstones();
    for (const kind of TOMBSTONE_KINDS) {
      if (!value?.[kind] || typeof value[kind] !== "object") continue;
      for (const [key, deletedAt] of Object.entries(value[kind])) {
        if (timestamp(deletedAt) > 0) result[kind][String(key)] = new Date(deletedAt).toISOString();
      }
    }
    return result;
  }

  function mergeTombstones(sources) {
    const result = emptyTombstones();
    for (const source of sources) {
      const tombstones = normalizeTombstones(source?.database?.syncTombstones);
      for (const kind of TOMBSTONE_KINDS) {
        for (const [key, deletedAt] of Object.entries(tombstones[kind])) {
          if (timestamp(deletedAt) >= timestamp(result[kind][key])) result[kind][key] = deletedAt;
        }
      }
    }
    return result;
  }

  function newer(source, current) {
    return !current || timestamp(source.time) >= timestamp(current.time);
  }

  function mergeEntityList(sources, field, identity, timeOf, tombstones) {
    const selected = new Map();
    for (const source of sources) {
      for (const item of Array.isArray(source.database?.[field]) ? source.database[field] : []) {
        const key = String(identity(item) || "");
        if (!key) continue;
        const candidate = { item, time: timeOf(item, source.savedAt), savedAt: source.savedAt };
        if (newer(candidate, selected.get(key))) selected.set(key, candidate);
      }
    }
    return [...selected.entries()]
      .filter(([key, entry]) => timestamp(tombstones?.[key]) < timestamp(entry.time))
      .map(([, entry]) => entry.item);
  }

  function mergeObjectMaps(sources, field) {
    const result = {};
    for (const source of sources) {
      const value = source.database?.[field];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(result, value);
      }
    }
    return result;
  }

  function mergeSettings(sources, tombstones) {
    const result = {};
    for (const source of sources) {
      if (source.database?.settings && typeof source.database.settings === "object") {
        Object.assign(result, source.database.settings);
      }
    }
    const emojis = new Map();
    for (const source of sources) {
      for (const emoji of Array.isArray(source.database?.settings?.customEmojis)
        ? source.database.settings.customEmojis
        : []) {
        if (emoji?.name) emojis.set(String(emoji.name), emoji);
      }
    }
    result.customEmojis = [...emojis.entries()]
      .filter(([name]) => !tombstones.customEmojis[name])
      .map(([, emoji]) => emoji);
    return result;
  }

  function latestSource(sources, valueOf) {
    let selected = null;
    for (const source of sources) {
      const value = valueOf(source.database, source);
      if (!value) continue;
      const candidate = { value, time: timestamp(value), savedAt: source.savedAt, source };
      if (newer(candidate, selected)) selected = candidate;
    }
    return selected;
  }

  function profileObject(database) {
    const profile = database?.profile;
    return profile && typeof profile === "object" && !Array.isArray(profile) ? profile : null;
  }

  function validSnapshot(snapshot) {
    return snapshot &&
      snapshot.format === FORMAT &&
      Number(snapshot.version) === VERSION &&
      typeof snapshot.deviceId === "string" &&
      snapshot.database &&
      typeof snapshot.database === "object";
  }

  function mergeSnapshots(currentDatabase, snapshots, { now = new Date().toISOString() } = {}) {
    const remote = (Array.isArray(snapshots) ? snapshots : [])
      .filter(validSnapshot)
      .map((snapshot) => ({
        deviceId: snapshot.deviceId,
        savedAt: snapshot.savedAt || new Date(0).toISOString(),
        database: snapshot.database
      }));
    const sources = [
      { deviceId: "local", savedAt: now, database: currentDatabase || {} },
      ...remote
    ].sort((left, right) => timestamp(left.savedAt) - timestamp(right.savedAt));
    const latest = sources[sources.length - 1]?.database || {};
    const tombstones = mergeTombstones(sources);
    const posts = mergeEntityList(
      sources,
      "posts",
      (post) => post?.id,
      (post) => post?.updatedAt || post?.createdAt,
      tombstones.posts
    ).sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
    const watchSessions = mergeEntityList(
      sources,
      "watchSessions",
      (session) => session?.id,
      (session) => session?.endAt || session?.startAt || session?.createdAt,
      tombstones.watchSessions
    ).sort((left, right) => timestamp(right.startAt) - timestamp(left.startAt));
    const watchQueue = mergeEntityList(
      sources,
      "watchQueue",
      (item) => item?.id,
      (item) => item?.completedAt || item?.addedAt,
      tombstones.watchQueue
    ).sort((left, right) => timestamp(right.addedAt) - timestamp(left.addedAt));
    const collectionSource = latestSource(sources, (database) => database.lastSyncAt);
    const calendarSource = latestSource(sources, (database) => database.calendarCache?.syncedAt);
    const chatSource = latestSource(sources, (_database, source) => source.savedAt);
    const profileSource = latestSource(sources, (database, source) =>
      profileObject(database) ? source.savedAt : ""
    );
    const lastSyncAt = collectionSource?.value || latest.lastSyncAt || null;
    const profile = profileSource
      ? profileObject(profileSource.source?.database)
      : profileObject(latest);

    return {
      ...latest,
      version: latest.version || 1,
      posts,
      collections: Array.isArray(collectionSource?.source?.database?.collections)
        ? collectionSource.source.database.collections
        : (latest.collections || []),
      subjectCache: mergeObjectMaps(sources, "subjectCache"),
      characterCache: mergeObjectMaps(sources, "characterCache"),
      subjectCharacterCache: mergeObjectMaps(sources, "subjectCharacterCache"),
      episodeCache: mergeObjectMaps(sources, "episodeCache"),
      calendarCache: calendarSource?.source?.database?.calendarCache || latest.calendarCache,
      profile,
      settings: mergeSettings(sources, tombstones),
      chatMessages: Array.isArray(chatSource?.source?.database?.chatMessages)
        ? chatSource.source.database.chatMessages
        : (latest.chatMessages || []),
      yearbookComments: mergeObjectMaps(sources, "yearbookComments"),
      periodReports: mergeObjectMaps(sources, "periodReports"),
      quarterCharacterSelections: mergeObjectMaps(sources, "quarterCharacterSelections"),
      watchSessions,
      watchQueue,
      syncTombstones: tombstones,
      lastSyncAt
    };
  }

  function createSnapshot({ database, deviceId, platform, savedAt = new Date().toISOString() }) {
    if (!database || typeof database !== "object") throw new Error("同步数据库不能为空。");
    if (!String(deviceId || "").trim()) throw new Error("同步设备 ID 不能为空。");
    return {
      format: FORMAT,
      version: VERSION,
      deviceId: String(deviceId),
      platform: String(platform || ""),
      savedAt,
      database
    };
  }

  function hasChanges(left, right) {
    return JSON.stringify(left) !== JSON.stringify(right);
  }

  return {
    FORMAT,
    VERSION,
    TOMBSTONE_KINDS,
    emptyTombstones,
    normalizeTombstones,
    mergeSnapshots,
    createSnapshot,
    hasChanges
  };
});
