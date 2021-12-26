import * as vscode from 'vscode';

import { Environment } from './Environment';
import { DocumentStore } from './DocumentStore';



export function activate(ctx: vscode.ExtensionContext) {

    const diagnostics = vscode.languages.createDiagnosticCollection();
    ctx.subscriptions.push(diagnostics);

    const env = new Environment(
        vscode.workspace.getConfiguration("mdLinkChecker"),
        diagnostics
    );

    const documents = new DocumentStore(env);
    ctx.subscriptions.push(documents);

    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("mdLinkChecker")) {
            env.updateConfig(vscode.workspace.getConfiguration("mdLinkChecker"));
            documents.processAllDocuments();
        }
    }));

    //ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(documents.processDocument));
    ctx.subscriptions.push(vscode.workspace.onDidCloseTextDocument(documents.removeDocument));
    //ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(documents.updateDocument));

    // for (const doc of vscode.workspace.textDocuments) {
    //     documents.processDocument(doc);
    // }

    ctx.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: "markdown"}, {
        provideDocumentLinks: async (doc) => {
            // console.log("in provider: " + doc.version);
            await documents.processDocument(doc);
            return undefined;
        }
    }));

    console.log("md-link-checker is active");
}

export function deactivate() {
}

