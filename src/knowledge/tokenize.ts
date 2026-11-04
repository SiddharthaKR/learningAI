export function tokenize(text: string): string[] {
	const normalized = text.normalize("NFKC").toLowerCase();
	const tokens: string[] = normalized.match(/[\p{Script=Latin}\p{Decimal_Number}]+/gu) ?? [];
	const cjk = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
	if (cjk.length === 1) tokens.push(cjk[0]!);
	for (let index = 0; index < cjk.length - 1; index++) {
		tokens.push(cjk[index]! + cjk[index + 1]!);
	}
	return tokens;
}
