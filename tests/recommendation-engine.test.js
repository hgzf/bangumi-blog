const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTasteProfile,
  rankRecommendations,
  buildRecommendationNarrative
} = require("../recommendation-engine");

function subject(id, name, options = {}) {
  return {
    key: `bgm:${options.type || 2}:${id}`,
    bangumiId: id,
    name,
    type: options.type || 2,
    status: options.status || 2,
    myScore: options.myScore || 0,
    tags: options.tags || [],
    updatedAt: options.updatedAt || "2026-01-01T00:00:00.000Z"
  };
}

test("taste profile boosts favorite tags and avoids dropped low-score tags", () => {
  const profile = buildTasteProfile([
    subject(1, "喜欢的悬疑群像", {
      status: 3,
      myScore: 9,
      tags: ["悬疑", "群像", "心理"]
    }),
    subject(2, "低分后宫", {
      status: 5,
      myScore: 4,
      tags: ["后宫", "卖肉", "悬疑"]
    })
  ]);

  assert.ok(profile.favoriteTags.some((entry) => entry.name === "悬疑"));
  assert.ok(profile.avoidTags.some((entry) => entry.name === "后宫"));
  assert.ok(
    profile.favoriteTags.find((entry) => entry.name === "群像").score >
      profile.favoriteTags.find((entry) => entry.name === "悬疑").score
  );
});

test("ranking separates wish inventory from discoveries and excludes queued subjects", () => {
  const profile = buildTasteProfile([
    subject(1, "偏好锚点", {
      status: 3,
      myScore: 9,
      tags: ["悬疑", "群像"]
    })
  ]);
  const inventory = [
    subject(10, "库存悬疑", { status: 1, tags: ["悬疑", "群像"] })
  ];
  const discovery = [
    subject(20, "新作悬疑", { tags: ["悬疑"] }),
    subject(21, "已加入接下来", { tags: ["悬疑"] }),
    subject(22, "已看过", { status: 2, myScore: 8, tags: ["群像"] })
  ];

  const ranked = rankRecommendations({
    profile,
    inventory,
    discovery,
    queuedKeys: new Set(["bgm:2:21"]),
    excludedKeys: new Set(["bgm:2:22"]),
    inventoryLimit: 3,
    discoveryLimit: 5
  });

  assert.deepEqual(ranked.inventory.map((item) => item.subject.name), ["库存悬疑"]);
  assert.deepEqual(ranked.discovery.map((item) => item.subject.name), ["新作悬疑"]);
  assert.equal(ranked.inventory[0].source, "inventory");
  assert.equal(ranked.discovery[0].source, "discovery");
});

test("ranking limits repeated primary tags and writes anchored card reasons", () => {
  const profile = buildTasteProfile([
    subject(1, "春菜的锚点", {
      status: 3,
      myScore: 10,
      tags: ["悬疑", "群像"]
    })
  ]);
  const discovery = [
    subject(30, "悬疑一", { tags: ["悬疑"] }),
    subject(31, "悬疑二", { tags: ["悬疑"] }),
    subject(32, "悬疑三", { tags: ["悬疑"] }),
    subject(33, "群像一", { tags: ["群像"] })
  ];

  const ranked = rankRecommendations({
    profile,
    inventory: [],
    discovery,
    inventoryLimit: 3,
    discoveryLimit: 4
  });

  assert.equal(ranked.discovery.length, 3);
  assert.equal(ranked.discovery.filter((item) => item.primaryTag === "悬疑").length, 2);
  assert.match(ranked.discovery[0].reason, /春菜的锚点/);
  assert.match(ranked.discovery[0].reason, /悬疑|群像/);
  assert.doesNotMatch(ranked.discovery[0].reason, /值得一看/);
  assert.match(buildRecommendationNarrative(profile), /悬疑|群像/);
});

test("inventory recommendations do not cite themselves as taste anchors", () => {
  const profile = buildTasteProfile([
    subject(1, "真正看过的锚点", {
      status: 3,
      myScore: 9,
      tags: ["悬疑"]
    }),
    subject(10, "库存独有口味", {
      status: 4,
      tags: ["恋爱日常"]
    })
  ]);

  const ranked = rankRecommendations({
    profile,
    inventory: [
      subject(10, "库存独有口味", { status: 4, tags: ["恋爱日常"] })
    ],
    discovery: [],
    inventoryLimit: 3,
    discoveryLimit: 5
  });

  assert.doesNotMatch(ranked.inventory[0].reason, /《库存独有口味》/);
});

test("a recommendation list does not repeat multiple seasons of the same series", () => {
  const profile = buildTasteProfile([
    subject(1, "系列锚点", {
      status: 3,
      myScore: 9,
      tags: ["悬疑", "群像"]
    })
  ]);

  const ranked = rankRecommendations({
    profile,
    inventory: [],
    discovery: [
      subject(40, "测试作品 第一季", { tags: ["悬疑"] }),
      subject(41, "测试作品 第二季", { tags: ["悬疑"] }),
      subject(42, "另一部群像", { tags: ["群像"] })
    ],
    inventoryLimit: 3,
    discoveryLimit: 3
  });

  const names = ranked.discovery.map((item) => item.subject.name);
  assert.equal(names.filter((name) => name.startsWith("测试作品")).length, 1);
  assert.ok(names.includes("另一部群像"));
});
