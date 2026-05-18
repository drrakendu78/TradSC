#!/usr/bin/env node
// Génère un fichier de traduction SCMDB (lang-fr-X.Y.Z.json) à partir
// du global.ini FR et du template SCMDB.
//
// Usage :
//   node scripts/build-scmdb-lang.mjs <template.json> <global.ini> <out.json>
//
// On reproduit la logique de KrovaxCode/SCMDB_LANG/build_lang_template.py
// — mappage clé-par-clé du template EN sur les valeurs trouvées dans le
// global.ini FR. Pas de tokens ~mission() resolution avancée pour cette
// V1 ; on garde le placeholder tel quel si la chaîne FR le contient.

import fs from "node:fs";
import path from "node:path";

const [, , templatePath, iniPath, outPath] = process.argv;
if (!templatePath || !iniPath || !outPath) {
    console.error("Usage: node build-scmdb-lang.mjs <template.json> <global.ini> <out.json>");
    process.exit(1);
}

// --- Load template ---
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const version = template.version;
const keyCount = template.keyCount ?? Object.keys(template.keys || {}).length;
console.log(`Template loaded: ${path.basename(templatePath)}`);
console.log(`  Version: ${version}`);
console.log(`  Keys: ${keyCount}`);

// --- Parse global.ini ---
// Format: key=value, key,P=value, key,F=value...
// On garde la 1ère valeur trouvée par clé (sans suffixe).
const iniContent = fs.readFileSync(iniPath, "utf8");
const loc = new Map();
const locLower = new Map();
let lineCount = 0;
for (const rawLine of iniContent.split(/\r?\n/)) {
    lineCount++;
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const rawKey = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    // Strip trailing \n litéraux
    while (value.endsWith("\\n")) value = value.slice(0, -2).trimEnd();
    // Strip suffixes ",P" / ",F" / etc. — on prend la forme canonique
    const baseKey = rawKey.split(",")[0];
    if (!loc.has(baseKey)) {
        loc.set(baseKey, value);
        locLower.set(baseKey.toLowerCase(), value);
    }
    if (!loc.has(rawKey)) {
        loc.set(rawKey, value);
        locLower.set(rawKey.toLowerCase(), value);
    }
}
console.log(`global.ini parsed: ${loc.size} unique keys (${lineCount} lines)`);

// --- Build translation ---
const translated = {};
let translatedCount = 0;
let missing = 0;
let noloc = 0;
const missingKeys = [];

for (const [key, englishText] of Object.entries(template.keys || {})) {
    if (key.startsWith("_noloc_")) {
        translated[key] = { en: englishText, tr: englishText };
        noloc++;
        continue;
    }
    let foreignVal =
        loc.get(key) ??
        loc.get(`@${key}`) ??
        locLower.get(key.toLowerCase()) ??
        locLower.get(`@${key}`.toLowerCase());
    if (foreignVal) {
        // Strip remaining literal \n
        while (foreignVal.endsWith("\\n")) foreignVal = foreignVal.slice(0, -2).trimEnd();
        translated[key] = { en: englishText, tr: foreignVal };
        translatedCount++;
    } else {
        // Fallback: garder l'anglais (SCMDB acceptera, juste pas traduit)
        translated[key] = { en: englishText, tr: englishText };
        missing++;
        if (missingKeys.length < 30) missingKeys.push(key);
    }
}

const total = Object.keys(translated).length;
const result = {
    version,
    sourceLanguage: "en",
    targetLanguage: "fr",
    keyCount: total,
    stats: {
        total,
        translated: translatedCount,
        missing,
        noLocKey: noloc,
        coverage: ((translatedCount / total) * 100).toFixed(1) + "%",
    },
    keys: translated,
};

fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log("\n=== Result ===");
console.log(`  File:        ${path.basename(outPath)}`);
console.log(`  Total:       ${total}`);
console.log(`  Translated:  ${translatedCount}`);
console.log(`  Missing:     ${missing}`);
console.log(`  No-loc:      ${noloc}`);
console.log(`  Coverage:    ${result.stats.coverage}`);
if (missingKeys.length > 0) {
    console.log(`  Sample missing (${missingKeys.length}/${missing}):`);
    for (const k of missingKeys.slice(0, 10)) console.log(`    - ${k}`);
}
