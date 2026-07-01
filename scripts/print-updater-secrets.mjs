import { existsSync, readFileSync } from "node:fs";

const keyPath = ".tauri/image-service.key";
const passwordPath = ".tauri/image-service.key.password";

if (!existsSync(keyPath) || !existsSync(passwordPath)) {
  console.error("Не найдены локальные ключи updater. Сначала сгенерируй их через Tauri signer.");
  process.exit(1);
}

console.log("Добавь эти GitHub Actions secrets в репозитории:");
console.log("");
console.log("TAURI_SIGNING_PRIVATE_KEY:");
console.log(readFileSync(keyPath, "utf8").trim());
console.log("");
console.log("TAURI_SIGNING_PRIVATE_KEY_PASSWORD:");
console.log(readFileSync(passwordPath, "utf8").trim());
console.log("");
console.log("Путь: GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret");
