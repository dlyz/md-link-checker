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

    const mdDocSelector = { language: "markdown" };

    ctx.subscriptions.push(vscode.languages.registerDocumentLinkProvider(mdDocSelector, {
        provideDocumentLinks: async (doc) => {
            // console.log("in provider: " + doc.version);
            await documents.processDocument(doc);
            return undefined;
        }
    }));

    ctx.subscriptions.push(vscode.languages.registerRenameProvider(mdDocSelector, {
        provideRenameEdits: (doc, pos, newName) => {
            const state = documents.getOrOpenDocument(doc);
            if (state) {
                return state.renameLinkRefNameAt(pos, newName);
            } else {
                return undefined;
            }
        },
        prepareRename: (doc, pos) => {
            const state = documents.getOrOpenDocument(doc);
            if (state) {
                const range = state.canRenameLinkRefNameAt(pos);
                if (range) return range;
            }

            // we have to throw to indicate we can not rename here.
            // undefined return means use default word definition to rename.
            throw new Error("Nothing to rename here");
        }
    }));

    ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider(mdDocSelector, {
        provideCodeActions: (doc, range, context) => {
            const state = documents.getOrOpenDocument(doc);
            return state?.getCodeActions(range, context);
        }
    }));

    console.log("md-link-checker is active");
}

export function deactivate() {
}

