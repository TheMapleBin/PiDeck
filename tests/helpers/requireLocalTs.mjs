import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const nodeRequire = createRequire(import.meta.url);

/**
 * 以 Node 原生 TS 类型剥离（Node 22+ 的 `require("x.ts")`）加载项目内的本地模块。
 *
 * 为什么需要这个 helper：一批测试用手写 vm 桩加载器执行 `AgentManager.ts`，未识别的
 * import 会落到 `nodeRequire(specifier)`——而它的解析基准是 **tests/ 目录**而不是被加载的
 * 生产文件。于是生产代码只要新增一个本地依赖（例如 #213 引入的 `./messagePayloadSize`），
 * 这些测试就整片 MODULE_NOT_FOUND，报错还指向测试文件本身，看不出真正原因。
 *
 * 这里把相对 specifier 按「被加载文件所在目录」解析后交给 Node；被加载模块内部的相对
 * import 由 Node 自己沿真实目录解析，所以不需要在测试里逐个补桩。
 *
 * 适用范围：**只有手写 vm 加载器**（自建 sandbox + 自己的 require 分支）需要它。
 * `helpers/loadTsCommonJs.mjs` 内部已经用 resolveLocalModule 从源文件解析相对导入，
 * 消费者不要再补一层——那里真正的坑是传入自定义 globals.require 把它覆盖掉。
 *
 * @param {string} specifier 原始 import 描述符（只处理相对路径，包名返回 null）
 * @param {string} fromDir   被加载文件所在目录（相对项目根或绝对路径）
 * @returns {unknown | null} 解析不到对应文件时返回 null，由调用方决定回退策略
 */
export function tryRequireLocalTs(specifier, fromDir) {
  // 包名与内置模块（electron/node:fs/…）不属于本 helper 的职责，交回调用方
  if (!specifier.startsWith(".")) return null;
  const base = resolve(fromDir, specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")];
  const match = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!match) return null;
  // 文件存在却加载失败（例如又依赖了 electron）时让错误直接抛出：
  // 调用点在此之前只会得到更难排查的 MODULE_NOT_FOUND。
  return nodeRequire(match);
}
