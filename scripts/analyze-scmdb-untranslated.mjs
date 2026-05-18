#!/usr/bin/env node
// Analyse le JSON SCMDB FR pour identifier les strings qui ne sont pas
// réellement traduites (même contenu modulo placeholders/EM tags).

import fs from "node:fs";

const inputPath = process.argv[2];
if (!inputPath) {
    console.error("Usage: node analyze-scmdb-untranslated.mjs <lang-fr.json>");
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

// Normalise une string : retire les placeholders pour comparer le contenu réel.
function normalize(s) {
    return s
        .replace(/~mission\([^)]+\)/g, "[T]")
        .replace(/\[(LOCATION|DESTINATION|DESTINATIONS|TARGET|SYSTEM|SHIP|RANK|CARGO_GRADE|MAX_SCU|MULTITOOL|APPROVAL_CODE|RACE_TYPE|SIGN_OFF|CLAIM|INFORMANT|MONITOR_COUNT)\]/gi, "[T]")
        .replace(/<EM\d+>.*?<\/EM\d+>/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

const untranslated = [];
const translated = [];
const empty = [];

for (const [key, v] of Object.entries(data.keys)) {
    if (!v.en && !v.tr) {
        empty.push(key);
        continue;
    }
    const enN = normalize(v.en);
    const trN = normalize(v.tr);
    if (enN === trN && enN.length > 0) {
        untranslated.push({ key, en: v.en, tr: v.tr });
    } else {
        translated.push({ key, en: v.en, tr: v.tr });
    }
}

console.log(`Total keys: ${Object.keys(data.keys).length}`);
console.log(`  Vraiment traduits (contenu différent): ${translated.length}`);
console.log(`  Non-traduits (même contenu): ${untranslated.length}`);
console.log(`  Vides: ${empty.length}`);
console.log();
console.log("Échantillon non-traduits (premiers 20) :");
for (const item of untranslated.slice(0, 20)) {
    console.log(`  ${item.key}`);
    console.log(`    EN: ${item.en}`);
    console.log(`    FR: ${item.tr}`);
}

// Output JSON of untranslated for batch translation
const outPath = inputPath.replace(/\.json$/, ".untranslated.json");
fs.writeFileSync(
    outPath,
    JSON.stringify(
        {
            count: untranslated.length,
            items: untranslated.map((it) => ({ key: it.key, en: it.en })),
        },
        null,
        2
    ),
    "utf8"
);
console.log(`\nWrote ${outPath} (${untranslated.length} entries)`);
