const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWatchSession,
  finishWatchSession,
  summarizeWatchSessions,
  normalizeWatchSessions,
  formatWatchDuration
} = require("../watch-session");

const subject = {
  key: "bgm:2:100",
  bangumiId: 100,
  name: "测试动画",
  type: 2
};

const episode3 = { id: 3, sort: 3, name_cn: "第三话" };
const episode6 = { id: 6, sort: 6, name_cn: "第六话" };

test("starting a watch session records its start time and first episode", () => {
  const session = createWatchSession({
    id: "session-1",
    subject,
    episode: episode3,
    now: "2026-10-27T12:00:00.000Z"
  });

  assert.equal(session.id, "session-1");
  assert.equal(session.subjectKey, "bgm:2:100");
  assert.equal(session.subjectName, "测试动画");
  assert.equal(session.startAt, "2026-10-27T12:00:00.000Z");
  assert.equal(session.endAt, null);
  assert.equal(session.startEpisode.sort, 3);
  assert.equal(session.endEpisode.sort, 3);
  assert.equal(session.episodeCount, 1);
  assert.equal(session.isRewatch, false);
});

test("finishing from episode 3 to episode 6 records four consecutive episodes", () => {
  const session = createWatchSession({
    id: "session-2",
    subject,
    episode: episode3,
    now: "2026-10-27T12:00:00.000Z"
  });

  const finished = finishWatchSession(session, {
    episode: episode6,
    now: "2026-10-27T13:30:00.000Z",
    isRewatch: true
  });

  assert.equal(finished.endAt, "2026-10-27T13:30:00.000Z");
  assert.equal(finished.durationMs, 5_400_000);
  assert.equal(finished.episodeCount, 4);
  assert.equal(finished.isRewatch, true);
  assert.equal(finished.endEpisode.sort, 6);
});

test("watch summaries include only finished sessions in the requested period", () => {
  const sessions = [
    {
      id: "sep-1",
      subjectKey: "bgm:2:100",
      startAt: "2026-09-10T12:00:00.000Z",
      endAt: "2026-09-10T13:30:00.000Z",
      durationMs: 5_400_000,
      episodeCount: 4,
      isRewatch: false
    },
    {
      id: "sep-2",
      subjectKey: "bgm:2:100",
      startAt: "2026-09-20T12:00:00.000Z",
      endAt: "2026-09-20T12:30:00.000Z",
      durationMs: 1_800_000,
      episodeCount: 1,
      isRewatch: true
    },
    {
      id: "active",
      subjectKey: "bgm:2:100",
      startAt: "2026-09-22T12:00:00.000Z",
      endAt: null,
      durationMs: 0,
      episodeCount: 0,
      isRewatch: false
    },
    {
      id: "outside",
      subjectKey: "bgm:2:100",
      startAt: "2026-08-31T12:00:00.000Z",
      endAt: "2026-08-31T13:00:00.000Z",
      durationMs: 3_600_000,
      episodeCount: 2,
      isRewatch: false
    }
  ];

  assert.deepEqual(summarizeWatchSessions(
    sessions,
    "2026-09-01T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z"
  ), {
    sessionCount: 2,
    durationMs: 7_200_000,
    episodeCount: 5,
    rewatchCount: 1
  });
});

test("watch session normalization drops unusable rows and keeps active sessions", () => {
  const sessions = normalizeWatchSessions([
    null,
    { id: "broken" },
    {
      id: "valid-active",
      subjectKey: "bgm:2:100",
      startAt: "2026-10-27T12:00:00.000Z",
      endAt: null,
      episodeCount: 1
    }
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "valid-active");
  assert.equal(sessions[0].endAt, null);
});

test("watch duration is formatted for compact history rows", () => {
  assert.equal(formatWatchDuration(0), "0 分钟");
  assert.equal(formatWatchDuration(1_263), "少于 1 分钟");
  assert.equal(formatWatchDuration(60_000), "1 分钟");
  assert.equal(formatWatchDuration(5_400_000), "1 小时 30 分");
});
