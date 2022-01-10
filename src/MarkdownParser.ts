import * as vscode from 'vscode';
import { IGrammar, IToken } from 'vscode-textmate';
import { Slugifier, Slug } from './slugify';
import { GrammarProvider } from './textmate/GrammarProvider';
import { getEmbeddedGrammarDescriptor, markdownScopeName } from './textmate/MarkdownGrammar';

export interface MarkdownLink {
	addressRange: vscode.Range,
	address: string,
	isInline: boolean,
}


export interface MarkdownLinkRef {
	nameRange: vscode.Range,
	name: string,
}

export interface MarkdownLinkDef {
	nameRange: vscode.Range,
	name: string,
}

export interface MarkdownHeading {
	title: string,
	slugged: Slug,
}

export interface MarkdownParsingResult {
	links?: MarkdownLink[],
	headings?: MarkdownHeading[],
	linkRefs?: MarkdownLinkRef[],
	linkDefs?: MarkdownLinkDef[],
	lastNonEmptyLine: number,
	endsWithLinkDef: boolean,
}

interface SlimDocument {

	lineCount: number,
	lineAt(index: number): string,
}

function makeSlimDocument(document: vscode.TextDocument | string): SlimDocument {
	if (typeof document === "string") {
		const splitted = document.split('\n');
		return {
			lineCount: splitted.length,
			lineAt: (index) => splitted[index],
		};
	} else {
		return {
			lineCount: document.lineCount,
			lineAt: (index) => document.lineAt(index).text,
		};
	}
}

export interface MarkdownParsingOptions {
	parseHeadings?: boolean,
	parseLinks?: boolean,
	parseLinkRefs?: boolean,
	parseLinkDefs?: boolean,
}

export interface MarkdownParser {
	parseDocument(
		document: vscode.TextDocument | string,
		options: MarkdownParsingOptions
	): MarkdownParsingResult;
}

// consider implementing parser based on basic regexps:
// https://github.dev/microsoft/vscode/blob/f586b32587de915ec4a089098b897d052da0d1eb/extensions/markdown-language-features/src/features/documentLinkProvider.ts#L105

export class GrammarMarkdownParser implements MarkdownParser {

	constructor(
		private readonly slugifier: Slugifier
		) {
	}

	private readonly grammars = new GrammarProvider({
		grammars: [
			getEmbeddedGrammarDescriptor()
		]
	});

	private grammar?: IGrammar;

	async initialize() {
		if (this.grammar) return Promise.resolve();

		const grammar = await this.grammars.loadGrammar(markdownScopeName);
		if (!grammar) {
			throw new Error(`Can not load grammar for markdown scope '${markdownScopeName}'`);
		}

		this.grammar = grammar;
	}

	parseDocument(
		document: vscode.TextDocument | string,
		options: MarkdownParsingOptions
	): MarkdownParsingResult {

		const grammar = this.grammar!;
		const doc = makeSlimDocument(document);

		const result: MarkdownParsingResult = {
			headings: options.parseHeadings ? [] : undefined,
			links: options.parseLinks ? [] : undefined,
			linkRefs: options.parseLinkRefs ? [] : undefined,
			linkDefs: options.parseLinkDefs ? [] : undefined,
			endsWithLinkDef: false,
			lastNonEmptyLine: -1,
		};

		let lastNonEmptyToken;
		let stack = null;
		for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
			const line = doc.lineAt(lineIndex);
			const r = grammar.tokenizeLine(line, stack);
			stack = r.ruleStack;

			for (let i = 0; i < r.tokens.length; ++i) {
				const token = r.tokens[i];
				if (result.headings && isHeadingToken(token)) {

					const start = token.startIndex;

					// have to check consequent tokens in case of complex headings like "# q `w` e"
					for(++i; i < r.tokens.length && isHeadingToken(r.tokens[i]); ++i);
					--i;

					const end = r.tokens[i].endIndex;

					const title = line.substring(start, end);
					result.headings.push({
						title,
						slugged: this.slugifier.fromHeading(title),
					});
				}

				else if (result.links && isLinkAddressToken(token)) {
					const address = line.substring(token.startIndex, token.endIndex);
					result.links.push({
						address,
						addressRange: makeRange(lineIndex, token),
						isInline: isInlineLink(token),
					});
				}

				else if (result.linkRefs && isLinkRefNameToken(token)) {
					const name = line.substring(token.startIndex, token.endIndex);
					result.linkRefs.push({
						name,
						nameRange: makeRange(lineIndex, token),
					});
				}

				else if (result.linkDefs && isLinkDefNameToken(token)) {
					const name = line.substring(token.startIndex, token.endIndex);
					result.linkDefs.push({
						name,
						nameRange: makeRange(lineIndex, token),
					});
				}

				if (!isEmptyToken(token)) {
					result.lastNonEmptyLine = lineIndex;
					lastNonEmptyToken = token;
				}
			}

			//console.debug((index + 1) + ": ", r.tokens.map(t => t.scopes.join(" ")));
		}

		result.endsWithLinkDef = lastNonEmptyToken && isLinkDefToken(lastNonEmptyToken) || false;

		return result;
	}

}

function makeRange(lineIndex: number, token: IToken) {
	return new vscode.Range(
		new vscode.Position(lineIndex, token.startIndex),
		new vscode.Position(lineIndex, token.endIndex),
	);
}

function isHeadingToken(token: IToken) {
	return token.scopes.includes("entity.name.section.markdown");
}

function isLinkAddressToken(token: IToken) {
	return token.scopes.includes("markup.underline.link.markdown")
		|| token.scopes.includes("markup.underline.link.image.markdown")
	;
}

function isInlineLink(token: IToken) {
	return token.scopes.includes("meta.link.inline.markdown");
}


function isLinkRefNameToken(token: IToken) {
	return (
			token.scopes.includes("constant.other.reference.link.markdown")
			&& token.scopes.includes("meta.link.reference.markdown")
		) || (
			token.scopes.includes("meta.link.reference.shortcut.markdown")
			&& token.scopes.includes("string.other.link.title.markdown")
		)
	;
}

function isLinkDefNameToken(token: IToken) {
	return token.scopes.includes("constant.other.reference.link.markdown")
		&& token.scopes.includes("meta.link.reference.def.markdown")
	;
}

function isLinkDefToken(token: IToken) {
	return token.scopes.includes("meta.link.reference.def.markdown");
}

function isEmptyToken(token: IToken) {
	return token.scopes.length <= 1;
}


