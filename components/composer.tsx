"use client";

import { useRef as useReactRef } from "react";
import { ArrowRightIcon, ChevronDownIcon, CornerDownLeftIcon, FileTextIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
import type { AttachmentDestination, ChatDocument } from "./chat-attachments";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";
import { useI18n } from "@/components/i18n-provider";
import { picturesReadable, usePictureReading } from "@/components/picture-reading";

export interface ComposerImage {
	data: string;
	mimeType: string;
	preview: string;
}

/**
 * The chat composer — content row ONLY (the persistent rounded shell lives in
 * the chat view's overlay, so the shell can later morph chat → question
 * without remounting).
 *
 * Corner-radius math (concentric with the shell): shell rounded-2xl (16px) −
 * row padding p-1.5 (6px) = button rounded-[10px] = 25% of the 40px button.
 */
/** What one Enter press does, in precedence order: stop a busy stream,
 *  otherwise send the message, otherwise — practice sessions only — fire
 *  the next-problem signal while the between-problems pause is live
 *  (owner round 16: Enter on an EMPTY composer is the go-ahead; typing
 *  anything makes Enter a send again). Pure so the static-render harness
 *  can pin the decision (key events can't be simulated in
 *  renderToStaticMarkup). */
export function enterAction(state: {
	busy: boolean;
	canSend: boolean;
	/** The between-problems pause is live: practice session, nothing
	 *  active, no turn/compaction in flight (the caller's fold). */
	nextProblem?: boolean;
}): "stop" | "send" | "next" | "none" {
	// Composer steering (owner arc 2026-10-03): while a turn runs, typed
	// text makes Enter a STEER (the queue-and-redirect send); Enter with
	// an empty composer stays the stop shortcut. The button itself keeps
	// the square — Stop stays one click away at all times.
	if (state.busy) return state.canSend ? "send" : "stop";
	if (state.canSend) return "send";
	if (state.nextProblem) return "next";
	return "none";
}

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

export function Composer({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	autoFocus,
	inputRef,
	onEscape,
	placeholder,
	nextProblem = false,
	onNext,
	images,
	onImagesChange,
	documents,
	onDocumentsChange,
	uploading,
	uploadError,
	notice,
	onDismissNotice,
}: {
	busy: boolean;
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	onStop: () => void;
	canSend: boolean;
	autoFocus?: boolean;
	/** The page's handle to the textarea — the dictation-end focus (owner,
	 *  2026-10-01): a run ending hands the cursor to the bare composer. */
	inputRef?: React.RefObject<HTMLTextAreaElement | null>;
	/** Escape while a dictation runs stops it (STT wave, 2026-09-17). No-op
	 *  when absent — Esc otherwise means nothing in the composer. */
	onEscape?: () => void;
	/** The textarea's placeholder (owner refinement round, 2026-09-24):
	 *  active sessions read copy.composer.sessionPlaceholder (localized); the fresh
	 *  new-session page asks the graph view's opening question instead. */
	placeholder?: string;
	/** The practice pause is live (owner round 16): Enter on the empty
	 *  composer fires the next-problem signal instead of doing nothing —
	 *  the keyboard-first move-on. */
	nextProblem?: boolean;
	/** The signal's dispatcher (send({type:"next"})) — the chip and the
	 *  empty-Enter share it. */
	onNext?: () => void;
	images?: ComposerImage[];
	onImagesChange?: (images: ComposerImage[]) => void;
	documents?: ChatDocument[];
	onDocumentsChange?: (documents: ChatDocument[]) => void;
	uploading?: boolean;
	uploadError?: string;
	/** A non-blocking note (e.g. pictures that could not be read); shown above the input until dismissed. */
	notice?: string;
	onDismissNotice?: () => void;
}) {
	const copy = useI18n();
	const pictures = usePictureReading();
	const fileInputRef = useReactRef<HTMLInputElement | null>(null);
	const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		e.target.value = "";
		const selectedDocuments = files.filter((file) => /\.(pdf|pptx|docx)$/i.test(file.name));
		// Each file starts from the user's remembered choice (only when the server can read pictures).
		if (selectedDocuments.length) onDocumentsChange?.([...(documents ?? []), ...selectedDocuments.map((file): ChatDocument => ({ file, destination: "chat", ...(pictures.available && pictures.enabled ? { readImages: true } : {}) }))]);
		const selectedImages = files.filter((file) => ACCEPTED_IMAGE_TYPES.split(",").includes(file.type));
		const loaded = await Promise.all(selectedImages.map((file) => new Promise<ComposerImage | null>((resolve) => {
			const reader = new FileReader();
			reader.onerror = () => resolve(null);
			reader.onload = () => {
				const preview = String(reader.result);
				const data = preview.split(",")[1];
				resolve(data ? { data, mimeType: file.type, preview } : null);
			};
			reader.readAsDataURL(file);
		})));
		if (loaded.length) onImagesChange?.([...(images ?? []), ...loaded.filter((image) => image !== null)]);
	};
	const act = () => {
		const action = enterAction({ busy, canSend, nextProblem });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext?.();
	};
	return (
		<div>
			{documents?.map(({ file, destination, readImages }, index) => (
				<div key={index} className="mx-3 mt-3 space-y-2 rounded-xl border border-border bg-background/60 p-2.5 text-sm">
					<div className="flex min-w-0 items-center gap-2 px-1">
						<FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate font-medium" title={file.name}>{file.name}</span>
					</div>
					<div className="flex items-center gap-2">
					<div className="relative min-w-0 flex-1">
						<select
							aria-label={`${copy.composer.attachmentDestination}: ${file.name}`}
							value={destination}
							disabled={uploading}
							onChange={(event) => {
								const next = event.target.value as AttachmentDestination;
								onDocumentsChange?.(documents.map((document, i) => i === index ? { ...document, destination: next } : document));
							}}
							className="h-9 w-full appearance-none truncate rounded-lg border border-border bg-card pl-2.5 pr-8 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
						>
							<option value="chat">{copy.composer.chatOnly}</option>
							<option value="personal">{copy.composer.personalKnowledge}</option>
							<option value="shared">{copy.composer.sharedKnowledge}</option>
						</select>
						<ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					</div>
					<button
						type="button"
						disabled={uploading}
						aria-label={`${copy.composer.removeAttachment}: ${file.name}`}
						onClick={() => onDocumentsChange?.(documents.filter((_, i) => i !== index))}
						className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
					>
						<XIcon aria-hidden className="size-4" />
					</button>
					</div>
					{pictures.available && picturesReadable(file.name) && (
						<label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground" title={copy.composer.readPicturesHint}>
							<input
								type="checkbox"
								checked={Boolean(readImages)}
								disabled={uploading}
								onChange={(event) => {
									const next = event.target.checked;
									onDocumentsChange?.(documents.map((document, i) => i === index ? { ...document, readImages: next } : document));
									pictures.setEnabled(next); // remembered as this user's choice
								}}
								className="size-3.5 accent-primary"
							/>
							{copy.composer.readPictures}
						</label>
					)}
				</div>
			))}
			{uploading && <p role="status" className="px-3 pt-2 text-sm">{documents?.some(({ readImages }) => readImages) ? copy.composer.readingAttachmentImages : copy.composer.uploadingAttachments}</p>}
			{uploadError && <p role="alert" className="px-3 pt-2 text-sm text-destructive">{uploadError}</p>}
			{notice && (
				<div role="status" data-testid="image-notice" className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
					<p className="min-w-0 flex-1">{notice}</p>
					{onDismissNotice && (
						<button type="button" aria-label={copy.composer.dismissNotice} onClick={onDismissNotice} className="-mr-1 grid size-5 shrink-0 place-items-center rounded transition-colors hover:bg-amber-500/20">
							<XIcon aria-hidden className="size-3.5" />
						</button>
					)}
				</div>
			)}
			{images && images.length > 0 && (
				<div className="flex flex-wrap gap-1.5 px-3 pt-2">
					{images.map((img, i) => (
						<div key={i} className="group/thumb relative">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={img.preview} alt="" className="size-14 rounded-md border border-border object-cover" />
							<button
								type="button"
								onClick={() => onImagesChange?.(images.filter((_, j) => j !== i))}
								className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover/thumb:flex"
							>
								<XIcon className="size-2.5" />
							</button>
						</div>
					))}
				</div>
			)}
			<form
				data-testid="composer"
				className="flex items-end gap-1.5 p-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					act();
				}}
			>
				{onImagesChange && (
					<>
						<input ref={fileInputRef} type="file" accept={`${ACCEPTED_IMAGE_TYPES},.pdf,.pptx,.docx`} multiple className="hidden" onChange={handleFileSelect} />
						<button
							type="button"
							disabled={uploading}
							onClick={() => fileInputRef.current?.click()}
							className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label={copy.composer.attachFiles}
						>
							<PaperclipIcon className="size-4" />
						</button>
					</>
				)}
				<textarea
				ref={inputRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					// Esc ends dictation before anything else Esc might someday mean
					// here (the dictate decisions: click-again or Esc to stop).
					// stopPropagation claims the Esc (keyboard wave A): the
					// window-level chain must not also abort a turn under us.
					if (e.key === "Escape" && onEscape) {
						e.preventDefault();
						e.stopPropagation();
						onEscape();
						return;
					}
					// Chat convention: Enter sends, Shift+Enter is a newline.
					// ⌘/Ctrl+Enter also sends — the universal submit shortcut
					// across every input in the app (thinking field, answers).
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
						e.preventDefault();
						act();
					}
				}}
				placeholder={placeholder ?? copy.composer.sessionPlaceholder}
				autoFocus={autoFocus}
				rows={1}
				className="field-sizing-content lh-input max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
			/>
			{/* The button follows the text (owner report 2026-10-03): while
				 a turn runs WITH text typed it stays the SEND affordance
				 (click = steer — steering must be clickable, not Enter-only);
				 only an empty composer morphs it to Stop. ESC keeps its
				 confirm-popup abort in every state, so stop is never
				 unreachable. No tooltip — the ↵ glyph is the affordance
				 (owner, subtlety round 2026-09-25).

				 THE NEXT MORPH (owner round 16 refinement, 2026-10-06): an
				 empty composer in the practice pause morphs the button into
				 a wide green NEXT PROBLEM — the affordance IS the button
				 (click and Enter share one lane), and typing anything
				 returns the regular send. The green is the app's correct-
				 answer register (answered-card's green-500/600). */}
				{nextProblem && !busy && !canSend ? (
					<button
						type="submit"
						data-testid="next-problem-button"
						aria-label={copy.composer.nextProblem}
						className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-green-600 px-4 font-ui text-xs font-medium uppercase tracking-wide text-white transition-colors hover:bg-green-500"
					>
						{copy.composer.nextProblem}
						<ArrowRightIcon className="size-4" />
					</button>
				) : (
					<button
						type="submit"
						aria-label={busy && !canSend ? copy.composer.stop : copy.composer.send}
						disabled={!busy && !canSend}
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-[10px] transition-colors",
							busy && !canSend
								? "bg-secondary text-foreground hover:bg-accent"
								: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40",
						)}
					>
						{busy && !canSend ? <SquareIcon className="size-4" /> : <CornerDownLeftIcon className="size-5" />}
					</button>
				)}
		</form>
		</div>
	);
}
