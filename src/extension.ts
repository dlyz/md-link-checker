import * as vscode from 'vscode';

import { Environment } from './Environment';
import { DocumentStore } from './DocumentStore';



export async function activate(ctx: vscode.ExtensionContext) {

    const diagnostics = vscode.languages.createDiagnosticCollection();
    ctx.subscriptions.push(diagnostics);

    const env = new Environment(
        vscode.workspace.getConfiguration("mdLinkChecker"),
        diagnostics,
        ctx
    );

    await env.initialize();
    ctx.subscriptions.push(vscode.commands.registerCommand("mdLinkChecker.manageHostCredentials", async () => {
        env.hostCredentials.manage();
    }));

    const documents = new DocumentStore(env);
    ctx.subscriptions.push(documents);



    ctx.subscriptions.push(vscode.commands.registerCommand("mdLinkChecker.recheckDocument", async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (document) {
            await documents.reprocessDocumentIfExists(document);
        }
    }));

    ctx.subscriptions.push(vscode.commands.registerCommand("mdLinkChecker.recheckOpenedDocuments", async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (document) {
            await documents.reprocessExistingDocuments();
        }
    }));


    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("mdLinkChecker")) {
            env.updateConfig(vscode.workspace.getConfiguration("mdLinkChecker"));
            documents.reprocessExistingDocuments();
        }
    }));

    //ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(documents.processDocument));
    ctx.subscriptions.push(vscode.workspace.onDidCloseTextDocument(documents.removeDocument));
    //ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument());

    // we want to know about all the opened (potentially changed) documents,
    // to use their actual headings
    for (const doc of vscode.workspace.textDocuments) {
        documents.ensureDocument(doc);
    }

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

