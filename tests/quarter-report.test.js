const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getQuarterDescriptor,
  buildQuarterAwards,
  mergeQuarterCharacters,
  filterQuarterCharacters,
  toggleQuarterCharacterSelection
} = require("../quarter-report");

function work(id, name, options = {}) {
  return {
    key: `bgm:2:${id}`,
    bangumiId: id,
    type: 2,
    name,
    status: options.status ?? 2,
    myScore: options.myScore ?? 0,
    score: options.score ?? 0,
    date: options.date || "",
    updatedAt: options.updatedAt || "2026-08-15T12:00:00.000Z"
  };
}

test("quarter descriptor maps July to September to Q3", () => {
  const quarter = getQuarterDescriptor(new Date("2026-09-20T12:00:00+08:00"));

  assert.equal(quarter.key, "quarter:2026-Q3");
  assert.equal(quarter.label, "2026 年 Q3");
  assert.equal(quarter.start.getMonth(), 6);
  assert.equal(quarter.cutoff.getMonth(), 8);
});

test("quarter awards use activity inside the quarter and aired dates for new anime", () => {
  const awards = buildQuarterAwards({
    collections: [
      work(1, "本季新番最高分", {
        myScore: 9,
        score: 7.5,
        date: "2026-08-01",
        updatedAt: "2026-08-20T12:00:00.000Z"
      }),
      work(2, "旧番补完", {
        myScore: 8,
        score: 8.2,
        date: "2020-04-01",
        updatedAt: "2026-09-02T12:00:00.000Z"
      }),
      work(3, "本季弃番", {
        status: 5,
        myScore: 4,
        score: 8.6,
        date: "2026-07-10",
        updatedAt: "2026-08-10T12:00:00.000Z"
      }),
      work(4, "季度外作品", {
        myScore: 10,
        score: 9.8,
        date: "2025-01-01",
        updatedAt: "2026-06-30T12:00:00.000Z"
      })
    ],
    startAt: new Date("2026-07-01T00:00:00+08:00"),
    endAt: new Date("2026-10-01T00:00:00+08:00")
  });

  assert.equal(awards.newAnimeCount, 2);
  assert.deepEqual(awards.newAnime.map((item) => item.name), ["本季新番最高分", "本季弃番"]);
  assert.deepEqual(awards.droppedWorks.map((item) => item.name), ["本季弃番"]);
  assert.equal(awards.highestRated.name, "本季新番最高分");
  assert.equal(awards.surpriseWork.name, "本季新番最高分");
  assert.equal(awards.surpriseDelta, 1.5);
  assert.equal(awards.watchedWorks.length, 3);
});

test("quarter characters merge duplicate people across works and filter by role", () => {
  const characters = mergeQuarterCharacters([
    {
      work: work(1, "作品甲"),
      characters: [
        { id: 10, name: "主角A", relation: "主角", image: "a.jpg" },
        { id: 11, name: "配角A", relation: "配角", image: "b.jpg" }
      ]
    },
    {
      work: work(2, "作品乙"),
      characters: [
        { id: 10, name: "主角A", relation: "配角", image: "a.jpg" },
        { id: 12, name: "主角B", relation: "主角", image: "c.jpg" }
      ]
    }
  ]);

  assert.equal(characters.length, 3);
  const shared = characters.find((character) => character.id === 10);
  assert.equal(shared.role, "main");
  assert.deepEqual(shared.works.map((item) => item.name), ["作品甲", "作品乙"]);
  assert.deepEqual(filterQuarterCharacters(characters, "main").map((item) => item.name), ["主角A", "主角B"]);
  assert.deepEqual(filterQuarterCharacters(characters, "support").map((item) => item.name), ["配角A"]);
});

test("quarter character selection toggles one character without duplicating ids", () => {
  assert.deepEqual(toggleQuarterCharacterSelection([], 10), [10]);
  assert.deepEqual(toggleQuarterCharacterSelection([10], 11), [10, 11]);
  assert.deepEqual(toggleQuarterCharacterSelection([10, 11], 10), [11]);
});

test("character data keeps a dedicated thumbnail for search results", () => {
  const characters = mergeQuarterCharacters([{
    work: work(1, "作品甲"),
    characters: [{
      id: 20,
      name: "角色甲",
      relation: "主角",
      images: {
        large: "large.jpg",
        small: "small.jpg",
        grid: "grid.jpg"
      }
    }]
  }]);

  assert.equal(characters[0].image, "large.jpg");
  assert.equal(characters[0].thumbnail, "small.jpg");
});
