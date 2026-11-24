import assert from "node:assert/strict";
import test from "node:test";
import { parseRosterCsv } from "../src/lib/rosterCsv.ts";

test("parseRosterCsv parses quoted Last, First names, IDs, classes, and LRN", () => {
  const csv = [
    "Name,Student ID,Class,LRN",
    '"Lovelace, Ada",1001,10-Rizal,LRN-01',
    "Juan Dela Cruz,1002,10-Bonifacio,LRN-02",
  ].join("\n");

  const parsed = parseRosterCsv(csv);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], {
    firstName: "Ada",
    lastName: "Lovelace",
    studentCode: "1001",
    className: "10-Rizal",
    externalRef: "LRN-01",
  });
  assert.deepEqual(parsed.rows[1], {
    firstName: "Juan Dela",
    lastName: "Cruz",
    studentCode: "1002",
    className: "10-Bonifacio",
    externalRef: "LRN-02",
  });
});

test("parseRosterCsv supports separate First Name / Last Name columns and quoted escapes", () => {
  const csv = [
    "First Name,Last Name,Code,Class",
    'Grace,"O""Connor",2001,11-STEM',
  ].join("\r\n");

  const parsed = parseRosterCsv(csv);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].firstName, "Grace");
  assert.equal(parsed.rows[0].lastName, 'O"Connor');
  assert.equal(parsed.rows[0].studentCode, "2001");
  assert.equal(parsed.rows[0].className, "11-STEM");
});
