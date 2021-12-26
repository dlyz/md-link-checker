import * as vscode from 'vscode';
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
	): Promise<MarkdownParsingResult>;
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

	async parseDocument(
		document: vscode.TextDocument | string,
		options: { parseLinks?: boolean, parseHeadings?: boolean }
	): Promise<MarkdownParsingResult> {
		const grammar = await this.grammars.loadGrammar(markdownScopeName);
		if (!grammar) {
			throw new Error(`Can not load grammar for markdown scope '${markdownScopeName}'`);
		}

		const doc = makeSlimDocument(document);

		const headings: MarkdownHeading[] | undefined = options.parseHeadings ? [] : undefined;
		const links: MarkdownLink[] | undefined = options.parseLinks ? [] : undefined;


		const result: MarkdownParsingResult = { links: [], headings: [] };

		let stack = null;
		for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
			const line = doc.lineAt(lineIndex);
			const r = grammar.tokenizeLine(line, stack);
			stack = r.ruleStack;

			for (const token of r.tokens) {
				if (headings && token.scopes.includes("entity.name.section.markdown")) {
					const title = line.substring(token.startIndex, token.endIndex);
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

// external libs tokenizer examples
// measure("marked", () => {
// 	const tokens = lexer.lex(this.document.getText());
// 	let cnt = 0;

// 	function traverse(tokens: any[]) {
// 		for (const token of tokens) {
// 			++cnt;
// 			if ((token as any).tokens) {
// 				traverse(token.tokens);
// 			}
// 		}
// 	}

// 	traverse(tokens);

// 	console.log(tokens);
// });


// createMdEngine() {

// 	const md = MarkdownIt({ html: true });

// 	md.linkify.set({ fuzzyLink: false, });

// 	// Extract rules from front matter plugin and apply at a lower precedence
// 	let frontMatterRule: any;
// 	(frontMatterPlugin as any)({
// 		block: {
// 			ruler: {
// 				before: (_id: any, _id2: any, rule: any) => { frontMatterRule = rule; }
// 			}
// 		}
// 	}, () => { /* noop */ });

// 	md.block.ruler.before('fence', 'front_matter', frontMatterRule, {
// 		alt: ['paragraph', 'reference', 'blockquote', 'list']
// 	});

// 	return md;
// }

// measure("markdown-it", () => {
// 	const tokens = this.env.md.parse(this.document.getText(), {});
// 	let cnt = 0;

// 	function traverse(tokens: any[]) {
// 		for (const token of tokens) {
// 			++cnt;
// 			if ((token as any).children) {
// 				traverse(token.children);
// 			}
// 		}
// 	}

// 	traverse(tokens);
// 	//console.debug(tokens);
// });



