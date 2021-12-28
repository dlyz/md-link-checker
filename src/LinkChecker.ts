import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownParser } from './MarkdownParser';
import { Slug, Slugifier } from './slugify';
import { performance } from 'perf_hooks';
const linkCheck = require('link-check');
// import fetch from 'node-fetch';


export interface LinkCheckResult {
	checkType: "web" | "file" | "none",
	statusCode: number,
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

	/** Number of seconds to consider cached check result valid */
	cacheTtl?: number,
}

export interface LinkSourceDocument {
	uri: vscode.Uri,
	workspaceFolder: vscode.Uri | undefined,
	hasSluggedHeading(heading: Slug): boolean,
	setCachedLink(key: any, value: any): void,
	getCachedLink(key: any): any,
}


export interface LinkSourceDocumentCache {
	findDocument(uri: vscode.Uri): LinkSourceDocument | undefined,
}


export class MainLinkChecker implements LinkChecker {

	// private readonly urlChecker = new NodeFetchUrlChecker();
	private readonly urlChecker = new LinkCheckUrlChecker();

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

				let checkResult;
				try {
					checkResult = await this.checkWebLink(document, link, options);
				} catch (checkFail) {
					return {
						checkFail,
						checkType: "web",
						uri,
						pathFound: false,
						hasFragment: null,
						fragmentFound: false,
						statusCode: 0,
					};
				}

				const pathFound = checkResult.status === "alive";

				const cc = hasCountryCode(link, options.countryCodeRegex);

				return {
					checkType: "web",
					uri,
					pathFound,
					hasFragment: null,
					fragmentFound: false,
					countryCode: cc,
					statusCode: checkResult.statusCode,
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
					fragmentFound,
					statusCode: pathFound ? 200 : 404,
				};

			}
		}

		return {
			checkType: "none",
			uri,
			pathFound: false,
			hasFragment: null,
			fragmentFound: false,
			statusCode: 0,
		};
	};

	checkWebLink(document: LinkSourceDocument, link: string, options: LinkCheckerOptions) {

		let cacheEntry = document.getCachedLink(link) as LinkCacheEntry | undefined;
		if (cacheEntry && cacheEntry.lastCheckTime !== -2) {

			// if still running
			if (cacheEntry.lastCheckTime === -1) {
				return cacheEntry.resultPromise;
			}

			const now = performance.now();
			const ttl = (options.cacheTtl ?? 5*60)*1000;
			if (now - cacheEntry.lastCheckTime <= ttl) {
				return cacheEntry.resultPromise;
			}
		}

		cacheEntry = {
			resultPromise: null!,
			lastCheckTime: -1,
		};

		cacheEntry.resultPromise = this.urlChecker.checkUrl(link).then(
			result => {
				cacheEntry!.lastCheckTime = performance.now();
				return result;
			},
			error => {
				cacheEntry!.lastCheckTime = -2;
				throw error;
			}
		);

		document.setCachedLink(link, cacheEntry);
		return cacheEntry.resultPromise;
	}

}

interface LinkCacheEntry {
	resultPromise: Promise<UrlCheckResult>,
	// -1: in progress, -2: promise failed
	lastCheckTime: number,
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


interface UrlCheckResult {

	err: any,
	statusCode: number,
	status: "alive" | "ignored" | "dead",
}

class LinkCheckUrlChecker {

	checkUrl(url: string): Promise<UrlCheckResult> {

		return new Promise((resolve, reject) => {

			linkCheck(url, (err: any, result: any) => {
				if (err) {
					reject(err);
				} else {
					resolve(result);
				}
			});
		});
	}
}

// incomplete implementation, may be used later
// class NodeFetchUrlChecker {

// 	async checkUrl(url: string): Promise<UrlCheckResult> {

// 		const resposne = await fetch(url, {
// 			method: "GET",
// 		});

// 		return {
// 			lastCheckTime: 0,
// 			statusCode: resposne.status,
// 			status: resposne.status >= 200 && resposne.status < 300 ? "alive" : "dead",
// 			err: undefined
// 		};
// 	}
// }


function fileExists(filePath: string) {
	return new Promise<boolean>((resolve, reject) => {
		fs.access(filePath, err => {
			resolve(!err);
		});
	});
}

function readFile(filePath: string) {
	return new Promise<string | undefined>((resolve, reject) => {
		fs.readFile(filePath, "utf8", (err, data) => {
			resolve(err ? undefined : data);
		});
	});
}

function hasCountryCode(linkToCheck: string, regex: string | undefined): string | undefined {

	if (!regex) return undefined;

	const hasCountryCode = linkToCheck.match(regex);
	return hasCountryCode?.[0];
}



