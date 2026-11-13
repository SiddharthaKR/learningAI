"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { useI18n } from "@/components/i18n-provider";

export function EditNodeBody({
	node,
	busy,
	failure,
	onClose,
	onSave,
}: {
	node: { id: string; name: string; statement: string };
	busy: boolean;
	failure: string | null;
	onClose: () => void;
	onSave: (name: string, statement: string) => void;
}) {
	const copy = useI18n().graphUi;
	const [name, setName] = useState(node.name);
	const [statement, setStatement] = useState(node.statement);

	useEffect(() => {
		setName(node.name);
		setStatement(node.statement);
	}, [node.name, node.statement]);

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={copy.editNodeAria}
			data-testid="edit-node-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-foreground">{copy.editNode}</h2>

			<label className="mt-3 block">
				<span className="text-xs text-muted-foreground">{copy.editNodeName}</span>
				<input
					data-testid="edit-node-name"
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
				/>
			</label>

			<label className="mt-3 block">
				<span className="text-xs text-muted-foreground">{copy.editNodeStatement}</span>
				<textarea
					data-testid="edit-node-statement"
					value={statement}
					onChange={(e) => setStatement(e.target.value)}
					rows={4}
					className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
				/>
			</label>

			{failure && (
				<div
					role="alert"
					data-testid="edit-node-failure"
					className="mt-3 rounded-sm border border-border/60 px-3 py-2 text-xs text-foreground"
				>
					{failure}
				</div>
			)}

			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="edit-node-cancel"
					onClick={onClose}
					disabled={busy}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				>
					{useI18n().dialogs.cancel}
				</button>
				<button
					type="button"
					data-testid="edit-node-save"
					onClick={() => onSave(name.trim(), statement.trim())}
					disabled={busy || name.trim() === "" || statement.trim() === ""}
					className="rounded-sm border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
				>
					{busy ? copy.saving : copy.save}
				</button>
			</div>
		</div>
	);
}

export function EditNodeDialog({
	node,
	onClose,
	onEdited,
}: {
	node: { id: string; name: string; statement: string } | null;
	onClose: () => void;
	onEdited: (graphRevision: number) => void;
}) {
	const copy = useI18n().graphUi;
	const [busy, setBusy] = useState(false);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		if (!node) {
			setBusy(false);
			setFailure(null);
		}
	}, [node]);

	useEffect(() => {
		if (!node) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [node, onClose]);

	const save = async (name: string, statement: string) => {
		if (!node || busy) return;
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/graph/nodes/${encodeURIComponent(node.id)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, statement }),
			});
			const body = (await res.json()) as { graphRevision?: number; error?: string };
			if (!res.ok) {
				setFailure(body.error ?? copy.editFailed);
				setBusy(false);
				return;
			}
			onEdited(body.graphRevision ?? 0);
		} catch {
			setFailure(copy.editFailed);
			setBusy(false);
		}
	};

	if (!node) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			{...backdropDismiss}
		>
			<EditNodeBody
				node={node}
				busy={busy}
				failure={failure}
				onClose={onClose}
				onSave={(name, statement) => void save(name, statement)}
			/>
		</div>,
		document.body,
	);
}
