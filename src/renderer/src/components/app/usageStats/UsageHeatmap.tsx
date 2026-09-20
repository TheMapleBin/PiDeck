/**
 * GitHub 风格活跃热力图（自绘 SVG，无图表库依赖）。
 *
 * 数据：聚合器输出的 53 周 × 7 天网格（周一起始，index = week * 7 + day）。
 * 网格起点以聚合器下发的 heatmapStart 为准（单一来源，避免渲染层自行推算错位）。
 * level 0-4 由主进程按固定阈值算好（跨天可比）；色阶用语义 token（color-mix 于 accent）。
 */

import { useMemo } from "react";
import type { UsageAggregated } from "../../../../../shared/types";
import { t } from "../../../i18n";
import { formatDayKeyPlusOffset, formatTokens } from "./format";

const CELL = 10;
const GAP = 2;
const WEEKS = 53;
const DAYS = 7;

/** 色阶 class：0（无数据）→ 4（最高档）；token 化于 styles.css（暗色自动适配）。 */
const LEVEL_CLASSES = ["usage-heatmap-l0", "usage-heatmap-l1", "usage-heatmap-l2", "usage-heatmap-l3", "usage-heatmap-l4"];

const WEEK_LABELS = ["Mon", "Wed", "Fri"];

export function UsageHeatmap(props: { data: UsageAggregated }) {
	const { heatmap, heatmapStart } = props.data;

	// 渲染层不再推算网格起点：一律用聚合器下发的 heatmapStart
	const todayKey = useMemo(() => {
		const d = new Date();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		return `${d.getFullYear()}-${m}-${day}`;
	}, []);

	const width = WEEKS * (CELL + GAP) - GAP;
	const height = DAYS * (CELL + GAP) - GAP;

	return (
		<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("usageStats.heatmap.title")}>
			{heatmap.map((cell, index) => {
				const week = Math.floor(index / DAYS);
				const day = index % DAYS;
				const date = formatDayKeyPlusOffset(heatmapStart, index);
				// 未来日期（超出当前时间）置为无数据色；正常场景 53 周窗口覆盖至今
				const isFuture = date > todayKey;
				const colorClass = isFuture ? LEVEL_CLASSES[0] : LEVEL_CLASSES[cell.level];
				const x = week * (CELL + GAP);
				const y = day * (CELL + GAP);
				return (
					<rect key={index} x={x} y={y} width={CELL} height={CELL} rx={2} className={colorClass}>
						<title>
							{t("usageStats.heatmap.tooltip", {
								date,
								tokens: formatTokens(cell.tokens),
								turns: String(cell.turns),
							})}
						</title>
					</rect>
				);
			})}
			{WEEK_LABELS.map((label, i) => (
				<text key={label} x={-4} y={i * 2 * (CELL + GAP) + 9} fontSize={8} fill="var(--color-text-tertiary)" textAnchor="end">
					{label}
				</text>
			))}
		</svg>
	);
}
