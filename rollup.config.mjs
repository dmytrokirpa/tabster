import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { babel } from "@rollup/plugin-babel";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import typescript from "rollup-plugin-typescript2";
import dts from "rollup-plugin-dts";

import pkg from "./package.json" with { type: "json" };

const extensions = [".ts"];

/**
 * @type {import('rollup').RollupOptions}
 */
// lite entry points: each src/lite/*.ts file → its own ESM chunk under dist/lite/
const liteEntries = [
    "focusable",
    "focused",
    "groupper",
    "mover",
    "deloser",
    "modalizer",
    "restorer",
    "observed",
    "observer",
    "index",
];

// feature entry points: each src/features/*.ts file → its own chunk under dist/features/
const featureEntries = [
    "crossOrigin",
    "deloser",
    "groupper",
    "modalizer",
    "mover",
    "observedElement",
    "outline",
    "restorer",
];

// core entry point
const coreEntries = ["createContext"];

const litePlugins = () => [
    typescript({
        useTsconfigDeclarationDir: true,
        tsconfig: "src/lite/tsconfig.json",
        tsconfigOverride: {
            compilerOptions: {
                emitDeclarationOnly: false,
                stripInternal: true,
            },
        },
    }),
    babel({
        babelHelpers: "bundled",
        extensions,
        exclude: "node_modules/**",
    }),
    json(),
    replace({
        preventAssignment: true,
        __DEV__: `process.env.NODE_ENV === 'development'`,
        __VERSION__: JSON.stringify(pkg.version),
    }),
    commonjs({ extensions }),
    resolve({ extensions, mainFields: ["module", "main"] }),
];

const liteBuilds = liteEntries.map((name) => ({
    input: `./src/lite/${name}.ts`,
    output: [
        {
            file: `dist/lite/${name}.esm.js`,
            format: "es",
            sourcemap: true,
        },
        {
            file: `dist/lite/${name}.js`,
            format: "cjs",
            sourcemap: true,
            exports: "named",
        },
    ],
    // keyborg must never end up in any lite chunk
    external: ["keyborg"],
    plugins: litePlugins(),
}));

const liteDtsBuilds = liteEntries.map((name) => ({
    input: `./dist/dts/lite/${name}.d.ts`,
    output: [{ file: `dist/lite/${name}.d.ts`, format: "es" }],
    plugins: [dts()],
}));

// Shared plugin factory for the main-tsconfig builds (features + core).
const mainPlugins = () => [
    typescript({
        useTsconfigDeclarationDir: true,
        tsconfig: "src/tsconfig.lib.json",
        tsconfigOverride: {
            compilerOptions: {
                emitDeclarationOnly: false,
                stripInternal: true,
            },
        },
    }),
    babel({
        babelHelpers: "bundled",
        extensions,
        exclude: "node_modules/**",
    }),
    json(),
    replace({
        preventAssignment: true,
        __DEV__: `process.env.NODE_ENV === 'development'`,
        __VERSION__: JSON.stringify(pkg.version),
    }),
    commonjs({ extensions }),
    resolve({ extensions, mainFields: ["module", "main"] }),
];

const featureBuilds = featureEntries.map((name) => ({
    input: `./src/features/${name}.ts`,
    output: [
        {
            file: `dist/features/${name}.esm.js`,
            format: "es",
            sourcemap: true,
        },
        {
            file: `dist/features/${name}.js`,
            format: "cjs",
            sourcemap: true,
            exports: "named",
        },
    ],
    external: ["tslib", "keyborg"],
    plugins: mainPlugins(),
}));

const featureDtsBuilds = featureEntries.map((name) => ({
    input: `./dist/dts/features/${name}.d.ts`,
    output: [{ file: `dist/features/${name}.d.ts`, format: "es" }],
    plugins: [dts()],
}));

const coreBuilds = coreEntries.map((name) => ({
    input: `./src/core/${name}.ts`,
    output: [
        {
            file: `dist/core/${name}.esm.js`,
            format: "es",
            sourcemap: true,
        },
        {
            file: `dist/core/${name}.js`,
            format: "cjs",
            sourcemap: true,
            exports: "named",
        },
    ],
    external: ["tslib", "keyborg"],
    plugins: mainPlugins(),
}));

const coreDtsBuilds = coreEntries.map((name) => ({
    input: `./dist/dts/core/${name}.d.ts`,
    output: [{ file: `dist/core/${name}.d.ts`, format: "es" }],
    plugins: [dts()],
}));

const config = [
    {
        input: "./src/index.ts",
        output: [
            { file: pkg.main, format: "cjs", sourcemap: true },
            { file: pkg.module, format: "es", sourcemap: true },
        ],
        external: ["tslib", "keyborg"],
        plugins: [
            typescript({
                useTsconfigDeclarationDir: true,
                tsconfig: "src/tsconfig.lib.json",
                tsconfigOverride: {
                    compilerOptions: {
                        // https://github.com/ezolenko/rollup-plugin-typescript2/issues/268
                        emitDeclarationOnly: false,
                        stripInternal: true,
                    },
                },
            }),
            babel({
                babelHelpers: "bundled",
                extensions,
                exclude: "node_modules/**",
            }),
            json(),
            replace({
                preventAssignment: true,
                __DEV__: `process.env.NODE_ENV === 'development'`,
                __VERSION__: JSON.stringify(pkg.version),
            }),
            commonjs({ extensions }),
            resolve({ extensions, mainFields: ["module", "main"] }),
        ],
    },
    {
        input: "./dist/dts/index.d.ts",
        output: [{ file: "dist/index.d.ts", format: "es" }],
        // rolls up all dts files into a single dts file
        // so that internal types don't leak
        plugins: [dts()],
    },
    ...liteBuilds,
    ...liteDtsBuilds,
    ...featureBuilds,
    ...featureDtsBuilds,
    ...coreBuilds,
    ...coreDtsBuilds,
];

export default config;
