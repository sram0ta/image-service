import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Использование: npm run release:prepare -- 0.2.0");
  process.exit(1);
}

function updateJson(path, updater) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  updater(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

updateJson("package.json", (data) => {
  data.version = version;
});

updateJson("package-lock.json", (data) => {
  data.version = version;
  if (data.packages?.[""]) {
    data.packages[""].version = version;
  }
});

updateJson("src-tauri/tauri.conf.json", (data) => {
  data.version = version;
});

const cargoTomlPath = "src-tauri/Cargo.toml";
const cargoToml = readFileSync(cargoTomlPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
);
writeFileSync(cargoTomlPath, cargoToml);

console.log(`Версия обновлена до ${version}.`);
console.log(`Дальше: git add . && git commit -m "Release v${version}" && git tag v${version}`);
