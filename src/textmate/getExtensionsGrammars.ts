import * as vscode from 'vscode';
import * as path from 'path';

export interface ExtensionGrammar {
	extensionId: string,
	path: string,
	scopeName: string,
	language: string,
}


interface ExtensionPackageGrammar {
	language?: string;
	scopeName?: string;
	path?: string;
	embeddedLanguages?: { [scopeName: string]: string };
	injectTo?: string[];
}

interface ExtensionPackage {
	contributes?: {
		languages?: { id: string; configuration: string }[];
		grammars?: ExtensionPackageGrammar[];
	};
}

export function getExtensionsGrammars(filter: { extensionId?: string; language?: string; scopeName?: string; }) {

	let extensions;

	if (filter.extensionId) {
		const ext = vscode.extensions.getExtension(filter.extensionId);
		if (!ext) return [];
		extensions = [ext];
	} else {
		extensions = vscode.extensions.all;
	}

	return extensions.flatMap(ext => {

		const packageJson = ext.packageJSON as (ExtensionPackage | undefined);

		const result = packageJson?.contributes?.grammars
			?.filter(g =>
				g.language
				&& g.path
				&& g.scopeName
				&& (!filter.language || filter.language === g.language)
				&& (!filter.scopeName || filter.scopeName === g.scopeName)
			)
			.map(g => (<ExtensionGrammar>{
				...g,
				extensionId: ext.id,
				path: path.join(ext.extensionPath, g.path!)
			}));

		return result || [];

	});
}
