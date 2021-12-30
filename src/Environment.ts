import * as vscode from 'vscode';
import { HostCredentialsStorage } from './HostCredentialsStorage';
import { LinkChecker, MainLinkChecker } from './LinkChecker';
import { GrammarMarkdownParser, MarkdownParser } from './MarkdownParser';
import { githubSlugifier, Slugifier } from './slugify';

export interface Configuration {
    countryCodeRegex?: string,

	/** Number of seconds to consider cached check result valid */
	cacheTtl?: number,
}

export class Environment {

    configuration: Configuration;
    public readonly slugifier: Slugifier = githubSlugifier;
    private readonly _parser: GrammarMarkdownParser = new GrammarMarkdownParser(this.slugifier);
    public readonly parser: MarkdownParser = this._parser;
    public readonly linkChecker: LinkChecker;
    public readonly hostCredentials: HostCredentialsStorage;

    constructor(
        config: vscode.WorkspaceConfiguration,
        public readonly diagnostics: vscode.DiagnosticCollection,
        context: vscode.ExtensionContext
    ) {
        this.configuration = this.updateConfig(config);
        this.hostCredentials = new HostCredentialsStorage(context.secrets);
        this.linkChecker = new MainLinkChecker(
            () =>  this.configuration,
            this.slugifier,
            this.parser,
            this.hostCredentials
        );
    }

    async initialize() {
        await this._parser.initialize();
    }


    updateConfig(config: vscode.WorkspaceConfiguration) {
        const newConfig: Configuration = {};

        Environment.initConfig(newConfig, config, (configVal, configSec) => {
            configVal("countryCodeRegex");
        });

        return this.configuration = newConfig;
    }

    private static initConfig<T>(target: T, config: vscode.WorkspaceConfiguration, handler: ConfigHandler<T>) {

        function valueSetter<K extends (keyof T & string)>(key: K) {
            const value = config.get<T[K]>(key);
            if (value !== undefined) {
                target[key] = value;
            }
        }

        function sectionSetter<K extends (keyof T & string)>(key: K, handler: ConfigHandler<T[K]>) {
            const section = config.get<vscode.WorkspaceConfiguration>(key);
            if (section !== undefined) {
                Environment.initConfig(target[key], section, handler);
            }
        }

        handler(valueSetter, sectionSetter);
    }
}




type ConfigHandler<T> = (
    valueSetter: <K extends (keyof T & string)>(key: K) => void,
    sectionSetter: <K extends (keyof T & string)>(key: K, handler: ConfigHandler<T[K]>) => void,
   ) => void;


// type NullablePropertyKeys<T> = {
//     [K in keyof T]-?: undefined extends T[K] ? K : never
// }[keyof T];

// type OmitRequired<T> = {
//     [K in NullablePropertyKeys<T>]?: T[K]
// };
