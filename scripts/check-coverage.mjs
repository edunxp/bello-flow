import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const COVERAGE_METRICS = [
  "lines",
  "statements",
  "functions",
  "branches",
];
export const COVERAGE_THRESHOLD = 90;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export const DEFAULT_REPORT_PATHS = {
  web: resolve(repositoryRoot, "apps/web/coverage/web/coverage-summary.json"),
  api: resolve(repositoryRoot, "apps/api/coverage/coverage-summary.json"),
};

export async function readCoverageReport(filePath) {
  let contents;

  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Coverage report not found: ${filePath}`, { cause: error });
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid coverage JSON: ${filePath}`, { cause: error });
  }
}

function validateCount(value, field, application, metric) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${application}.${metric}.${field} must be a non-negative safe integer`,
    );
  }
}

export function extractCoverageTotals(report, application) {
  if (
    !report ||
    typeof report !== "object" ||
    !report.total ||
    typeof report.total !== "object"
  ) {
    throw new Error(`${application} coverage report is missing total`);
  }

  return Object.fromEntries(
    COVERAGE_METRICS.map((metric) => {
      const values = report.total[metric];

      if (!values || typeof values !== "object") {
        throw new Error(
          `${application} coverage report is missing metric: ${metric}`,
        );
      }

      validateCount(values.covered, "covered", application, metric);
      validateCount(values.total, "total", application, metric);

      if (values.total === 0) {
        throw new Error(
          `${application}.${metric}.total must be greater than zero`,
        );
      }

      if (values.covered > values.total) {
        throw new Error(`${application}.${metric}.covered cannot exceed total`);
      }

      return [metric, { covered: values.covered, total: values.total }];
    }),
  );
}

export function percentage({ covered, total }) {
  if (total === 0) {
    throw new Error("Coverage total must be greater than zero");
  }

  return (covered / total) * 100;
}

export function evaluateCoverage(
  webReport,
  apiReport,
  threshold = COVERAGE_THRESHOLD,
) {
  if (
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 100
  ) {
    throw new Error("Coverage threshold must be a number between 0 and 100");
  }

  const applications = {
    web: extractCoverageTotals(webReport, "web"),
    api: extractCoverageTotals(apiReport, "api"),
  };
  const consolidated = {};
  const failures = [];

  for (const metric of COVERAGE_METRICS) {
    for (const application of ["web", "api"]) {
      const result = applications[application][metric];

      if (percentage(result) < threshold) {
        failures.push(`${application}.${metric}`);
      }
    }

    consolidated[metric] = {
      covered:
        applications.web[metric].covered + applications.api[metric].covered,
      total: applications.web[metric].total + applications.api[metric].total,
    };

    if (percentage(consolidated[metric]) < threshold) {
      failures.push(`consolidated.${metric}`);
    }
  }

  return {
    applications,
    consolidated,
    failures,
    passed: failures.length === 0,
    threshold,
  };
}

function formatResult(result) {
  return `${result.covered}/${result.total} (${percentage(result).toFixed(2)}%)`;
}

export function formatCoverageTable(evaluation) {
  const lines = [
    `Coverage threshold: ${evaluation.threshold}%`,
    "metric      web                 api                 consolidated",
  ];

  for (const metric of COVERAGE_METRICS) {
    lines.push(
      `${metric.padEnd(11)} ${formatResult(evaluation.applications.web[metric]).padEnd(19)} ${formatResult(evaluation.applications.api[metric]).padEnd(19)} ${formatResult(evaluation.consolidated[metric])}`,
    );
  }

  return lines.join("\n");
}

export async function runCoverageCheck(paths = DEFAULT_REPORT_PATHS) {
  const [webReport, apiReport] = await Promise.all([
    readCoverageReport(paths.web),
    readCoverageReport(paths.api),
  ]);
  const evaluation = evaluateCoverage(webReport, apiReport);

  console.log(formatCoverageTable(evaluation));

  if (!evaluation.passed) {
    throw new Error(
      `Coverage below threshold: ${evaluation.failures.join(", ")}`,
    );
  }

  return evaluation;
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPoint === import.meta.url) {
  runCoverageCheck().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
