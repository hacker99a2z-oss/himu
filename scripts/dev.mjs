import { spawn } from "node:child_process";

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });

await run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "backend/tsconfig.json"]);

const children = [
  spawn(process.execPath, ["backend/dist/backend/src/server.js"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "frontend/vite.config.ts"], { stdio: "inherit" }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop();
  });
  child.once("exit", (code) => {
    if (code !== 0 && code !== null) stop();
  });
}
