const test = require("node:test");
const assert = require("node:assert/strict");

const ImageUrl = require("../image-url");

test("Bangumi images are upgraded from HTTP to HTTPS", () => {
  assert.equal(
    ImageUrl.secure("http://lain.bgm.tv/pic/cover/c/92/97/975_GFGYI.jpg"),
    "https://lain.bgm.tv/pic/cover/c/92/97/975_GFGYI.jpg"
  );
  assert.equal(
    ImageUrl.secure("https://lain.bgm.tv/pic/cover/c/92/97/975_GFGYI.jpg"),
    "https://lain.bgm.tv/pic/cover/c/92/97/975_GFGYI.jpg"
  );
});

test("calendar image sets preserve non-string values while securing URLs", () => {
  assert.deepEqual(
    ImageUrl.secureSet({
      common: "http://lain.bgm.tv/common.jpg",
      large: "https://lain.bgm.tv/large.jpg",
      width: 400
    }),
    {
      common: "https://lain.bgm.tv/common.jpg",
      large: "https://lain.bgm.tv/large.jpg",
      width: 400
    }
  );
});
