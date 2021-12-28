import * as vscode from 'vscode';
import { Environment } from './Environment';
import { DocumentState } from './DocumentState';


export function isMarkdown(document: vscode.TextDocument) {
    return document.languageId === "markdown";
}

export class DocumentStore {

    private readonly documents = new Map<vscode.TextDocument, DocumentState>();

    constructor(
        private readonly env: Environment
    ) {
    }

    reprocessAllDocuments = () => {
        for (const state of this.documents.values()) {
            state.processDocument(true);
        }
    };

    processDocument = (document: vscode.TextDocument) => {
        if (!isMarkdown(document))
            return;

        let state = this.documents.get(document);
        if (!state) {
            // console.log("adding doc: " + document.uri.toString());
            state = new DocumentState(document, this.env);
            this.documents.set(document, state);
        }

        state.processDocument();
    };

    removeDocument = (document: vscode.TextDocument) => {
        if (!isMarkdown(document))
            return;

        const state = this.documents.get(document);
        if (state) {
            // console.log("removing doc: " + document.uri.toString());
            this.documents.delete(document);
            state.dispose();
        }
    };

    updateDocument = (event: vscode.TextDocumentChangeEvent) => {
        if (!isMarkdown(event.document))
            return;

        // console.log({ uri: event.document.uri.toString(), cs: event.contentChanges[0]?.text, reason: event.reason });
        let state = this.documents.get(event.document);
        if (!state) {
            // console.log("adding doc: " + event.document.uri.toString());
            state = new DocumentState(event.document, this.env);
            this.documents.set(event.document, state);
            state.processDocument();
        } else {
            state.processChanges(event);
        }
    };

    dispose() {
        for (const state of this.documents.values()) {
            state.dispose();
        }

        this.documents.clear();
    }
}
