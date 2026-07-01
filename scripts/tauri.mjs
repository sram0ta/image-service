import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const home = homedir();
const candidates = [
  join(home, ".cargo", "bin"),
  join(home, ".rustup", "toolchains", "stable-aarch64-apple-darwin", "bin"),
  join(home, ".rustup", "toolchains", "stable-x86_64-apple-darwin", "bin"),
  join(home, ".rustup", "toolchains", "stable-x86_64-pc-windows-msvc", "bin"),
];

const rustPaths = candidates.filter((path) => existsSync(join(path, "cargo")));
const env = {
  ...process.env,
  PATH: [...rustPaths, process.env.PATH ?? ""].join(process.platform === "win32" ? ";" : ":"),
};

const child = spawn("tauri", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
