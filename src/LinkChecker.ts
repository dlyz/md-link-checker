import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownParser } from './MarkdownParser';
import { Slug, Slugifier } from './slugify';

// For checking broken links
const brokenLink = require('broken-link');

export interface LinkCheckResult {
	checkType: "web" | "file" | "none",
	uri: vscode.Uri | undefined,
	pathFound: boolean,
	fragmentFound: boolean,
	hasFragment: boolean | null,
	countryCode?: string,
	checkFail?: any,
}

export interface LinkChecker {
	checkLink(document: LinkSourceDocument, link: string): Promise<LinkCheckResult>;
}

export interface LinkCheckerOptions {
	countryCodeRegex?: string,
}

export interface LinkSourceDocument {
	uri: vscode.Uri,
	workspaceFolder: vscode.Uri | undefined,
	hasSluggedHeading(heading: Slug): boolean
}


export interface LinkSourceDocumentCache {
	findDocument(uri: vscode.Uri): LinkSourceDocument | undefined,
}



export class MainLinkChecker implements LinkChecker {

	constructor(
		private readonly optionsProvider: () => LinkCheckerOptions,
		private readonly slugifier: Slugifier,
		private readonly markdownParser: MarkdownParser
		) {

	}

	async checkLink(document: LinkSourceDocument, link: string): Promise<LinkCheckResult> {

		const options = this.optionsProvider();
		const uri = parseLink(document, link);

		if (uri) {

			if (uri.scheme === "http" || uri.scheme === "https") {

				const isBroken: boolean = await isHttpLinkBroken(link);

				const cc = hasCountryCode(link, options.countryCodeRegex);

				return {
					checkType: "web",
					uri,
					pathFound: !isBroken,
					hasFragment: null,
					fragmentFound: false,
					countryCode: cc,
				};

			} else if (uri.scheme === "file" || uri.scheme === "untitled") {

				const hasFragment = uri.fragment.length !== 0;

				let pathFound;
				let fragmentFound = false;
				if (uri.with({ fragment: '' }).toString() === document.uri.toString()) {
					pathFound = true;
					if (hasFragment) {
						fragmentFound = document.hasSluggedHeading(this.slugifier.fromFragment(uri.fragment));
					}
				} else {
					if (hasFragment) {
						const content = await readFile(uri.fsPath);

						if (content !== undefined) {
							pathFound = true;
							const { headings } = await this.markdownParser.parseDocument(content, { parseHeadings: true });
							const sluggedFragment = this.slugifier.fromFragment(uri.fragment);
							fragmentFound = !!headings && headings.some(h => h.slugged.equals(sluggedFragment));
						} else {
							pathFound = false;
						}

					} else {
						pathFound = await fileExists(uri.fsPath);
					}
				}
				return {
					checkType: "file",
					uri,
					pathFound,
					hasFragment,
					fragmentFound
				};

			}
		}

		return {
			checkType: "none",
			uri,
			pathFound: false,
			hasFragment: null,
			fragmentFound: false
		};
	};


}


const angleBracketLinkRe = /^<(.*)>$/;

// https://github.dev/microsoft/vscode/blob/f586b32587de915ec4a089098b897d052da0d1eb/extensions/markdown-language-features/src/features/documentLinkProvider.ts#L14
function parseLink(
	document: LinkSourceDocument,
	link: string,
): vscode.Uri | undefined {

	// Used to strip brackets from the markdown link
	//<http://example.com> will be transformed to http://example.com
	const cleanLink = link.replace(angleBracketLinkRe, '$1');

	const externalSchemeUri = vscode.Uri.parse(cleanLink);
	if (externalSchemeUri && (externalSchemeUri.scheme !== "file" || link.toLowerCase().startsWith("file"))) {
		return externalSchemeUri;
	}

	// Assume it must be an relative or absolute file path
	// Use a fake scheme to avoid parse warnings
	const tempUri = vscode.Uri.parse(`vscode-resource:${link}`);

	let resourceUri: vscode.Uri | undefined;
	if (!tempUri.path) {
		resourceUri = document.uri;
	} else if (tempUri.path[0] === '/') {
		const root = document.workspaceFolder;
		if (root) {
			resourceUri = vscode.Uri.joinPath(root, tempUri.path);
		}
	} else {
		if (document.uri.scheme === "untitled") {
			const root = document.workspaceFolder;
			if (root) {
				resourceUri = vscode.Uri.joinPath(root, tempUri.path);
			}
		} else {
			const base = document.uri.with({ path: path.dirname(document.uri.fsPath) });
			resourceUri = vscode.Uri.joinPath(base, tempUri.path);
		}
	}

	if (!resourceUri) {
		return undefined;
	}

	resourceUri = resourceUri.with({ fragment: tempUri.fragment });

	return resourceUri;
}


export function isHttpLinkBroken(address: string) {
	return brokenLink(address, { allowRedirects: true });
}

export function fileExists(filePath: string) {
	return new Promise<boolean>((resolve, reject) => {
		fs.access(filePath, err => {
			resolve(!err);
		});
	});
}

export function readFile(filePath: string) {
	return new Promise<string | undefined>((resolve, reject) => {
		fs.readFile(filePath, "utf8", (err, data) => {
			resolve(err ? undefined : data);
		});
	});
}

export function hasCountryCode(linkToCheck: string, regex: string | undefined): string | undefined {

	if (!regex) return undefined;

	const hasCountryCode = linkToCheck.match(regex);
	return hasCountryCode?.[0];
}



