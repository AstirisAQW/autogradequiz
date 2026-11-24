import assert from "node:assert/strict";
import test from "node:test";
import { buildCsvContent, slugifyFilename } from "../src/lib/csvExport.ts";

test("buildCsvContent prepends UTF-8 BOM and uses CRLF line endings", () => {
  const csv = buildCsvContent(["Name", "Score"], [["Ada", 20]]);
  assert.ok(csv.startsWith("\ufeffName,Score\r\nAda,20"));
});

test("buildCsvContent quotes commas, quotes, and newlines", () => {
  const csv = buildCsvContent(
    ["Tag", "Note"],
    [['Topic "A", Unit 1', "Line 1\nLine 2"]],
  );
  assert.equal(
    csv,
    '\ufeffTag,Note\r\n"Topic ""A"", Unit 1","Line 1\nLine 2"',
  );
});

test("buildCsvContent neutralizes spreadsheet formula prefixes", () => {
  const csv = buildCsvContent(
    ["A", "B", "C", "D", "E", "F"],
    [["=SUM(A1)", "+Addition", "-Negative", "@mention", "\tTab", "\rCR"]],
  );
  assert.equal(
    csv,
    '\ufeffA,B,C,D,E,F\r\n\'=SUM(A1),\'+Addition,\'-Negative,\'@mention,\'\tTab,"\'\rCR"',
  );
});

test("slugifyFilename normalizes spaces, punctuation, and trims edge hyphens", () => {
  assert.equal(slugifyFilename("Unit 1: Algebra!"), "unit-1-algebra");
  assert.equal(slugifyFilename("  --Quiz #2--  "), "quiz-2");
  assert.equal(slugifyFilename("Unit 1!"), "unit-1");
  assert.equal(slugifyFilename("!!!"), "quiz");
  assert.equal(slugifyFilename("", "report"), "report");
});
