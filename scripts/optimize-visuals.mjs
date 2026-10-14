import { createRequire } from "node:module";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "package.json"));
const sharp = require("sharp");
const directory = join(root, "apps/web/public/visuals");
for (const file of await readdir(directory)) {
  if (!file.endsWith(".png")) continue;
  const input = join(directory, file);
  const output = input.replace(/\.png$/, ".webp");
  await sharp(input)
    .resize({ width: file === "logo.png" ? 256 : 1280, withoutEnlargement: true })
    .webp({ quality: 84 })
    .toFile(output);
  console.log(`${file} → ${Math.round((await stat(output)).size / 1024)} KB`);
}
