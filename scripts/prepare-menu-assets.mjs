import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const pagesDir = path.join(projectRoot, 'recursos', 'pages');
const sourceFiles = (await readdir(pagesDir)).filter((name) =>
  /^(retail|sme|corporate|footer|hero)-.*\.html$/.test(name)
);
const assetPaths = new Set();

for (const filename of sourceFiles) {
  const html = await readFile(path.join(pagesDir, filename), 'utf8');
  const navigationMatch = html.match(/var navigationContainer=({.*?});<\/script>/s);
  if (navigationMatch) {
    const items = JSON.parse(navigationMatch[1]).Navigation?.Childs || [];
    for (const item of items) if (item.Img?.startsWith('/')) assetPaths.add(item.Img);
  } else {
    const image = html.match(/class="content-img"[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1];
    if (image?.startsWith('/')) assetPaths.add(image);
  }
  if (html.includes('/SiteAssets/images/worldmap.png')) assetPaths.add('/SiteAssets/images/worldmap.png');
}

const lines = [];
for (const assetPath of [...assetPaths].sort()) {
  const output = path.join(projectRoot, 'public', ...assetPath.split('/').filter(Boolean));
  await mkdir(path.dirname(output), { recursive: true });
  lines.push(`path = "${assetPath}"`, `output = "${path.relative(projectRoot, output).replaceAll('\\', '/')}"`);
}
await writeFile(path.join(projectRoot, 'recursos', 'download-menu-assets.conf'), `${lines.join('\n')}\n`);
console.log(`Prepared ${assetPaths.size} menu image downloads.`);
