/**
 * @fileoverview The SVGLint entry file.
 * This is the publicly exposed JS API, which the CLI also uses.
 * It exposes .lintSource() and .lintFile().
 * Main responsibility is handling the consumer<->Linting communication,
 *   and converting the user-provided config into an object of rules.
 */
import Linting from "./lib/linting.js";
import * as parse from "./lib/parse.js";
import loadRule from "./lib/rule-loader.js";
import Logger from "./lib/logger.js";
const logger = Logger("");

/** @typedef {import("./lib/parse.js").AST} AST */
/** @typedef {import("./lib/rule-loader.js").RuleModule} RuleModule */

/**
 * @typedef {Object<string,any>} RulesConfig
 * An object with each key representing a rule name, and each value representing
 *   a rule config.
 * If the rule config is set to `false`, then the rule is disabled (useful for
 *   e.g. overwriting presets).
 */
/**
 * @typedef {Object<string,Function|Function[]>} NormalizedRules
 * The RulesConfig after being normalized - each function is a rule.
 */
/**
 * @typedef {String[]} IgnoreList
 * An array of strings, each of which is a blob that represents files to ignore.
 * If any blob matches a file, the file is not linted.
 */
/**
 * @typedef Config
 * @property {RulesConfig} [rules={}] The rules to lint by
 * @property {IgnoreList} [ignore=[]] The blobs representing which files to ignore
 */
/**
 * @typedef NormalizedConfig
 * @property {NormalizedRules} rules The rules to lint by
 * @property {IgnoreList} ignore The blobs representing which files to ignore
 */

/** @type Config */
const DEFAULT_CONFIG = Object.freeze({
    useSvglintRc: true,
    rules: { valid: true },
    ignore: [],
});

/**
 * Normalizes a user-provided RulesConfig into a NormalizedRules.
 * Figures out which rules should be kept, and calls their generator with the
 *   user-provided config. The returned function is the actual linting func.
 * @param {RulesConfig} rulesConfig The user-provided config
 * @returns {Promise<NormalizedRules>} Resolves to the normalized rules
 */
async function normalizeRules(rulesConfig) {
    /** @type {NormalizedRules} */
    const outp = {};
    const promises = Object.keys(rulesConfig)
        // make sure no disabled rules are allowed in
        .filter(k => rulesConfig[k] !== false)
        // then convert each rule config into a rule func
        .map(
            async (ruleName) => {
                /** @type {RuleModule} */
                let loadedRule;
                try {
                    loadedRule = await loadRule(ruleName);
                } catch (e) {
                    logger.warn(`Unknown rule "${ruleName}".`);
                    return;
                }

                // handle the case where there are multiple configs for a single rule
                const config = rulesConfig[ruleName];
                if (config instanceof Array) {
                    /** @type {Array} */
                    outp[ruleName] = config.map(
                        config => loadedRule.generate(config)
                    );
                } else {
                    outp[ruleName] = loadedRule.generate(config);
                }
            }
        );
    await Promise.all(promises);
    return outp;
}

/**
 * Normalizes a user-provided config to make sure it has every property we need.
 * Also handles merging with defaults.
 * @param {Config} config The user-provided config
 * @returns {Promise<NormalizedConfig>} Resolves to the normalized config
 */
async function normalizeConfig(config) {
    const defaulted = Object.assign({},
        DEFAULT_CONFIG,
        config,
    );
    defaulted.rules = Object.assign({}, DEFAULT_CONFIG.rules, config.rules);
    /** @type NormalizedConfig */
    const outp = {
        rules: await normalizeRules(defaulted.rules),
        ignore: defaulted.ignore,
    };
    return outp;
}

/**
 * The main function. Lints the provided AST using the user-provided config.
 * @param {String} file The file we are linting
 * @param {AST} ast The AST to lint
 * @param {Config} config The user-provided config to lint by
 * @returns {Promise<Linting>} Resolves to the linting that represents the result
 */
async function lint(file, ast, config) {
    if (!ast.length && ast.source.trim() !== "") {
        throw new Error(`Unable to parse SVG from ${file || "API"}:
${ast.source}`);
    }
    const conf = await normalizeConfig(config);
    return new Linting(file, ast, conf.rules);
}

export default {
    /**
     * Lints a single SVG string.
     * The function returns before the Linting is finished.
     * You should listen to Linting.on("done") to wait for the result.
     * @param {String} source The SVG to lint
     * @param {Config} [config={}] The config to lint by
     * @return {Promise<Linting>} Resolves to the Linting that represents the result
     */
    async lintSource(source, config={}) {
        const ast = parse.parseSource(source);
        return lint(null, ast, config);
    },

    /**
     * Lints a single file.
     * The returned Promise resolves before the Linting is finished.
     * You should listen to Linting.on("done") to wait for the result.
     * @param {String} file The file path to lint
     * @param {Config} [config={}] The config to lint by
     * @returns {Promise<Linting>} Resolves to the Linting that represents the result
     */
    async lintFile(file, config={}) {
        const ast = await parse.parseFile(file);
        return lint(file, ast, config);
    }
};
