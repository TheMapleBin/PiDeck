import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

// v8HeapLimits：V8 老生代堆上限的分层策略（2026-08 #213）。
//
// 回归背景：原先只有一个全局 `--js-flags=--max-old-space-size=384`，Chromium 会把它
// 透传到每个渲染进程，会话窗口的 JS 堆被钉在 384MB，极端会话一次挂载上千条消息就
// V8 OOM（EXC_BREAKPOINT / exitCode 5），用户看到「窗口莫名重载」。
//
// 契约：主进程保留 384MB（RSS 卫生），渲染进程必须通过 additionalArguments 抬到更大档位。
// 这里锁死两个数值与字符串格式，防止有人「顺手统一」回单一全局开关。

function compile(filePath) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: () => ({}),
  }, { filename: filePath });
  return module.exports;
}

const { MAIN_MAX_OLD_SPACE_MB, RENDERER_MAX_OLD_SPACE_MB, mainProcessJsFlags, rendererHeapAdditionalArguments } =
  compile("src/main/v8HeapLimits.ts");

test("渲染进程档位必须显著大于主进程档位（否则 #213 会复发）", () => {
  assert.ok(RENDERER_MAX_OLD_SPACE_MB > MAIN_MAX_OLD_SPACE_MB);
  assert.ok(RENDERER_MAX_OLD_SPACE_MB >= 1024, "渲染档位至少 1GB 才有兜底意义");
});

test("主进程参数是 appendSwitch 用的裸 flags 字符串", () => {
  assert.equal(mainProcessJsFlags(), `--max-old-space-size=${MAIN_MAX_OLD_SPACE_MB}`);
  assert.ok(!mainProcessJsFlags().startsWith("--js-flags="), "appendSwitch('js-flags', ...) 只接受值本身");
});

test("渲染进程参数带 --js-flags= 前缀，用于 webPreferences.additionalArguments", () => {
  const args = rendererHeapAdditionalArguments();
  assert.equal(args.length, 1);
  assert.equal(args[0], `--js-flags=--max-old-space-size=${RENDERER_MAX_OLD_SPACE_MB}`);
  assert.ok(args[0].includes(String(RENDERER_MAX_OLD_SPACE_MB)));
  assert.ok(!args[0].includes(`=${MAIN_MAX_OLD_SPACE_MB}`), "渲染进程不应继承主进程档位");
});
