import * as vscode from 'vscode';

type HostCredentialsRecord = Partial<Record<string, string | null>>;
const hostCredentialsSecretKey = "hostCredentials";

export class HostCredentialsStorage {
	constructor(private readonly secrets: vscode.SecretStorage) {
	}

	private saveCreds(creds: HostCredentialsRecord) {
		return this.secrets.store(hostCredentialsSecretKey, JSON.stringify(creds));
	}

	private async getCreds() {
		const raw = await this.secrets.get(hostCredentialsSecretKey);
		if (raw) {
			return JSON.parse(raw) as HostCredentialsRecord;
		} else {
			return {};
		}
	}

	async manage() {
		const creds = await this.getCreds();
		const choices = [];
		const forgetAllChoice = { label: "Forget all", host: null };
		choices.push(forgetAllChoice);
		for (const key in creds) {
			const value = creds[key];
			let suffix = "";
			if (value === null) {
				suffix = "empty, not asking";
			}
			choices.push({ label: key + suffix, host: key });
		}

		const choice = await vscode.window.showQuickPick(
			choices,
			{
				title: `Select the host you want to forget`,
			}
		);

		if (!choice) return;

		const confirmationChoice = choice.host === null
			? "Forget all hast credentials"
			: "Forget credentials for " + choice.host;

		const confirmationResult = await vscode.window.showQuickPick(
			[ confirmationChoice ],
			{
				title: `Please, confirm your action or cancel with ESC`,
			}
		);

		if (confirmationChoice !== confirmationResult) return;

		if (choice.host === null) {
			await this.secrets.delete(hostCredentialsSecretKey);
		} else {
			delete creds[choice.host];
			await this.saveCreds(creds);
		}
	}

	async tryGet(host: string): Promise<string | undefined | null> {
		const creds = await this.getCreds();
		return creds[host];
	}

	async requestNew(host: string): Promise<string | undefined | null> {

		const creds = await this.getCreds();
		let authString;

		const basicChoice = "Provide 'Basic' credentials";
		const bearerChoice = "Provide 'Bearer' credentials";
		const ignoreHostChoice = "Do not ask for this host";
		const choice = await vscode.window.showQuickPick(
			[basicChoice, bearerChoice, ignoreHostChoice],
			{
				title: `Host '${host}' requires authorization`,
			}
		);

		if (choice === basicChoice) {
			const authStringRaw = await vscode.window.showInputBox({
				title: `'Basic' credentials for '${host}' in form of 'user:password'`,
			});

			if (authStringRaw) {
				authString = "Basic " + Buffer.from(authStringRaw).toString('base64');
			}

		} else if (choice === bearerChoice) {

			const authStringRaw = await vscode.window.showInputBox({
				title: `Bearer token for '${host}'`,
			});

			if (authStringRaw) {
				authString = "Bearer " + authStringRaw;
			}

		} else if (choice === ignoreHostChoice) {
			authString = null;
		}

		if (authString !== undefined) {
			creds[host] = authString;
			await this.saveCreds(creds);
		}

		return authString;
	}
}
