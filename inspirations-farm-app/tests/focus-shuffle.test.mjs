import assert from "node:assert/strict";
import test from "node:test";

import { selectRandomFocusItem } from "../src/lib/focus-shuffle.ts";

const ITEM_A = {
  bvid: "BV1f53B6qEB6",
  cid: "40377256216",
  sourceIndex: 0,
  title: "A",
  duration: 300,
};
const ITEM_B = {
  bvid: "BV1Ff421B7sS",
  cid: "1622386333",
  sourceIndex: 1,
  title: "B",
  duration: 400,
};

function sequenceRandom(...values) {
  let index = 0;
  return () => values[index++];
}

test("focus shuffle chooses a playlist first and an item second", () => {
  const selection = selectRandomFocusItem([
    { playlistId: "bilibili:ugc-season:1", items: [ITEM_A] },
    { playlistId: "bilibili:ugc-season:2", items: [ITEM_A, ITEM_B] },
  ], [], null, sequenceRandom(0.75, 0.75));

  assert.equal(selection?.playlistId, "bilibili:ugc-season:2");
  assert.equal(selection?.item.bvid, ITEM_B.bvid);
});

test("focus shuffle avoids recent tracks before relaxing exclusions", () => {
  const recent = [{
    playlistId: "bilibili:ugc-season:1",
    bvid: ITEM_A.bvid,
    cid: ITEM_A.cid,
    sourceIndex: ITEM_A.sourceIndex,
  }];
  const selection = selectRandomFocusItem([
    { playlistId: "bilibili:ugc-season:1", items: [ITEM_A, ITEM_B] },
  ], recent, recent[0], sequenceRandom(0, 0));

  assert.equal(selection?.item.bvid, ITEM_B.bvid);
});

test("focus shuffle permits repeats when the pool is exhausted", () => {
  const current = {
    playlistId: "bilibili:ugc-season:1",
    bvid: ITEM_A.bvid,
    cid: ITEM_A.cid,
    sourceIndex: ITEM_A.sourceIndex,
  };
  const selection = selectRandomFocusItem([
    { playlistId: "bilibili:ugc-season:1", items: [ITEM_A] },
  ], [current], current, sequenceRandom(0, 0));

  assert.equal(selection?.item.bvid, ITEM_A.bvid);
  assert.equal(selectRandomFocusItem([], [], null, sequenceRandom(0)), null);
});

test("focus shuffle rejects an invalid injected random source", () => {
  assert.throws(
    () => selectRandomFocusItem([
      { playlistId: "bilibili:ugc-season:1", items: [ITEM_A] },
    ], [], null, () => 1),
    RangeError
  );
});
