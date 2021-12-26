import { GrammarDescriptor } from "./GrammarProvider";
import * as path from 'path';


export const markdownLanguage = "markdown";
export const markdownScopeName = "text.html.markdown";
export const markdownExtensionId = "vscode.markdown";

export function getEmbeddedGrammarDescriptor(): GrammarDescriptor {
	return {
		path: path.join(__dirname, "../assets/markdown.textmate.json"),
		scopeName: markdownScopeName,
		language: markdownLanguage,
	};
}