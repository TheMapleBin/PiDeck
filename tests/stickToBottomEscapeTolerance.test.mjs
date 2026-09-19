import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engineSource = readFileSync(
  "src/renderer/src/lib/stick-to-bottom/useStickToBottom.ts",
  "utf8",
);

// 跟随态只由 applyUserInput / 显式命令改变。普通 scroll 方向、内容增减、
// 视口 resize 都不得 setEscapedFromLock / setIsAtBottom。
test("layout scroll and resize never change follow state", () => {
  assert.match(engineSource, /if \(!isUserDrivenScroll\(\)\) \{\s*return;/);
  assert.match(engineSource, /applyUserInput\(/);
  assert.match(engineSource, /decideFollowFromUserInput\(/);
  assert.match(engineSource, /readerDisplacementPx/);
  assert.match(engineSource, /nextReaderUpPx/);
  assert.match(engineSource, /isVerticallyScrollableOverflow\(getComputedStyle\(element\)\.overflowY\)/);
  assert.doesNotMatch(
    engineSource,
    /getComputedStyle\(element\)\.overflow\)/,
  );
  assert.doesNotMatch(engineSource, /const POSITIVE_RESIZE_ESCAPE_LOCKOUT_MS/);
  assert.doesNotMatch(engineSource, /const GROWTH_ESCAPE_GUARD_PX/);
  assert.doesNotMatch(engineSource, /isWithinGrowthGuardBand/);
  assert.doesNotMatch(engineSource, /lastPositiveResizeAt/);
  // 已确认的拖动不得被流式 resize 守卫丢弃（探针 B）
  assert.doesNotMatch(
    engineSource,
    /if \(state\.resizeDifference \|\| scrollTop === ignoreScrollToTop\)/,
  );
});

test("escaped scroll is never dragged back by content growth", () => {
  assert.match(
    engineSource,
    /这里不再自动恢复已逃逸的锁底/,
  );
  assert.doesNotMatch(
    engineSource,
    /if \(difference >= 0\) \{[\s\S]*?setEscapedFromLock\(false\);[\s\S]*?const requested = mergeAnimations\(/,
  );
});

test("re-lock is only available from confirmed down input", () => {
  assert.match(engineSource, /if \(decision\.action === "relock"\) \{/);
  assert.match(engineSource, /followDirectionFromKey/);
  assert.match(engineSource, /isScrollbarGutterHit/);
  // 负增长不再偷偷重锁已浏览用户
  assert.doesNotMatch(
    engineSource,
    /if \(!state\.escapedFromLock && state\.isNearBottom\) \{\s*setEscapedFromLock\(false\);\s*setIsAtBottom\(true\);/,
  );
});

test("nested scroller at edge forwards wheel intent to the timeline", () => {
  assert.match(engineSource, /const canChildScroll =/);
  assert.match(engineSource, /applyWheelOnScroll\(scroll, deltaY\)/);
  assert.match(engineSource, /preserveScrollPosition,/);
});
