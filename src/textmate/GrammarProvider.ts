import * as tm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';
import * as path from 'path';
import * as fs from 'fs';
import { getExtensionsGrammars } from './getExtensionsGrammars';


export interface GrammarDescriptor {
	scopeName: string,
	path: string,
	language: string,
	injectTo?: string[]
}

export interface GrammarProviderOptions {
	grammars?: GrammarDescriptor[],
	extensionsFilter?: {
		extensionId?: string,
		scopeName?: string,
		language?: string,
	}
}

export class GrammarProvider {

	private readonly registry: tm.Registry;

	constructor(options: GrammarProviderOptions){

		function getDescriptors(scopeName?: string): GrammarDescriptor[] {

			const result: GrammarDescriptor[] = [];

			if (options.grammars) {
				if (scopeName) {
					result.push(...options.grammars.filter(g => g.scopeName === scopeName));
				} else {
					result.push(...options.grammars);
				}
			}

			if (options.extensionsFilter) {
				if (options.extensionsFilter.scopeName && scopeName && options.extensionsFilter.scopeName !== scopeName) {

				} else {
					const filter = { ...options.extensionsFilter, scopeName };
					result.push(... getExtensionsGrammars(filter));
				}
			}

			return result;
		}

		function getInjections(scopeName: string) {

			const descriptors = getDescriptors();

			return descriptors
				.filter(g => g.scopeName && g.injectTo?.includes(scopeName))
				.map(g => g.scopeName!);
		}

		async function loadGrammar(scopeName: string) {

			const descriptors = getDescriptors(scopeName);

			try {
				if (descriptors.length > 0) {
					const grammar = descriptors[0];
					let content = await fs.promises.readFile(grammar.path, 'utf-8');
					return tm.parseRawGrammar(content, grammar.path);
				}
			} catch (err) {
				console.error(`Unable to load grammar for scope ${scopeName}.`, err);
			}

			return undefined;
		}

		this.registry = new tm.Registry({
			onigLib: loadOnigLib(),
			getInjections,
			loadGrammar
		});
	}

	loadGrammar(scopeName: string): Promise<tm.IGrammar | null> {
		return this.registry.loadGrammar(scopeName);
	}
}

async function loadOnigLib(): Promise<tm.IOnigLib> {

	try {
		const wasmBuf = await fs.promises.readFile(path.join(__dirname, './onig.wasm'));

		await oniguruma.loadWASM(wasmBuf.buffer);

		return {
			createOnigScanner(patterns: any) {
				return new oniguruma.OnigScanner(patterns);
			},
			createOnigString(s: any) {
				return new oniguruma.OnigString(s);
			},
		};
	}
	catch (e) {
		console.log(e);
		return {
			createOnigScanner(patterns: any) {
				return new oniguruma.OnigScanner(patterns);
			},
			createOnigString(s: any) {
				return new oniguruma.OnigString(s);
			},
		};
	}
}

