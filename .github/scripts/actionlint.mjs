import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { exit } from "node:process";

const { getLintLog, runLint } = createRequire(import.meta.url)(
  "@tktco/node-actionlint",
);

function isWorkflowFile(path) {
  return /^\.github\/workflows\/.+\.ya?ml$/.test(path);
}

function toRepoPath(path) {
  const relativePath = isAbsolute(path) ? relative(process.cwd(), path) : path;
  return relativePath.split(sep).join("/");
}

async function findWorkflowFiles(dir = ".github/workflows") {
  const files = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findWorkflowFiles(path)));
    } else if (/\.ya?ml$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files.sort();
}

const files =
  process.argv.length > 2
    ? Array.from(
        new Set(process.argv.slice(2).map(toRepoPath).filter(isWorkflowFile)),
      ).sort()
    : await findWorkflowFiles();

if (files.length === 0) {
  exit(0);
}

console.log(`Checking ${files.length} workflow file(s)...`);

const results = [];
for (const path of files) {
  const data = await readFile(path, "utf8");
  for (const result of await runLint(data, path)) {
    if (result.message) {
      results.push({ ...result, data, path });
    }
  }
}

const log = getLintLog(results);
if (log) {
  console.log(log);
  exit(1);
}

console.log("All workflow files passed lint checks.");
