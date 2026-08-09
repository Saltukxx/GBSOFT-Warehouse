/**
 * Golden dataset'i içe aktarma şablonu biçiminde CSV olarak yazar.
 *
 *   npm run export:csv [hedef-klasör]
 *
 * İki işe yarar: (1) yeni bir tesisi kurarken şablonun iki satırlık örneği
 * yerine **dolu** bir dosya görülür, (2) import hattı golden dataset'e karşı
 * elle sınanabilir.
 *
 * Dosyalar Türkçe Excel'in beklediği biçimde yazılır: noktalı virgül ayraç,
 * ondalık virgül, UTF-8 BOM.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toCsv } from "@gbsoft/domain";
import { GOLDEN_CSV_KINDS, goldenCsvRows } from "@gbsoft/seed";

const outDir = path.resolve(process.argv[2] ?? "seed-csv");

await mkdir(outDir, { recursive: true });

for (const kind of GOLDEN_CSV_KINDS) {
  const rows = goldenCsvRows(kind);
  if (!rows) continue;

  const file = path.join(outDir, `${kind}.csv`);
  await writeFile(file, `\uFEFF${toCsv(rows, ";")}\r\n`, "utf8");
  console.log(`${file} · ${rows.length - 1} satır`);
}

console.log(
  `\nYükleme sırası: ${GOLDEN_CSV_KINDS.join(" → ")}\n` +
    "Geometri dosyasını activate=1 ile yükleyin, sonra kalanları.",
);
