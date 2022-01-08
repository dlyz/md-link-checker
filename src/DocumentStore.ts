import * as vscode from 'vscode';
import { Environment } from './Environment';
import { DocumentState, DocumentEventSource } from './DocumentState';
import { ParsedLinkedDocument } from './LinkChecker';


export function isMarkdown(document: vscode.TextDocument) {
    return document.languageId === "markdown";
}

export class DocumentStore {

    private readonly documents = new Map<vscode.TextDocument, DocumentState>();
    private readonly documentSubscriptions = new Map<string, DocumentSubscriptionManager>();

    constructor(
        private readonly env: Environment
    ) {
    }

    reprocessExistingDocuments = () => {
        for (const state of this.documents.values()) {
            state.processDocument(true);
        }
    };

    reprocessDocumentIfExists = (document: vscode.TextDocument) => {
        let state = this.documents.get(document);
        if (state) {
            state.processDocument(true);
        }
    };

    processDocument = (document: vscode.TextDocument) => {
        const state = this.getOrCreateDocumentState(document);
        state?.processDocument();
    };

    ensureDocument = (document: vscode.TextDocument) => {
        const state = this.getOrCreateDocumentState(document);
        return !!state;
    };

    removeDocument = (document: vscode.TextDocument) => {

        const state = this.documents.get(document);
        if (state) {
            console.log("removing doc: " + document.uri.toString());
            this.documents.delete(document);
            state.dispose();
            const subKey = document.uri.toString();
            const sub = this.documentSubscriptions.get(subKey);
            if (sub && sub.empty) {
                this.documentSubscriptions.delete(subKey);
            }
        }
    };


    dispose() {
        for (const state of this.documents.values()) {
            state.dispose();
        }

        this.documents.clear();
        this.documentSubscriptions.clear();
    }

    private getOrCreateDocumentState(document: vscode.TextDocument) {

        if (!isMarkdown(document))
            return undefined;

        let state = this.documents.get(document);
        if (!state) {
            console.log("adding doc: " + document.uri.toString());
            const sub = this.getSubscriptionManager(document.uri);
            state = new DocumentState(
                document,
                this.env,
                sub,
                this.getSubscriptionManager,
                this.tryGetParsedDocument
            );
            this.documents.set(document, state);
        }

        return state;
    }

    private tryGetParsedDocument = (uri: vscode.Uri): ParsedLinkedDocument | undefined => {

        for (const [doc, state] of this.documents) {
            if (doc.uri.toString() === uri.toString()) {
                return state.parseDocument();
            }
        }

        return undefined;
    };

    private getSubscriptionManager = (uri: vscode.Uri) => {
        const key = uri.toString();
        let sub = this.documentSubscriptions.get(key);
        if (!sub) {
            sub = new DocumentSubscriptionManager(key, this.onSubscriptionManagerEmpty);
            this.documentSubscriptions.set(key, sub);
        }

        return sub;
    };

    private onSubscriptionManagerEmpty = (manager: DocumentSubscriptionManager) => {
        if (manager.version) {
            // document holds this
        } else {
            this.documentSubscriptions.delete(manager.key);
        }
    };
}


class DocumentSubscriptionManager implements DocumentEventSource {

    constructor(
        public readonly key: string,
        private readonly emptyHandler: (manager: DocumentSubscriptionManager) => void
        ) {

    }

    version: number | undefined;
    private readonly handlers = new Set<() => void>();

    get empty() { return this.handlers.size === 0; }

    onDocumentChanged(documentVersion: number | undefined) {
        this.version = documentVersion;
        for (const handler of this.handlers) {
            handler();
        }
    }

    subscribe(startingDocumentVersion: number | undefined, handler: () => void): () => void {
        if (this.handlers.has(handler)) {
            throw new Error("handler should be unique");
        }

        this.handlers.add(handler);
        if (this.version !== undefined && (startingDocumentVersion === undefined || startingDocumentVersion < this.version)) {
            setTimeout(handler);
        }

        return () => {
            this.handlers.delete(handler);
            if (this.handlers.size === 0) {
                this.emptyHandler(this);
            }
        };
    }

}

