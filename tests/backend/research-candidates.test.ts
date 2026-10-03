import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  preferredCityCandidateLeads,
  preferredCityInventoryQueries,
} from "../../server/explanation/research-candidates.ts";

const mechanical = getDisciplineCatalog().items.find(
  (item) => item.code === "0855",
)!;
test("preferred city discovery retains official school leads independent of model hints without asserting programme or campus facts", () => {
  const leads = preferredCityCandidateLeads(["杭州市", "杭州"], [mechanical]);
  assert.equal(
    leads.filter((lead) => lead.school === "杭州电子科技大学").length,
    1,
  );
  assert.ok(
    leads.every(
      (lead) =>
        lead.discoveryOnly &&
        lead.checkedAt &&
        lead.provenanceUrl.startsWith("https://"),
    ),
  );
  assert.deepEqual(leads[0].disciplineCodes, ["0855"]);
  assert.equal("programName" in leads[0], false);
  assert.equal("examSubjects" in leads[0], false);
  assert.equal("campus" in leads[0], false);
  assert.deepEqual(preferredCityCandidateLeads(["西安"], [mechanical]), []);
});
test("all preferred cities receive deterministic live inventory queries when the seed registry has no entry", () => {
  assert.deepEqual(preferredCityInventoryQueries(["西安市", "杭州", "西安"]), [
    { city: "西安", question: "西安 硕士研究生 招生单位 招生专业目录" },
    { city: "杭州", question: "杭州 硕士研究生 招生单位 招生专业目录" },
  ]);
});
