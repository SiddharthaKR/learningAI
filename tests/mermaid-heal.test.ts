import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteMermaidLabels } from "../components/mermaid-heal.ts";

describe("quoteMermaidLabels", () => {
	it("quotes the label from the reported privateGit failure", () => {
		const chart = "graph TD\n  P1[Path 1: Terminal/SSH (Active Change)] --> P2[Gate]";
		assert.equal(
			quoteMermaidLabels(chart),
			'graph TD\n  P1["Path 1: Terminal/SSH (Active Change)"] --> P2[Gate]',
		);
	});

	it("leaves safe labels, quoted labels and shape syntax untouched", () => {
		const chart = [
			"flowchart LR",
			'  A[Plain label] --> B["Already: quoted (ok)"]',
			"  C([Stadium]) --> D((Circle)) --> E{{Hex}} --> F[[Sub]]",
			"  G[/Slant/] --> H{Decision}",
		].join("\n");
		assert.equal(quoteMermaidLabels(chart), chart);
	});

	it("quotes round and diamond labels with risky characters", () => {
		assert.equal(
			quoteMermaidLabels("graph TD\n  A(Start: init) --> B{Is x/y > 0?}"),
			'graph TD\n  A("Start: init") --> B{"Is x/y > 0?"}',
		);
	});

	it("escapes inner double quotes", () => {
		assert.equal(quoteMermaidLabels('graph TD\n  A[Say "hi": now]'), 'graph TD\n  A["Say #quot;hi#quot;: now"]');
	});

	it("only touches flowcharts", () => {
		const seq = "sequenceDiagram\n  Alice->>Bob: Hi (there)";
		assert.equal(quoteMermaidLabels(seq), seq);
	});

	it("keeps CRLF line endings", () => {
		assert.equal(quoteMermaidLabels("graph TD\r\n  A[x: y]\r\n"), 'graph TD\r\n  A["x: y"]\r\n');
	});
});
