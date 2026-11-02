import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  COVERAGE_METRICS,
  evaluateCoverage,
  extractCoverageTotals,
  percentage,
  readCoverageReport,
} from "./check-coverage.mjs";

const temporaryDirectories = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true })),
  );
});

function report(overrides = {}) {
  return {
    total: Object.fromEntries(
      COVERAGE_METRICS.map((metric) => [
        metric,
        {
          covered: 90,
          total: 100,
          ...overrides[metric],
        },
      ]),
    ),
  };
}

test("calcula cobertura consolidada ponderada para conjuntos de tamanhos diferentes", () => {
  const web = report({ lines: { covered: 9, total: 10 } });
  const api = report({ lines: { covered: 999, total: 1000 } });
  const evaluation = evaluateCoverage(web, api);

  assert.deepEqual(evaluation.consolidated.lines, {
    covered: 1008,
    total: 1010,
  });
  assert.equal(percentage(evaluation.consolidated.lines), (1008 / 1010) * 100);
});

test("não utiliza média simples das porcentagens", () => {
  const web = report({ lines: { covered: 9, total: 10 } });
  const api = report({ lines: { covered: 999, total: 1000 } });
  const evaluation = evaluateCoverage(web, api);
  const simpleAverage = (90 + 99.9) / 2;

  assert.notEqual(percentage(evaluation.consolidated.lines), simpleAverage);
});

test("reprova uma aplicação abaixo do limite mesmo quando o consolidado passa", () => {
  const web = report({ lines: { covered: 8, total: 10 } });
  const api = report({ lines: { covered: 1000, total: 1000 } });
  const evaluation = evaluateCoverage(web, api);

  assert.ok(percentage(evaluation.consolidated.lines) >= 90);
  assert.equal(evaluation.passed, false);
  assert.deepEqual(evaluation.failures, ["web.lines"]);
});

test("reprova qualquer métrica abaixo do limite", () => {
  const evaluation = evaluateCoverage(
    report({ branches: { covered: 89, total: 100 } }),
    report(),
  );

  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.failures.includes("web.branches"));
  assert.ok(evaluation.failures.includes("consolidated.branches"));
});

test("rejeita total zero", () => {
  assert.throws(
    () =>
      extractCoverageTotals(
        report({ functions: { covered: 0, total: 0 } }),
        "web",
      ),
    /total must be greater than zero/,
  );
});

test("rejeita métrica ausente", () => {
  const incompleteReport = report();
  delete incompleteReport.total.statements;

  assert.throws(
    () => extractCoverageTotals(incompleteReport, "web"),
    /missing metric: statements/,
  );
});

test("rejeita relatório inexistente e JSON inválido", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bello-coverage-"));
  temporaryDirectories.push(directory);
  const invalidPath = join(directory, "invalid.json");
  await writeFile(invalidPath, "{invalid", "utf8");

  await assert.rejects(
    readCoverageReport(join(directory, "missing.json")),
    /Coverage report not found/,
  );
  await assert.rejects(
    readCoverageReport(invalidPath),
    /Invalid coverage JSON/,
  );
});

test("rejeita valores inconsistentes", () => {
  assert.throws(
    () =>
      extractCoverageTotals(
        report({ lines: { covered: 101, total: 100 } }),
        "api",
      ),
    /covered cannot exceed total/,
  );
  assert.throws(
    () =>
      extractCoverageTotals(
        report({ lines: { covered: -1, total: 100 } }),
        "api",
      ),
    /non-negative safe integer/,
  );
  assert.throws(
    () =>
      extractCoverageTotals(
        report({ lines: { covered: 89.5, total: 100 } }),
        "api",
      ),
    /non-negative safe integer/,
  );
});

test("compara o limite sem arredondar a porcentagem", () => {
  const evaluation = evaluateCoverage(
    report({ lines: { covered: 899999, total: 1000000 } }),
    report({ lines: { covered: 90, total: 100 } }),
  );

  assert.equal(percentage(evaluation.applications.web.lines), 89.9999);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.failures.includes("web.lines"));
});
