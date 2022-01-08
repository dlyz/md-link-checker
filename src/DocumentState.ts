import * as vscode from 'vscode';
import { Environment } from './Environment';
import { MarkdownHeading, MarkdownLink } from './MarkdownParser';
import { performance } from 'perf_hooks';
import { LinkCheckResult, LinkSourceDocument, ParsedLinkedDocument } from './LinkChecker';
import { Slug } from './slugify';

export interface DocumentObservable {
    subscribe(startingDocumentVersion: number | undefined, handler: () => void): () => void;
}

export interface DocumentEventSource extends DocumentObservable {
    onDocumentChanged(documentVersion: number | undefined): void;
}


export class DocumentState {
    constructor(
        public readonly document: vscode.TextDocument,
        private readonly env: Environment,
        private readonly eventSource: DocumentEventSource,
        private readonly documentObservableProvider: (uri: vscode.Uri) => DocumentObservable,
        parsedDocumentProvider: (uri: vscode.Uri) => ParsedLinkedDocument | undefined
    ) {

        this.linkSourceDocument = {
            uri: document.uri,
            get workspaceFolder() {
                return getWorkspaceFolder(document);
            },
            tryGetParsedDocument: (uri) => {
                if (uri.toString() === document.uri.toString()) {
                    return this.parsed!;
                } else {
                    return parsedDocumentProvider(uri);
                }
            },
        };

        eventSource.onDocumentChanged(document.version);
    }

    private readonly linkCache = new Map<string, LinkCacheEntry>();
    private readonly linkSourceDocument: LinkSourceDocument;

    dispose() {
        this.env.diagnostics.delete(this.document.uri);
        this.eventSource.onDocumentChanged(undefined);
        this.disposeLinkCache();
    }

    disposeLinkCache() {
        for (const kv of this.linkCache) {
            kv[1].linkedDocSubscription?.();
        }
        this.linkCache.clear();
    }

    parseDocument(): ParsedLinkedDocument {
        return this.parseDocumentCore()[0];
    }

    private parsed?: ParsedDocument;

    private parseDocumentCore(): [ParsedDocument, boolean] {

        const documentVersion = this.document.version;
        const prevParsed = this.parsed;
        if (prevParsed && prevParsed.documentVersion === documentVersion) {
            return [prevParsed, false];
        } else {
            // parsing should be synced with documentVersion
            const parsingResult = this.env.parser.parseDocument(
                this.document,
                { parseLinks: true, parseHeadings: true }
            );

            const parsed = this.parsed = new ParsedDocument(
                this.document.uri,
                documentVersion,
                parsingResult.headings!,
                parsingResult.links!
            );

            const sameSluggedHeading = prevParsed
                && prevParsed.headings.length === parsed.headings.length
                && prevParsed.headings.every((h, i) => h.slugged.equals(parsed.headings[i].slugged))
                ;

            if (!sameSluggedHeading) {
                this.eventSource.onDocumentChanged(documentVersion);
            }

            return [parsed, !sameSluggedHeading];
        }
    }

    private resetCaches: boolean = false;
    private resetLastProcessed: boolean = false;
    private lastProcessing = Promise.resolve();

    processDocument(resetCaches: boolean = false) {
        // have to maintain state instead of using function arguments
        // to efficiently handle the case of multiple scheduled processings
        this.resetCaches ||= resetCaches;
        this.lastProcessing = continueWith(this.lastProcessing, this.processDocumentSeq.bind(this));
    }

    private lastProcessedVersion = -1;

    private async processDocumentSeq() {

        if (this.resetCaches) {
            this.disposeLinkCache();
            this.parsed = undefined;
            this.lastProcessedVersion = -1;
            this.resetCaches = false;
            this.resetLastProcessed = false;
        } else if (this.resetLastProcessed) {
            this.lastProcessedVersion = -1;
            this.resetLastProcessed = false;
        }

        if (this.document.version === this.lastProcessedVersion) {
            return;
        }

        // console.debug("processing: " + this.document.uri.toString());

        const [parsed, sluggedHeadingChanged] = this.parseDocumentCore();

        if (sluggedHeadingChanged) {
            // we do not subscribe to self heading changes (unlike for other docs),
            // so we have to manually remove local links from the cache
            // to recheck them
            for (const kv of this.linkCache) {
                if (kv[1].localLink) {
                    this.linkCache.delete(kv[0]);
                }
            }
        }

        const results = await Promise.all(parsed.links.map(
            l => this.checkLinkWithCache(l.address, parsed)
        ));


        // removing all the links from cache that are not presented
        // in the actual version of document
        // this helps to force link recheck
        for (const kv of this.linkCache) {
            if (kv[1].lastVisitDocVersion !== parsed.documentVersion) {
                this.linkCache.delete(kv[0]);
                kv[1].linkedDocSubscription?.();
            }
        }

        const diag = this.gatherDiagnostics(parsed.links, results);

        this.env.diagnostics.set(this.document.uri, diag);

        this.lastProcessedVersion = parsed.documentVersion;

        // console.debug("processing completed: " + this.document.uri.toString());
    }

