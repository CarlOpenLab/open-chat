#!/usr/bin/env node
// 跨平台端口清理：按端口找到监听进程并结束整个进程树。
// Windows 用 netstat + taskkill /T；macOS/Linux 用 lsof + SIGKILL。
import { execFileSync } from "node:child_process";

const ports = [
  ...new Set(
    process.argv
      .slice(2)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value < 65536),
  ),
];

if (ports.length === 0) {
  console.error("用法: node tools/clean-ports.mjs <port> [port...]");
  process.exit(1);
}

const isWindows = process.platform === "win32";

const listenerPids = (port) => {
  if (isWindows) {
    const output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const matcher = new RegExp(`:${port}\\s`);
    return [
      ...new Set(
        output
          .split(/\r?\n/)
          .filter((line) => line.includes("LISTENING") && matcher.test(line))
          .map((line) => Number(line.trim().split(/\s+/).pop()))
          .filter(Boolean),
      ),
    ];
  }
  try {
    const output = execFileSync("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return [...new Set(output.split(/\s+/).filter(Boolean).map(Number))];
  } catch {
    return [];
  }
};

const killTree = (pid) => {
  try {
    if (isWindows) {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
};

let failed = false;

for (const port of ports) {
  const pids = listenerPids(port).filter((pid) => pid !== process.pid);
  if (pids.length === 0) {
    console.log(`端口 ${port}: 未被占用`);
    continue;
  }
  for (const pid of pids) {
    if (killTree(pid)) {
      console.log(`端口 ${port}: 已结束 PID ${pid}`);
    } else {
      console.error(`端口 ${port}: 结束 PID ${pid} 失败（可能权限不足）`);
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
