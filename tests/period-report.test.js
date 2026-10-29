const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePeriodReport } = require("../period-report");

test("normalizes a legacy monthly report that predates watchingWorks", () => {
  const legacy = {
    key: "month:2026-09",
    type: "month",
    label: "2026 年 9 月",
    startAt: "2026-08-31T16:00:00.000Z",
    endAt: "2026-09-29T19:00:00.000Z",
    summary: "本月写下 5 条记录。",
    stats: {
      records: 5,
      notes: 5,
      articles: 0,
      words: 121
    },
    completedWorks: [{ key: "bgm:2:1", name: "作品" }],
    highlights: [{ id: "post-1", title: "记录" }]
  };

  const report = normalizePeriodReport(legacy);

  assert.deepEqual(report.watchingWorks, []);
  assert.deepEqual(report.episodes, []);
  assert.deepEqual(report.moods, []);
  assert.deepEqual(report.completedWorks, legacy.completedWorks);
  assert.deepEqual(report.highlights, legacy.highlights);
  assert.equal(report.moodTotal, 0);
  assert.equal(report.stats.activeDays, 0);
  assert.equal(report.stats.episodes, 0);
  assert.equal(report.stats.completedWorks, 1);
  assert.equal(report.stats.watchingWorks, 0);
  assert.equal(report.stats.images, 0);
  assert.equal(report.stats.watchSessionCount, 0);
  assert.equal(report.stats.watchDurationMs, 0);
  assert.equal(report.stats.watchedEpisodes, 0);
  assert.equal(report.stats.rewatchSessions, 0);
  assert.deepEqual(report.quarterCharacters, []);
  assert.deepEqual(report.quarterSelectedCharacters, []);
  assert.deepEqual(report.quarterAwards.newAnime, []);
  assert.deepEqual(report.quarterAwards.droppedWorks, []);
  assert.equal(report.quarterAwards.newAnimeCount, 0);
  assert.equal(report.harunaComment.content, "");
  assert.equal(report.harunaComment.source, "local");
});

test("preserves complete period reports without inventing extra entries", () => {
  const report = normalizePeriodReport({
    key: "month:2026-10",
    type: "month",
    label: "2026 年 10 月",
    stats: {
      records: 2,
      watchingWorks: 1,
      watchSessionCount: 3,
      watchDurationMs: 5400000,
      watchedEpisodes: 4,
      rewatchSessions: 1
    },
    watchingWorks: [{ key: "watching" }],
    episodes: [{ key: "episode" }],
    moods: [{ value: "happy", count: 1 }],
    completedWorks: [],
    highlights: [],
    harunaComment: { content: "锐评", source: "ai" }
  });

  assert.deepEqual(report.watchingWorks, [{ key: "watching" }]);
  assert.deepEqual(report.episodes, [{ key: "episode" }]);
  assert.deepEqual(report.moods, [{ value: "happy", count: 1 }]);
  assert.equal(report.stats.watchingWorks, 1);
  assert.equal(report.stats.watchSessionCount, 3);
  assert.equal(report.stats.watchDurationMs, 5400000);
  assert.equal(report.stats.watchedEpisodes, 4);
  assert.equal(report.stats.rewatchSessions, 1);
  assert.equal(report.harunaComment.content, "锐评");
  assert.equal(report.harunaComment.source, "ai");
});

test("normalizes quarter reports and keeps character snapshots", () => {
  const report = normalizePeriodReport({
    key: "quarter:2026-Q3",
    type: "quarter",
    label: "2026 年 Q3",
    stats: { records: 1 },
    quarterAwards: {
      newAnimeCount: 2,
      newAnime: [{ key: "bgm:2:1" }],
      droppedWorks: [{ key: "bgm:2:2" }]
    },
    quarterCharacters: [{ id: 10, name: "主角A", role: "main", works: [] }],
    quarterSelectedCharacters: [{ id: 10, name: "主角A", role: "main", works: [] }]
  });

  assert.equal(report.type, "quarter");
  assert.equal(report.quarterAwards.newAnimeCount, 2);
  assert.equal(report.quarterAwards.newAnime.length, 1);
  assert.equal(report.quarterAwards.droppedWorks.length, 1);
  assert.equal(report.quarterCharacters[0].name, "主角A");
  assert.equal(report.quarterSelectedCharacters[0].name, "主角A");
});
