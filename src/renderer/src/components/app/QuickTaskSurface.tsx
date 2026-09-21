import type { ReactNode } from "react";
import type { useQuickTask } from "../../hooks/useQuickTask";
import { Button } from "../ui-shadcn/button";
import { t } from "../../i18n";

/** Reuses the normal ChatSessionPane, including approvals, stop, progress and errors. */
export function QuickTaskSurface({ task, children }: { task: ReturnType<typeof useQuickTask>; children: ReactNode }) {
	return (
		<div ref={task.surfaceRef} data-testid="quick-task-window" className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<header className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
				<div className="flex items-center justify-between gap-2">
					<strong>{t("quickTask.title")}</strong>
					<div className="flex gap-2">
						<Button data-testid="quick-task-new" variant="outline" size="sm" disabled={task.busy || !task.canRetry} onClick={task.startNew}>
							{t("quickTask.new")}
						</Button>
						<Button data-testid="quick-task-workbench" size="sm" onClick={task.exit}>
							{t("quickTask.workbench")}
						</Button>
					</div>
				</div>
				<div data-testid="quick-task-path" className="break-all text-xs text-muted-foreground">
					{task.path}
				</div>
				<p className="text-xs text-muted-foreground">{t("quickTask.closeHint")}</p>
				{task.pendingPath && (
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span className="break-all">{t("quickTask.pending", { path: task.pendingPath })}</span>
						<Button size="sm" onClick={task.startNew}>
							{t("quickTask.new")}
						</Button>
						<Button size="sm" variant="outline" onClick={task.keepCurrent}>
							{t("quickTask.keep")}
						</Button>
					</div>
				)}
				{task.error && (
					<div data-testid="quick-task-error" role="alert" className="break-all text-sm text-destructive">
						{task.error}
					</div>
				)}
			</header>
			{task.needsProject && !task.session ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
					<p>{t("quickTask.addDescription")}</p>
					<Button data-testid="quick-task-add-project" disabled={task.busy} onClick={task.addProject}>
						{t("app.openFolderConfirmAdd")}
					</Button>
				</div>
			) : task.session ? (
				<div className="flex min-h-0 flex-1 flex-col">{children}</div>
			) : (
				<div className="flex flex-1 items-center justify-center p-6">{task.busy ? t("quickTask.loading") : task.error && task.canRetry ? <Button onClick={task.retry}>{t("quickTask.retry")}</Button> : null}</div>
			)}
		</div>
	);
}
