import * as vscode from 'vscode';
import { IGrammar } from 'vscode-textmate';
import { Slugifier, Slug } from './slugify';
import { GrammarProvider } from './textmate/GrammarProvider';
import { getEmbeddedGrammarDescriptor, markdownScopeName } from './textmate/MarkdownGrammar';

export interface MarkdownLink {
	range: vscode.Range,
	address: string,
}

export interface MarkdownHeading {
	title: string,
	slugged: Slug,
}

export interface MarkdownParsingResult {
	links?: MarkdownLink[],
	headings?: MarkdownHeading[],
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

export interface MarkdownParser {
	parseDocument(
		document: vscode.TextDocument | string,
		options: { parseLinks?: boolean, parseHeadings?: boolean }
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
		options: { parseLinks?: boolean, parseHeadings?: boolean }
	): MarkdownParsingResult {

		const grammar = this.grammar!;
		const doc = makeSlimDocument(document);

		const headings: MarkdownHeading[] | undefined = options.parseHeadings ? [] : undefined;
		const links: MarkdownLink[] | undefined = options.parseLinks ? [] : undefined;

		let stack = null;
		for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
			const line = doc.lineAt(lineIndex);
			const r = grammar.tokenizeLine(line, stack);
			stack = r.ruleStack;

			for (let i = 0; i < r.tokens.length; ++i) {
				const token = r.tokens[i];
				if (headings && token.scopes.includes("entity.name.section.markdown")) {

					const start = token.startIndex;

					// have to check consequent tokens in case of complex headings like "# q `w` e"
					for(++i; i < r.tokens.length && r.tokens[i].scopes.includes("entity.name.section.markdown"); ++i);
					--i;

					const end = r.tokens[i].endIndex;

					const title = line.substring(start, end);
					headings.push({
						title,
						slugged: this.slugifier.fromHeading(title),
					});
				}

				if (links && (token.scopes.includes("markup.underline.link.markdown") || token.scopes.includes("markup.underline.link.image.markdown"))) {
					const address = line.substring(token.startIndex, token.endIndex);
					links.push({
						address,
						range: new vscode.Range(
							new vscode.Position(lineIndex, token.startIndex),
							new vscode.Position(lineIndex, token.endIndex),
						),
					});
				}

			}

			//console.debug((index + 1) + ": ", r.tokens.map(t => t.scopes.join(" ")));
		}

		return { links, headings };
	}

}
