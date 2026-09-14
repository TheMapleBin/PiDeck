// beui.dev/components/motion/text-animation
import { cn } from "@/lib/utils";
import type { ElementType, ReactNode } from "react";
import {
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from "@/lib/text-shimmer";

export interface TextShimmerProps {
  children: ReactNode;
  as?: ElementType;
  duration?: number;
  className?: string;
  /**
   * false 时退化为静态渐变文字（等于动画定格在某一帧，视觉几乎无差别）。
   * 本动画动的是 background-position + bg-clip:text，高分辨率 × 高刷新率
   * 窗口下每帧都触发整窗合成，常驻 infinite 循环实测空闲即占约 1 个 CPU
   * 核心（GPU 进程为最大头）。因此只有「短暂播放」或「任务运行态才挂载」
   * 的场景允许开启；常驻 UI（如品牌字标）必须传 false 或自行限时。
   */
  enabled?: boolean;
}

export function TextShimmer({
  children,
  as: Comp = "span",
  duration = 2.5,
  className,
  enabled = true,
}: TextShimmerProps) {
  return (
    <>
      <style>
        {TEXT_SHIMMER_KEYFRAMES}
      </style>
      <Comp
        style={enabled ? textShimmerStyle(duration) : undefined}
        className={cn(
          "inline-block",
          TEXT_SHIMMER_CLASS_NAME,
          className,
        )}
      >
        {children}
      </Comp>
    </>
  );
}
