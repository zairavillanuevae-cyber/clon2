"""Prepare a reproducible list of public reference assets (stdlib only)."""
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
english_prefix = '/' + 'en'
legacy_nearest_image = '/SiteAssets/images/' + 'en-yakin-ziraat.jpg'
nearest_image = '/SiteAssets/images/nearest-ziraat.jpg'
documents = [root / 'recursos/original.html', *sorted((root / 'recursos/pages').glob('*.html'))]
html = '\n'.join(p.read_text(encoding='utf-8') for p in documents)
css = (root / 'recursos/magiclick.min.css').read_text(encoding='utf-8')
urls = set(re.findall(r'(?:src|data-src|data-mobile-src)=[\"\']([^\"\']+)', html))
urls.update(re.findall(r'\"Img\":\"([^\"]+)\"', html))
urls.update(re.findall(r'url\([\"\']?([^\)\"\']+)', css))
urls.add('/SiteAssets/images/favicon.ico')
assets = []
for url in sorted(urls):
    path = urlsplit(url).path
    if not path.startswith('/') or path.startswith('//') or path.lower().endswith(('.js', '.aspx')):
        continue
    if path.lower().endswith(('.eot', '.svg', '.ttf', '.woff2')) and '/fonts/' in path:
        continue
    local_path = path[len(english_prefix):] if path == english_prefix or path.startswith(english_prefix + '/') else path
    local_path = local_path or '/'
    if local_path == legacy_nearest_image:
        local_path = nearest_image
    output = root / 'public' / local_path.lstrip('/')
    output.parent.mkdir(parents=True, exist_ok=True)
    assets.append({'path': local_path, 'file': output.relative_to(root).as_posix()})
missing = [a for a in assets if not (root / a['file']).exists()]
available = [a for a in assets if (root / a['file']).exists()]
(root / 'recursos/assets-manifest.json').write_text(json.dumps(available, indent=2), encoding='utf-8')
config = '\n'.join(f'# Missing local asset: {a["file"]}' for a in missing)
(root / 'recursos/download-assets.conf').write_text(config, encoding='utf-8')
dest = root / 'public/SiteAssets/css/min/magiclick.min.css'
dest.parent.mkdir(parents=True, exist_ok=True)
# Retain the original CSS in recursos; use local WOFF font files in the runnable clone.
css = re.sub(r'@font-face\{[^}]+\}', lambda m: re.sub(r'src:.*?;(?=font-weight)', 'src:url("' + re.search(r'url\([\"\']?([^\)\"\']+\.woff)(?:\?[^\)\"\']*)?', m[0])[1] + '") format("woff");', m[0]), css)
css = css.replace(english_prefix + '/', '/')
css = css.replace(legacy_nearest_image, nearest_image)
dest.write_text(css, encoding='utf-8')
print(f'Prepared {len(available)} public assets; {len(missing)} need downloading.')
