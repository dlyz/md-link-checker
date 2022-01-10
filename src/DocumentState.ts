import * as vscode from 'vscode';
import { Environment } from './Environment';
import { MarkdownHeading, MarkdownLink, MarkdownLinkDef, MarkdownLinkRef, MarkdownParsingResult } from './MarkdownParser';
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
        return this.parseDocumentCore();
    }

    private parsed?: ParsedDocument;

    private parseDocumentCore(): ParsedDocument {

        const documentVersion = this.document.version;
        const prevParsed = this.parsed;
        if (prevParsed && prevParsed.documentVersion === documentVersion) {
            return prevParsed;
        } else {
            // parsing should be synced with documentVersion
            const parsingResult = this.env.parser.parseDocument(
                this.document,
                {
                    parseLinks: true,
                    parseHeadings: true,
                    parseLinkDefs: true,
                    parseLinkRefs: true,
                }
            );

            const parsed = this.parsed = new ParsedDocument(
                this.document.uri,
                documentVersion,
                parsingResult.headings!,
                parsingResult.links!,
                parsingResult.linkRefs!,
                parsingResult.linkDefs!,
                parsingResult.lastNonEmptyLine,
                parsingResult.endsWithLinkDef,
            );

            if (sluggedHeadersChanged(prevParsed, parsed)) {
                this.eventSource.onDocumentChanged(documentVersion);
            }

            return parsed;
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

    private lastProcessedDocument?: ParsedDocument;

    private async processDocumentSeq() {

        if (this.resetCaches) {
            this.disposeLinkCache();
            this.parsed = undefined;
            this.lastProcessedDocument = undefined;
            this.resetCaches = false;
            this.resetLastProcessed = false;
        } else if (this.resetLastProcessed) {
            this.lastProcessedDocument = undefined;
            this.resetLastProcessed = false;
        }

        if (this.document.version === this.lastProcessedDocument?.documentVersion) {
            return;
        }

        // console.debug("processing: " + this.document.uri.toString());

        const parsed = this.parseDocumentCore();

        if (sluggedHeadersChanged(this.lastProcessedDocument, parsed)) {
            // we do not subscribe to self heading changes (unlike for other docs),
            // so we have to manually remove local links from the cache
            // to recheck them
            for (const kv of this.linkCache) {
                if (kv[1].localLink) {
                    this.linkCache.delete(kv[0]);
                }
            }
        }

        const diag: vscode.Diagnostic[] = [];

        this.checkLinkRefs(diag, parsed);

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

        this.gatherDiagnostics(diag, parsed.links, results);

        this.env.diagnostics.set(this.document.uri, diag);

        this.lastProcessedDocument = parsed;

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
				console.error(`link check failed. doc: ${this.document.uri} link: ${link}`, error);
				return undefined;
			}
		);

		this.linkCache.set(link, cacheEntry);
		return cacheEntry.resultPromise;
	}


    private gatherDiagnostics(diag: vscode.Diagnostic[], links: MarkdownLink[], results: Array<LinkCheckResult | undefined>) {

        for (let index = 0; index < links.length; index++) {
            const res = results[index];
            if (res) {
                gather(links[index], res);
            }
        }

        return diag;

        function addDiagnostic(link: MarkdownLink, message: string, severity: vscode.DiagnosticSeverity) {
            diag.push(new vscode.Diagnostic(link.addressRange, message, severity));
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

    private checkLinkRefs(diag: vscode.Diagnostic[], parsedDoc: ParsedDocument) {

        const addDiagnostic = (range: vscode.Range, message: string, linkedRange?: vscode.Range, linkedMessage?: string, severity = vscode.DiagnosticSeverity.Error) => {
            const d = new vscode.Diagnostic(range, message, severity);
            if (linkedRange && linkedMessage) {
                d.relatedInformation = [
                    new vscode.DiagnosticRelatedInformation(new vscode.Location(parsedDoc.uri, linkedRange), linkedMessage)
                ];
            }

            diag.push(d);
        };

        const defSet = new Map<string, MarkdownLinkDef>();
        for (const def of parsedDoc.linkDefs) {
            const prev = defSet.get(def.name);
            if (prev) {
                addDiagnostic(
                    def.nameRange,
                    "Link with this name already defined",
                    prev.nameRange,
                    `First definition of '${def.name}'`
                );
            } else {
                defSet.set(def.name, def);
            }
        }

        for (const ref of parsedDoc.linkRefs) {
            const def = defSet.get(ref.name);
            if (!def) {
                addDiagnostic(
                    ref.nameRange,
                    `Link definition for '${ref.name}' not found.\nIf this is not a link reference, consider bracket escaping '\\[' or using code block.`,
                );
            }
        }

        return diag;
    }


    canRenameLinkRefNameAt(pos: vscode.Position): { range: vscode.Range, placeholder: string} | undefined {
        const parsed = this.parseDocumentCore();
        if (!parsed) return undefined;

        const link = this.getInlineLinkAddressAt(parsed, pos);
        if (link) {
            return { range: link.addressRange, placeholder: 'link-ref-name' };
        }

        const linkRefOrDef = this.getLinkRefNameAt(parsed, pos) ?? this.getLinkDefNameAt(parsed, pos);
        if (linkRefOrDef) {
            return { range: linkRefOrDef.nameRange, placeholder: linkRefOrDef.name };
        }

        return undefined;
    }

    renameLinkRefNameAt(pos: vscode.Position, linkRefName: string): vscode.WorkspaceEdit | undefined {
        const parsed = this.parseDocumentCore();
        if (!parsed) return undefined;

        const docUri = this.document.uri;

        const link = this.getInlineLinkAddressAt(parsed, pos);

        if (link) {

            const edit = new vscode.WorkspaceEdit();

            const replaceRange = new vscode.Range(
                link.addressRange.start.translate(undefined, -1),
                link.addressRange.end.translate(undefined, 1)
            );

            edit.replace(docUri, replaceRange, `[${linkRefName}]`);

            const line = this.document.lineAt(parsed.lastNonEmptyLine === -1
                ? (this.document.lineCount - 1)
                : parsed.lastNonEmptyLine
            );

            const prefix = parsed.endsWithLinkDef ? "" : "\n";

            edit.insert(docUri, line.range.end, `${prefix}\n[${linkRefName}]: ${link.address}`);

            return edit;
        }

        const linkRefOrDef = this.getLinkRefNameAt(parsed, pos) ?? this.getLinkDefNameAt(parsed, pos);
        if (linkRefOrDef) {
            const edit = new vscode.WorkspaceEdit();

            for (const linkRef of parsed.linkRefs) {
                if (linkRef.name === linkRefOrDef.name) {
                    edit.replace(docUri, linkRef.nameRange, linkRefName);
                }
            }

            for (const linkDef of parsed.linkDefs) {
                if (linkDef.name === linkRefOrDef.name) {
                    edit.replace(docUri, linkDef.nameRange, linkRefName);
                }
            }

            return edit;
        }

        return undefined;
    }

    private getLinkRefNameAt(parsed: ParsedDocument, pos: vscode.Position) {

        for (const linkRef of parsed.linkRefs) {
            if (linkRef.nameRange.contains(pos)) {
                return linkRef;
            }
        }

        return undefined;
    }

    private getLinkDefNameAt(parsed: ParsedDocument, pos: vscode.Position) {

        for (const linkDef of parsed.linkDefs) {
            if (linkDef.nameRange.contains(pos)) {
                return linkDef;
            }
        }

        return undefined;
    }

    private getInlineLinkAddressAt(parsed: ParsedDocument, pos: vscode.Position): MarkdownLink | undefined {

        for (const link of parsed.links) {
            if (link.isInline && link.addressRange.contains(pos)) {
                return link;
            }
        }

        return undefined;
    }

}


class ParsedDocument implements ParsedLinkedDocument {
    constructor(
	    public readonly uri: vscode.Uri,
        public readonly documentVersion: number,
        public readonly headings: MarkdownHeading[],
        public readonly links: MarkdownLink[],
        public readonly linkRefs: MarkdownLinkRef[],
        public readonly linkDefs: MarkdownLinkDef[],
        public readonly lastNonEmptyLine: number,
        public readonly endsWithLinkDef: boolean,
    ) {

    }

    hasSluggedHeading(heading: Slug) {
        return this.headings.some(h => h.slugged.equals(heading));
    }
}

function sluggedHeadersChanged(before: ParsedDocument | undefined, after: ParsedDocument | undefined) {
    if (!before || !after) return true;
    if (before === after) return false;

    const sameSluggedHeading = before
        && before.headings.length === after.headings.length
        && before.headings.every((h, i) => h.slugged.equals(after.headings[i].slugged))
    ;

    return !sameSluggedHeading;
}


interface LinkCacheEntry {
	resultPromise: Promise<LinkCheckResult | undefined>,
	// -1: in progress, -2: promise failed
	lastCheckTime: number,
    lastVisitDocVersion: number,
    linkedDocSubscription?: () => void,
    localLink?: true,
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
