const test = require("node:test");
const assert = require("node:assert/strict");

const FolderSync = require("../folder-sync");

test("folder snapshots merge posts by id and keep the newest edit", () => {
  const current = {
    posts: [
      { id: "local-only", content: "电脑", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: "shared", content: "旧内容", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }
    ],
    collections: [],
    settings: {}
  };
  const remote = FolderSync.createSnapshot({
    deviceId: "android-device",
    platform: "android",
    savedAt: "2026-10-30T01:00:00.000Z",
    database: {
      posts: [
        { id: "android-only", content: "安卓", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" },
        { id: "shared", content: "新内容", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" }
      ],
      collections: [],
      settings: {}
    }
  });

  const merged = FolderSync.mergeSnapshots(current, [remote], { now: "2026-10-30T02:00:00.000Z" });

  assert.deepEqual(merged.posts.map((post) => post.id).sort(), ["android-only", "local-only", "shared"]);
  assert.equal(merged.posts.find((post) => post.id === "shared").content, "新内容");
});

test("folder snapshot tombstones prevent deleted records from returning", () => {
  const current = {
    posts: [{ id: "deleted-post", updatedAt: "2026-10-01T00:00:00.000Z" }],
    watchSessions: [{ id: "deleted-session", startAt: "2026-10-01T00:00:00.000Z" }],
    watchQueue: [],
    collections: [],
    settings: {}
  };
  const remote = FolderSync.createSnapshot({
    deviceId: "desktop-device",
    platform: "electron",
    savedAt: "2026-10-30T01:00:00.000Z",
    database: {
      posts: [],
      watchSessions: [],
      watchQueue: [],
      collections: [],
      settings: {},
      syncTombstones: {
        posts: { "deleted-post": "2026-10-20T00:00:00.000Z" },
        watchSessions: { "deleted-session": "2026-10-20T00:00:00.000Z" }
      }
    }
  });

  const merged = FolderSync.mergeSnapshots(current, [remote], { now: "2026-10-30T02:00:00.000Z" });

  assert.equal(merged.posts.some((post) => post.id === "deleted-post"), false);
  assert.equal(merged.watchSessions.some((session) => session.id === "deleted-session"), false);
  assert.ok(merged.syncTombstones.posts["deleted-post"]);
});

test("folder snapshots use the newest Bangumi collection sync without resurrecting removals", () => {
  const current = {
    posts: [],
    collections: [{ key: "bgm:2:1", name: "电脑旧收藏" }],
    settings: {},
    lastSyncAt: "2026-10-20T00:00:00.000Z"
  };
  const remote = FolderSync.createSnapshot({
    deviceId: "android-device",
    platform: "android",
    savedAt: "2026-10-30T01:00:00.000Z",
    database: {
      posts: [],
      collections: [{ key: "bgm:2:2", name: "安卓新收藏" }],
      settings: {},
      lastSyncAt: "2026-10-29T00:00:00.000Z"
    }
  });

  const merged = FolderSync.mergeSnapshots(current, [remote], { now: "2026-10-30T02:00:00.000Z" });

  assert.deepEqual(merged.collections, remote.database.collections);
  assert.equal(merged.lastSyncAt, "2026-10-29T00:00:00.000Z");
});

test("folder snapshots preserve a valid Bangumi profile object", () => {
  const current = {
    posts: [],
    collections: [],
    settings: {},
    profile: {
      id: 1,
      username: "desktop",
      nickname: "电脑旧头像",
      avatar: "https://example.com/old.jpg"
    }
  };
  const remoteProfile = {
    id: 2,
    username: "tablet",
    nickname: "平板新头像",
    avatar: "https://example.com/new.jpg"
  };
  const remote = FolderSync.createSnapshot({
    deviceId: "android-device",
    platform: "android",
    savedAt: "2026-10-30T01:00:00.000Z",
    database: {
      posts: [],
      collections: [],
      settings: {},
      profile: remoteProfile
    }
  });

  const merged = FolderSync.mergeSnapshots(current, [remote], { now: "2026-10-30T02:00:00.000Z" });

  assert.deepEqual(merged.profile, current.profile);
});

test("folder snapshots recover a profile from a valid remote snapshot", () => {
  const remoteProfile = {
    id: 2,
    username: "tablet",
    nickname: "平板新头像",
    avatar: "https://example.com/new.jpg"
  };
  const remote = FolderSync.createSnapshot({
    deviceId: "android-device",
    platform: "android",
    savedAt: "2026-10-30T01:00:00.000Z",
    database: {
      posts: [],
      collections: [],
      settings: {},
      profile: remoteProfile
    }
  });

  const merged = FolderSync.mergeSnapshots(
    {
      posts: [],
      collections: [],
      settings: {},
      profile: "2026-10-30T02:00:00.000Z"
    },
    [remote],
    { now: "2026-10-30T03:00:00.000Z" }
  );

  assert.deepEqual(merged.profile, remoteProfile);
});

test("folder snapshot envelope rejects invalid data", () => {
  assert.throws(
    () => FolderSync.createSnapshot({ database: null, deviceId: "device" }),
    /同步数据库不能为空/
  );
  assert.equal(
    FolderSync.mergeSnapshots({ posts: [], collections: [], settings: {} }, [{ format: "unknown" }]).posts.length,
    0
  );
});
