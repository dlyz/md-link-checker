import * as vscode from 'vscode';
import { Environment } from './Environment';
import { MarkdownLink } from './MarkdownParser';
import { performance } from 'perf_hooks';
import { LinkSourceDocument } from './LinkChecker';
import { Slug } from './slugify';


function getWorkspaceFolder(document: vscode.TextDocument) {
	return vscode.workspace.getWorkspaceFolder(document.uri)?.uri
		|| vscode.workspace.workspaceFolders?.[0]?.uri;
}


interface LinkCacheEntry {
    checkerState: any,
    lastVisitDocVersion: number,
}

export class DocumentState {
    constructor(
        public readonly document: vscode.TextDocument,
        private readonly env: Environment
    ) {
    }

    private readonly linkCache = new Map<any, LinkCacheEntry>();
    private resetCaches: boolean = false;

    private lastProcessing = Promise.resolve();
    private lastProcessedVersion = -1;

    processDocument(resetCaches: boolean = false) {
        // have to maintain state instead of using function arguments
        // to efficiently handle the case of multiple scheduled processings
        this.resetCaches ||= resetCaches;
        this.lastProcessing = continueWith(this.lastProcessing, this.processDocumentSeq.bind(this));
    }

    private async processDocumentSeq() {

        const force = this.resetCaches;
        if (this.resetCaches) {
            this.linkCache.clear();
            this.resetCaches = false;
        }

        const document = this.document;
        // this is the version of parsed content. this is important
        const documentVersion = document.version;

        if (!force && documentVersion === this.lastProcessedVersion) {
            return;
        }

        // console.debug("processing: " + this.document.uri.toString());

        const diag: vscode.Diagnostic[] = [];

        const addDiagnostic = (link: MarkdownLink, message: string, severity: vscode.DiagnosticSeverity) => {
            diag.push(new vscode.Diagnostic(link.range, message, severity));
        };

        const { links, headings } = //measurePerf("parsing", () =>
            this.env.parser.parseDocument(this.document, { parseLinks: true, parseHeadings: true })
        ;//);

        const doc: LinkSourceDocument = {
            uri: this.document.uri,
            get workspaceFolder() { return getWorkspaceFolder(document); },
            hasSluggedHeading: (heading: Slug) => !!headings && headings?.some(h => h.slugged.equals(heading)),
            getCachedLink: (key) => {
                const entry = this.linkCache.get(key);
                if (entry) {
                    entry.lastVisitDocVersion = documentVersion;
                    return entry.checkerState;
                } else {
                    return undefined;
                }
            },
            setCachedLink: (key, value) => this.linkCache.set(key, { checkerState: value, lastVisitDocVersion: documentVersion }),
        };


        const processLink = async (link: MarkdownLink) => {
            const result = await this.env.linkChecker.checkLink(doc, link.address);

            const uriStr = result.uri?.scheme === "file" ? result.uri.fsPath : result.uri?.toString();

            if (result.checkFail) {
                addDiagnostic(link, `Link ${uriStr} check failed with exception: ${result.checkFail}`, vscode.DiagnosticSeverity.Warning);
                return;
            }

            if (result.checkType === "none") {
                 addDiagnostic(link, `Can not check this type of link. Scheme: ${result.uri?.scheme || "not parsed"}`, vscode.DiagnosticSeverity.Information);
                 return;
            }


            if (result.pathFound) {
                if (result.hasFragment && !result.fragmentFound) {
                    addDiagnostic(link, `Document found, but fragment '#${result.uri?.fragment}' check failed.\nLink: ${uriStr}`, vscode.DiagnosticSeverity.Error);
                } else {
                    // addDiagnostic(link, `Link check passed.\nLink: ${uriStr}`, vscode.DiagnosticSeverity.Hint);
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
                        + `\nLink: ${uriStr}\n${result.requestError}`, vscode.DiagnosticSeverity.Warning);
                } else {
                    addDiagnostic(link, `Link check failed.\nLink: ${uriStr}\n${result.requestError}`, vscode.DiagnosticSeverity.Error);
                }
            } else {
                addDiagnostic(link, `Link check failed. Status: ${result.statusCode}\nLink: ${uriStr}`, vscode.DiagnosticSeverity.Error);
            }

            if (result.countryCode) {
                addDiagnostic(link, `Link contains a language reference: ${result.countryCode}`, vscode.DiagnosticSeverity.Warning);
            }
        };

        await Promise.all(links!.map(processLink));

        // removing all the links from cache that are not presented
        // in the actual version of document
        // this helps to force link recheck
        for (const kv of this.linkCache) {
            if (kv[1].lastVisitDocVersion !== documentVersion) {
                this.linkCache.delete(kv[0]);
            }
        }

        this.lastProcessedVersion = documentVersion;
        this.env.diagnostics.set(this.document.uri, diag);

        // console.debug("processing completed: " + this.document.uri.toString());
    }



    processChanges(event: vscode.TextDocumentChangeEvent) {
        this.processDocument();
    }

    dispose() {
        this.env.diagnostics.delete(this.document.uri);
    }
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
