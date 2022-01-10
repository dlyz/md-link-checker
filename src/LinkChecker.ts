import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownParser } from './MarkdownParser';
import { Slug, Slugifier } from './slugify';
import { performance } from 'perf_hooks';
import { URL } from 'url';
import { HostCredentialsStorage } from './HostCredentialsStorage';
import fetch, { Response } from 'node-fetch';

export interface LinkCheckResult {
	checkType: "web" | "file" | "none",
	statusCode: number,
	uri: vscode.Uri | undefined,
	pathFound: boolean,
	fragmentFound: boolean,
	hasFragment: boolean | null,
	countryCode?: string,
	linkedDocument?: ParsedLinkedDocument,
	requestError?: any,
}

export interface LinkChecker {
	checkLink(document: LinkSourceDocument, link: string): Promise<LinkCheckResult>;
}

export interface LinkCheckerOptions {
	countryCodeRegex?: string,
}


export interface ParsedLinkedDocument {
	uri: vscode.Uri,
	documentVersion: number,
	hasSluggedHeading(heading: Slug): boolean,
}

export interface LinkSourceDocument {
	uri: vscode.Uri,
	workspaceFolder: vscode.Uri | undefined,
	tryGetParsedDocument(uri: vscode.Uri): ParsedLinkedDocument | undefined,

}


export interface LinkSourceDocumentCache {
	findDocument(uri: vscode.Uri): LinkSourceDocument | undefined,
}



export class MainLinkChecker implements LinkChecker {

	private readonly urlChecker;

	constructor(
		private readonly optionsProvider: () => LinkCheckerOptions,
		private readonly slugifier: Slugifier,
		private readonly markdownParser: MarkdownParser,
		private readonly hostCredentials: HostCredentialsStorage
	) {
		this.urlChecker = new NodeFetchUrlChecker();
	}

	checkLink(document: LinkSourceDocument, link: string): Promise<LinkCheckResult> {
		const options = this.optionsProvider();

		let uri;
		try {
			uri = parseLink(document, link);
		} catch (e) {
			return Promise.reject(e);
		}

		if (uri) {
			if (uri.scheme === "http" || uri.scheme === "https") {
				return this.checkWebLink(link, uri, options);

			} else if (uri.scheme === "file" || uri.scheme === "untitled") {
				return this.checkFileLink(document, uri, options);
			}
		}

		return Promise.resolve({
			checkType: "none",
			uri,
			pathFound: false,
			hasFragment: null,
			fragmentFound: false,
			statusCode: 0,
		});
	};



	private async checkWebLink(
		link: string,
		uri: vscode.Uri,
		options: LinkCheckerOptions
	): Promise<LinkCheckResult> {

		const parsedUrl = new URL(link);
		let authString = await this.hostCredentials.tryGet(parsedUrl.host);

		let checkResult = await this.urlChecker.checkUrl(link, authString || undefined);

		if (authString !== null && checkResult.statusCode === 401) {
			const authString = await this.hostCredentials.requestNew(parsedUrl.host);

			if (authString) {
				checkResult = await this.urlChecker.checkUrl(link, authString);
			}
		}

		const countryCode = hasCountryCode(link, options.countryCodeRegex);

		return {
			checkType: "web",
			uri,
			pathFound: checkResult.alive,
			hasFragment: null,
			fragmentFound: false,
			countryCode,
			statusCode: checkResult.statusCode,
			requestError: checkResult.err,
		};
	}

	private async checkFileLink(
		document: LinkSourceDocument,
		uri: vscode.Uri,
		options: LinkCheckerOptions
	): Promise<LinkCheckResult> {
		const hasFragment = uri.fragment.length !== 0;

		let pathFound;
		let fragmentFound = false;
		let requestError;

		const linkedDocUri = uri.with({ fragment: '' });
		const linkedDocument = document.tryGetParsedDocument(linkedDocUri);

		if (linkedDocument) {
			pathFound = true;
			if (hasFragment) {
				fragmentFound = linkedDocument.hasSluggedHeading(this.slugifier.fromFragment(uri.fragment));
			}
		} else {
			if (hasFragment) {
				let content;
				[content, requestError] = await readFile(uri.fsPath);

				if (content !== undefined) {
					pathFound = true;
					const { headings } = await this.markdownParser.parseDocument(content, { parseHeadings: true });
					const sluggedFragment = this.slugifier.fromFragment(uri.fragment);
					fragmentFound = !!headings && headings.some(h => h.slugged.equals(sluggedFragment));
				} else {
					pathFound = false;
				}

			} else {
				[pathFound, requestError] = await fileExists(uri.fsPath);
			}
		}
		return {
			checkType: "file",
			uri,
			pathFound,
			hasFragment,
			fragmentFound,
			statusCode: pathFound ? 200 : 404,
			requestError,
			linkedDocument,
		};
	}
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

		let documentUri = document.uri;
		if (documentUri.scheme === "vscode-bulkeditpreview") {
			documentUri = vscode.Uri.parse(documentUri.query);
		}

		if (documentUri.scheme === "untitled") {
			const root = document.workspaceFolder;
			if (root) {
				resourceUri = vscode.Uri.joinPath(root, tempUri.path);
			}
		} else {
			const base = documentUri.with({ path: path.dirname(documentUri.fsPath) });
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
	alive: boolean,
	statusCode: number,
}



class NodeFetchUrlChecker {

	async checkUrl(url: string, authorization?: string): Promise<UrlCheckResult> {

		let headers;

		if (authorization) {
			headers = {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				"Authorization": authorization,
			};
		}

		let response;

		try
		{
			response = await fetch(url, {
				method: "HEAD",
				headers,
			});
		} catch (err) {
			return createError(err);
		}

		if (shouldTryGetInsteadOfHead(response)) {
			try
			{
				response = await fetch(url, {
					method: "GET",
					headers
				});
			} catch (err) {
				return createError(err);
			}
		}

		return createResult(response);

		function isOk(response: Response) {
			return response.status >= 200 && response.status < 300;
		}

		function shouldTryGetInsteadOfHead(response: Response) {
			return response.status >= 400 && response.status < 500;
		}

		function createResult(response: Response): UrlCheckResult {
			return {
				statusCode: response.status,
				alive: isOk(response),
				err: undefined
			};
		}

		function createError(err: any): UrlCheckResult {

			return {
				statusCode: 0,
				alive: false,
				err
			};
		}
	}
}


function fileExists(filePath: string) {
	return new Promise<[boolean, any]>((resolve, reject) => {
		fs.access(filePath, err => {
			resolve([!err, err]);
		});
	});
}

function readFile(filePath: string) {
	return new Promise<[string | undefined, any]>((resolve, reject) => {
		fs.readFile(filePath, "utf8", (err, data) => {
			resolve([err ? undefined : data, err]);
		});
	});
}

function hasCountryCode(linkToCheck: string, regex: string | undefined): string | undefined {

	if (!regex) return undefined;

	const hasCountryCode = linkToCheck.match(regex);
	return hasCountryCode?.[0];
}

