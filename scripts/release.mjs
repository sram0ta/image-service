import { spawnSync } from "node:child_process";

const version = process.argv[2]?.trim();
const tagName = `v${version}`;

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Использование: npm run release -- 1.0.5");
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function read(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
}

function tagExists(tag) {
  const result = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
    stdio: "ignore",
    shell: false,
  });

  return result.status === 0;
}

const branch = read("git", ["branch", "--show-current"]);
if (!branch) {
  console.error("Не удалось определить текущую git-ветку.");
  process.exit(1);
}

if (tagExists(tagName)) {
  console.error(`Тег ${tagName} уже существует.`);
  process.exit(1);
}

run("npm", ["run", "release:prepare", "--", version]);
run("npm", ["run", "build"]);
run("git", ["add", "."]);

const hasStagedChanges = spawnSync("git", ["diff", "--cached", "--quiet"], {
  stdio: "ignore",
  shell: false,
}).status !== 0;

if (!hasStagedChanges) {
  console.error("Нет изменений для релизного коммита.");
  process.exit(1);
}

run("git", ["commit", "-m", `Release ${tagName}`]);
run("git", ["tag", tagName]);
run("git", ["push", "origin", branch]);
run("git", ["push", "origin", tagName]);

console.log(`\nРелиз ${tagName} отправлен. GitHub Actions начнет сборку автоматически.`);
