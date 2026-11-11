/**
 * LhMark — the app mark: a small knowledge graph (owner, 2026-11-11; replaces
 * the earlier spiral mark). Three nodes joined by edges; the top node is solid
 * — "the concept you're learning now" — the other two are rings.
 *
 * Inlined as JSX (no network fetch, crisp at any size) and drawn in the theme's
 * --primary, so it follows light/dark mode. 24×24 viewBox, no padding: sizing
 * is the consumer's job. app/icon.svg is the same drawing for the browser tab.
 */
export function LhMark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
			<g stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round">
				<line x1="12" y1="6.5" x2="6" y2="17" />
				<line x1="12" y1="6.5" x2="18" y2="17" />
				<line x1="6" y1="17" x2="18" y2="17" />
			</g>
			<circle cx="12" cy="6.5" r="3.6" fill="var(--primary)" />
			<circle cx="6" cy="17" r="2.9" fill="var(--background)" stroke="var(--primary)" strokeWidth="1.8" />
			<circle cx="18" cy="17" r="2.9" fill="var(--background)" stroke="var(--primary)" strokeWidth="1.8" />
		</svg>
	);
}
