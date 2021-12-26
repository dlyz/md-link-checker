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

export class DocumentState {
    constructor(
        public readonly document: vscode.TextDocument,
        private readonly env: Environment
    ) {

    }


    async processDocument() {

        // console.debug("processing: " + this.document.uri.toString());

        const diag: vscode.Diagnostic[] = [];

        const addDiagnostic = (link: MarkdownLink, message: string, severity: vscode.DiagnosticSeverity) => {
            diag.push(new vscode.Diagnostic(link.range, message, severity));
        };

        const document = this.document;
        const { links, headings } = await //measurePerfAsync("parsing", () =>
            this.env.parser.parseDocument(this.document, { parseLinks: true, parseHeadings: true })
        ;//);

        const doc: LinkSourceDocument = {
            uri: this.document.uri,
            get workspaceFolder() { return getWorkspaceFolder(document); },
            hasSluggedHeading: (heading: Slug) => !!headings && headings?.some(h => h.slugged.equals(heading)),
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
            } else {
                addDiagnostic(link, `Link check failed.\nLink: ${uriStr}`, vscode.DiagnosticSeverity.Error);
            }

            if (result.countryCode) {
                addDiagnostic(link, `Link contains a language reference: ${result.countryCode}`, vscode.DiagnosticSeverity.Warning);
            }
        };

        await Promise.all(links!.map(processLink));

        this.env.diagnostics.set(this.document.uri, diag);
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
