
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    sourcemap: true,
    minify: false,
    logLevel: "info"
};

async function build() {
    if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
        console.log("Watching for changes...");
    } else {
        await esbuild.build(options);
        console.log("TrueForge extension compiled successfully!");
    }
}

build().catch((error) => {
    console.error(error);
    process.exit(1);
});
