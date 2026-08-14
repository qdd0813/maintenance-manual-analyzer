import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
    });
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchBinary(url, minimumBytes) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const bytes = (await response.arrayBuffer()).byteLength;
  if (bytes < minimumBytes) throw new Error(`${url} 文件过小：${bytes}`);
}

await run(["build"]);

const preview = spawn(command, ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4173"], {
  stdio: "ignore",
});

try {
  await wait(1200);
  const html = await fetchText("http://127.0.0.1:4173/");
  if (!html.includes("./assets/")) {
    throw new Error("构建后的页面没有引用 dist/assets 资源");
  }
  const asset = html.match(/src="(\.\/assets\/[^"]+\.js)"/)?.[1];
  if (!asset) throw new Error("构建后的页面没有找到入口 JS");
  await fetchText(`http://127.0.0.1:4173/${asset.replace("./", "")}`);
  await fetchBinary("http://127.0.0.1:4173/ocr/worker.min.js", 50_000);
  await fetchBinary("http://127.0.0.1:4173/ocr/lang/eng.traineddata.gz", 1_000_000);
  await fetchBinary("http://127.0.0.1:4173/ocr/core/tesseract-core-lstm.wasm.js", 1_000_000);
  console.log("SELF_CHECK_OK: 页面、入口和本地 OCR 资源均可访问。");
} finally {
  preview.kill("SIGTERM");
}
