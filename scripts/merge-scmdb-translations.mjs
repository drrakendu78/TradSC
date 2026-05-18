#!/usr/bin/env node
// Merge scmdb-translations-fr.json (mapping EN string → FR) dans le lang-fr
// SCMDB existant. Pour chaque entrée du lang-fr dont `tr` est resté identique
// au contenu EN (modulo placeholders), on cherche une traduction FR dans
// translations.json et on l'applique.
//
// Usage :
//   node scripts/merge-scmdb-translations.mjs <lang-fr.json> <translations-fr.json> <out.json>

import fs from "node:fs";
import path from "node:path";

const [, , langPath, translationsPath, outPath] = process.argv;
if (!langPath || !translationsPath || !outPath) {
    console.error("Usage: node merge-scmdb-translations.mjs <lang-fr.json> <translations-fr.json> <out.json>");
    process.exit(1);
}

const lang = JSON.parse(fs.readFileSync(langPath, "utf8"));
const trData = JSON.parse(fs.readFileSync(translationsPath, "utf8"));
const trMap = trData.translations || {};

let applied = 0;
let skippedEmpty = 0;
let notFound = 0;

for (const [key, v] of Object.entries(lang.keys)) {
    const enText = v.en;
    const trCandidate = trMap[enText];
    if (trCandidate == null) {
        notFound++;
        continue;
    }
    if (trCandidate === "") {
        skippedEmpty++;
        continue;
    }
    v.tr = trCandidate;
    applied++;
}

lang.stats = lang.stats || {};
lang.stats.communityTranslationsApplied = applied;

fs.writeFileSync(outPath, JSON.stringify(lang, null, 2), "utf8");
console.log("=== Merge ===");
console.log(`  Total keys:           ${Object.keys(lang.keys).length}`);
console.log(`  FR traductions appliquées: ${applied}`);
console.log(`  Entries laissées en EN (vides): ${skippedEmpty}`);
console.log(`  Pas dans le mapping (déjà traduits par global.ini): ${notFound}`);
console.log(`  → ${path.basename(outPath)}`);
