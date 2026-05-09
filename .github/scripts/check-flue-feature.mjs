import { readFileSync } from "node:fs";
import { exit } from "node:process";

const [, , registryPath, featureName, repository] = process.argv;

if (!registryPath || !featureName || !repository) {
  console.error(
    "Usage: node check-flue-feature.mjs <registryPath> <featureName> <owner/repo>",
  );
  exit(2);
}

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const repositories = registry?.features?.[featureName]?.repositories;

if (!Array.isArray(repositories)) {
  console.error(`Flue feature is not registered: ${featureName}`);
  exit(2);
}

if (!repositories.includes(repository)) {
  console.error(`Flue feature ${featureName} is not enabled for ${repository}`);
  console.error(`Enabled repositories: ${repositories.join(", ")}`);
  exit(1);
}

console.log(`Flue feature ${featureName} is enabled for ${repository}`);
