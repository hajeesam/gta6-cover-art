// Palm Heist — Cover Studio: hand-in program (Node 22, standard library only).
//
// This program takes the entry's files and lays them out for the scorer:
// it copies the offline web app in app/ and the screenshots in screenshots/
// into the output directory, then writes dossier.json there with the vendored
// make.fun library (buildDossier), so the judge can read the app's source and
// screenshots. The output directory is /output in the grader; outside it,
// MAKEFUN_OUTPUT_DIR stands in for /output, e.g.:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The program runs twice and must write identical bytes both times: it copies
// files as they are and builds the dossier from those same files, so the two
// runs agree. Serve the app locally with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

// The repository root is the directory this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'app'), join(outputDir, 'app'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// Caps matching the scorer's gate: the dossier text is capped at 160 KiB,
// at most 4 screenshots of at most 256 KiB each, and app/ holds at most 993
// files and directories totalling at most 48 MiB, with no path over 1000 bytes.
// Passing a larger entry here fails loudly instead of handing in bad output.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 50331648,
    app_path_max_bytes: 1000,
  }),
);