	private checkLinkWithCache(link: string, parsedDoc: ParsedDocument) {

		let cacheEntry = this.linkCache.get(link);
		if (cacheEntry && cacheEntry.lastCheckTime !== -2) {

            cacheEntry.lastVisitDocVersion = parsedDoc.documentVersion;

			// if still running: could be only during same processing iteration
			if (cacheEntry.lastCheckTime === -1) {
				return cacheEntry.resultPromise;
			}

			const now = performance.now();
			const ttl = (this.env.configuration.cacheTtl ?? 5*60)*1000;
			if (now - cacheEntry.lastCheckTime <= ttl) {
				return cacheEntry.resultPromise;
			}

            cacheEntry.linkedDocSubscription?.();
		}

		cacheEntry = {
			resultPromise: null!,
			lastCheckTime: -1,
            lastVisitDocVersion: parsedDoc.documentVersion,
		};

		cacheEntry.resultPromise = this.env.linkChecker.checkLink(this.linkSourceDocument, link).then(
			result => {
				cacheEntry!.lastCheckTime = performance.now();

                let version;
                let observable;
                if (result.linkedDocument) {

                    if (result.linkedDocument.uri.toString() !== parsedDoc.uri.toString()) {
                        observable = this.documentObservableProvider(result.linkedDocument.uri);
                        version = result.linkedDocument.documentVersion;
                    } else {
                        cacheEntry!.localLink = true;
                    }

                } else {
                    const scheme = result.uri?.scheme;
                    if (scheme === "file" || scheme === "untitled") {
                        observable = this.documentObservableProvider(result.uri!.with({ fragment: "" }));
                    }
                }

                if (observable) {
                    cacheEntry!.linkedDocSubscription = observable.subscribe(version, () => {

                        const actualCacheEntry = this.linkCache.get(link);
                        if (actualCacheEntry === cacheEntry) {
                            cacheEntry!.linkedDocSubscription!();
                            this.linkCache.delete(link);
                            this.resetLastProcessed = true;
                            setTimeout(() => this.processDocument());
                        }
                    });
                }

				console.log("doc: " + this.document.uri, link, result);
				return result;
			},
			error => {
				cacheEntry!.lastCheckTime = -2;
				console.warn("link check failed. doc: " + this.document.uri, link, error);
				throw error;
			}
		);

		this.linkCache.set(link, cacheEntry);
		return cacheEntry.resultPromise;
	}


    private gatherDiagnostics(links: MarkdownLink[], results: LinkCheckResult[]) {

        const self = this;
        const diag: vscode.Diagnostic[] = [];
        for (let index = 0; index < links.length; index++) {
            gather(links[index], results[index]);
        }

        return diag;

        function addDiagnostic(link: MarkdownLink, message: string, severity: vscode.DiagnosticSeverity) {
            diag.push(new vscode.Diagnostic(link.range, message, severity));
        }

        function gather(link: MarkdownLink, result: LinkCheckResult) {

            const uriStr = result.uri?.scheme === "file" ? result.uri.fsPath : result.uri?.toString();

            if (result.checkType === "none") {

                addDiagnostic(link, `Can not check this type of link. Scheme: ${result.uri?.scheme || "not parsed"}`, vscode.DiagnosticSeverity.Information);

            } else {

                if (result.pathFound) {
                    if (result.hasFragment && !result.fragmentFound) {
                        addDiagnostic(link, `Document found, but fragment '#${result.uri?.fragment}' check failed.\nResolved link: ${uriStr}`, vscode.DiagnosticSeverity.Error);
                    } else {
                        // addDiagnostic(link, `Link check passed.\nResolved link: ${uriStr}`, vscode.DiagnosticSeverity.Hint);
                    }
                } else if (result.statusCode === 0) {
                    //https://github.com/microsoft/vscode/issues/136787
                    if (result.requestError?.code === "CERT_HAS_EXPIRED") {
                        addDiagnostic(
                            link,
                            `Link check failed.`
                            + `\nElectron can not validate the certificate.`
                            + ` It might be related to the bug https://github.com/microsoft/vscode/issues/136787.`
                            + ` Until vscode upgrades to Electron 16, it is recommended to use setting '"http.systemCertificates": false'`
                            + `\nResolved link: ${uriStr}\n${result.requestError}`, vscode.DiagnosticSeverity.Warning);
                    } else {
                        addDiagnostic(link, `Link check failed.\nResolved link: ${uriStr}\n${result.requestError}`, vscode.DiagnosticSeverity.Error);
                    }
                } else {
                    addDiagnostic(link, `Link check failed. Status: ${result.statusCode}\nResolved link: ${uriStr}`, vscode.DiagnosticSeverity.Error);
                }

                if (result.countryCode) {
                    addDiagnostic(link, `Link contains a language reference: ${result.countryCode}`, vscode.DiagnosticSeverity.Warning);
                }

            }
        }

    }
}


class ParsedDocument implements ParsedLinkedDocument {
    constructor(
	    public readonly uri: vscode.Uri,
        public readonly documentVersion: number,
        public readonly headings: MarkdownHeading[],
        public readonly links: MarkdownLink[],
    ) {

    }

    hasSluggedHeading(heading: Slug) {
        return this.headings.some(h => h.slugged.equals(heading));
    }
}

interface LinkCacheEntry {
	resultPromise: Promise<LinkCheckResult>,
	// -1: in progress, -2: promise failed
	lastCheckTime: number,
    lastVisitDocVersion: number,
    linkedDocSubscription?: () => void,
    localLink?: true,
}


interface DocumentDependency {
    lastVisitDocVersion: number,
}

function getWorkspaceFolder(document: vscode.TextDocument) {
	return vscode.workspace.getWorkspaceFolder(document.uri)?.uri
		|| vscode.workspace.workspaceFolders?.[0]?.uri;
}


function measurePerf<T>(name: string, f: () => T) {
    const from = performance.now();
    const result = f();
    const to = performance.now();
    console.log(`pref: ${name}: ${to - from}ms`);
    return result;
}

async function measurePerfAsync<T>(name: string, f: () => Promise<T>) {
    const from = performance.now();
    const result = await f();
    const to = performance.now();
    console.log(`pref: ${name}: ${to - from}ms`);
    return result;
}

function continueWith<T, U>(task: Promise<U>, continuation: () => Promise<T>) {
    return task.then(continuation, continuation);
}
