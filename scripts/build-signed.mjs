import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const keyPath = ".tauri/image-service.key";
const passwordPath = ".tauri/image-service.key.password";

if (!existsSync(keyPath) || !existsSync(passwordPath)) {
  console.error("Не найдены .tauri/image-service.key и .tauri/image-service.key.password");
  process.exit(1);
}

const child = spawn("node", ["scripts/tauri.mjs", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY_PATH: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(passwordPath, "utf8").trim(),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
