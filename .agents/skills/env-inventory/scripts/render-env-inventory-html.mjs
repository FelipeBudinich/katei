#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HTML_REPORT_RELATIVE = path.join("docs", "env-inventory.html");

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function normalizePath(value) {
  return toPosixPath(path.normalize(String(value || "")));
}

function compareStrings(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortUnique(values) {
  return Array.from(new Set(ensureArray(values).filter(Boolean).map((value) => String(value)))).sort(compareStrings);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function titleCase(value) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeOccurrence(entry) {
  return `${entry.file}:${entry.line}`;
}

function deriveVariableMeta(variable) {
  const definitions = ensureArray(variable.definitions);
  const usages = ensureArray(variable.usages);
  const hasFallback = usages.some((usage) => usage.kind === "default");
  const missingExample = usages.length > 0 && !definitions.some((definition) => definition.kind === "envFile" || definition.kind === "doc");
  const scopes = sortUnique([
    ...definitions.map((definition) => definition.scope),
    ...usages.map((usage) => usage.scope),
  ]);
  const definitionKinds = sortUnique(definitions.map((definition) => definition.kind));
  const usageKinds = sortUnique(usages.map((usage) => usage.kind));
  const firstUsage = usages[0] || null;

  return {
    ...variable,
    definitions,
    usages,
    hasFallback,
    likelyRequired: !hasFallback,
    missingExample,
    scopes,
    definitionKinds,
    usageKinds,
    firstUsage,
  };
}

function sortVariableMeta(left, right) {
  if (left.secretLike !== right.secretLike) {
    return left.secretLike ? -1 : 1;
  }
  if (left.missingExample !== right.missingExample) {
    return left.missingExample ? -1 : 1;
  }
  if (left.usages.length !== right.usages.length) {
    return right.usages.length - left.usages.length;
  }
  if (left.definitions.length !== right.definitions.length) {
    return right.definitions.length - left.definitions.length;
  }
  return compareStrings(left.name, right.name);
}

function cardState(value, mode) {
  if (mode === "problem") {
    return value > 0 ? "problem" : "good";
  }
  if (mode === "warning") {
    return value > 0 ? "warning" : "good";
  }
  return "good";
}

function buildDerived(report) {
  const variables = ensureArray(report.variables).map(deriveVariableMeta);
  const required = variables.filter((variable) => variable.likelyRequired).sort(sortVariableMeta);
  const optional = variables.filter((variable) => !variable.likelyRequired).sort(sortVariableMeta);
  const missingExample = variables.filter((variable) => variable.missingExample).sort(sortVariableMeta);
  const variableScopes = sortUnique(variables.flatMap((variable) => variable.scopes));

  return {
    variables,
    required,
    optional,
    missingExample,
    variableScopes,
    withFallbackCount: optional.length,
    likelyRequiredCount: required.length,
  };
}

function renderWarningBanner(report) {
  if (report.scan?.config?.exists !== false) {
    return "";
  }
  return `
    <section class="warning-banner">
      <strong>Config warning:</strong> Repo config file was not found. Built-in defaults were used.
    </section>
  `;
}

function statusCards(report, derived) {
  return [
    { label: "Variables", value: report.summary.totalVariables, mode: "good" },
    { label: "Definitions", value: report.summary.totalDefinitions, mode: "good" },
    { label: "Usages", value: report.summary.totalUsages, mode: "good" },
    { label: "Likely required", value: derived.likelyRequiredCount, mode: "warning" },
    { label: "Fallbacks observed", value: derived.withFallbackCount, mode: "good" },
    { label: "Missing example/docs", value: derived.missingExample.length, mode: "warning" },
    { label: "Secret-like", value: report.summary.secretLikeCount, mode: "good" },
    { label: "Public-like", value: report.summary.publicLikeCount, mode: "good" },
    { label: "Dynamic access", value: report.summary.dynamicAccessCount, mode: "warning" },
  ];
}

function renderStatusCards(report, derived) {
  return statusCards(report, derived)
    .map((card) => `
      <article class="status-card status-card--${cardState(card.value, card.mode)}">
        <div class="status-card__label">${escapeHtml(card.label)}</div>
        <div class="status-card__value">${escapeHtml(card.value)}</div>
      </article>
    `)
    .join("");
}

function renderPills(variable) {
  const pills = [];
  pills.push(variable.likelyRequired
    ? '<span class="pill pill--warning">Likely required</span>'
    : '<span class="pill pill--good">Fallback observed</span>');
  if (variable.secretLike) {
    pills.push('<span class="pill pill--problem">Secret-like</span>');
  }
  if (variable.publicLike) {
    pills.push('<span class="pill pill--accent">Public-like</span>');
  }
  if (variable.missingExample) {
    pills.push('<span class="pill pill--warning">Missing example/docs</span>');
  }
  for (const scope of variable.scopes) {
    pills.push(`<span class="pill">${escapeHtml(titleCase(scope))}</span>`);
  }
  return pills.join("");
}

function renderOccurrenceList(entries, { includeSnippet = false } = {}) {
  if (!entries.length) {
    return '<p class="empty-state">None recorded.</p>';
  }
  return `
    <ul class="occurrence-list">
      ${entries.map((entry) => `
        <li>
          <div class="occurrence-list__top">
            <code>${escapeHtml(summarizeOccurrence(entry))}</code>
            <span class="occurrence-meta">${escapeHtml(titleCase(entry.kind))} · ${escapeHtml(titleCase(entry.scope))}</span>
          </div>
          ${includeSnippet && entry.snippet ? `<div class="occurrence-snippet"><code>${escapeHtml(entry.snippet)}</code></div>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderVariableCard(variable) {
  return `
    <details class="variable-card" data-env-variable-card="${escapeHtml(variable.name)}" data-variable-status="${variable.likelyRequired ? "required" : "optional"}">
      <summary>
        <div class="variable-card__summary">
          <div>
            <h3>${escapeHtml(variable.name)}</h3>
            <div class="pill-row">${renderPills(variable)}</div>
          </div>
          <div class="variable-card__counts">
            <span><strong>${variable.definitions.length}</strong> defs</span>
            <span><strong>${variable.usages.length}</strong> uses</span>
          </div>
        </div>
      </summary>
      <div class="variable-card__body">
        <div class="variable-meta-grid">
          <div>
            <strong>Definition kinds</strong>
            <div>${variable.definitionKinds.length ? escapeHtml(variable.definitionKinds.map(titleCase).join(", ")) : "None"}</div>
          </div>
          <div>
            <strong>Usage kinds</strong>
            <div>${variable.usageKinds.length ? escapeHtml(variable.usageKinds.map(titleCase).join(", ")) : "None"}</div>
          </div>
          <div>
            <strong>Primary usage</strong>
            <div>${variable.firstUsage ? `<code>${escapeHtml(variable.firstUsage.file)}:${escapeHtml(variable.firstUsage.line)}</code>` : "None"}</div>
          </div>
        </div>
        <div class="split-grid">
          <section>
            <h4>Definitions</h4>
            ${renderOccurrenceList(variable.definitions)}
          </section>
          <section>
            <h4>Usages</h4>
            ${renderOccurrenceList(variable.usages, { includeSnippet: true })}
          </section>
        </div>
      </div>
    </details>
  `;
}

function renderVariableGroup(title, description, variables, groupKey) {
  if (!variables.length) {
    return "";
  }
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="variable-grid" data-env-group="${escapeHtml(groupKey)}">
        ${variables.map((variable) => renderVariableCard(variable)).join("")}
      </div>
    </section>
  `;
}

function renderCoverageGaps(derived) {
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>Coverage gaps</h2>
        <p>Variables with usages but no observed <code>.env*</code> or docs/example definition.</p>
      </div>
      ${derived.missingExample.length
        ? `
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Variable</th>
                <th scope="col">Usages</th>
                <th scope="col">Example usage</th>
              </tr>
            </thead>
            <tbody>
              ${derived.missingExample.map((variable) => `
                <tr data-gap-row="${escapeHtml(variable.name)}">
                  <td><code>${escapeHtml(variable.name)}</code></td>
                  <td>${escapeHtml(variable.usages.length)}</td>
                  <td><code>${escapeHtml(variable.firstUsage ? summarizeOccurrence(variable.firstUsage) : "—")}</code></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : '<p class="empty-state">No example or docs gaps detected from the current report.</p>'}
    </section>
  `;
}

function renderDynamicAccesses(report) {
  const dynamicAccesses = ensureArray(report.dynamicAccesses);
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>Dynamic env access</h2>
        <p>These accesses could not be resolved to a concrete variable name statically.</p>
      </div>
      ${dynamicAccesses.length
        ? `
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Location</th>
                <th scope="col">Scope</th>
                <th scope="col">Reason</th>
                <th scope="col">Snippet</th>
              </tr>
            </thead>
            <tbody>
              ${dynamicAccesses.map((entry) => `
                <tr data-dynamic-row="${escapeHtml(entry.file)}:${escapeHtml(entry.line)}">
                  <td><code>${escapeHtml(entry.file)}:${escapeHtml(entry.line)}</code></td>
                  <td>${escapeHtml(titleCase(entry.scope))}</td>
                  <td>${escapeHtml(entry.reason)}</td>
                  <td><code>${escapeHtml(entry.snippet || "")}</code></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : '<p class="empty-state">No dynamic env access recorded.</p>'}
    </section>
  `;
}

function renderExplorer(report, derived) {
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>Variable explorer</h2>
        <p>Search and filter the inventory without leaving the static report.</p>
      </div>
      <div id="variable-controls" class="variable-controls">
        <label>
          Search
          <input id="variable-search" type="search" placeholder="Search variable names, files, snippets">
        </label>
        <label>
          Status
          <select id="variable-status">
            <option value="">All</option>
            <option value="required">Likely required</option>
            <option value="optional">Fallback observed</option>
            <option value="missing-example">Missing example/docs</option>
            <option value="secret-like">Secret-like</option>
            <option value="public-like">Public-like</option>
          </select>
        </label>
        <label>
          Scope
          <select id="variable-scope">
            <option value="">All</option>
            ${derived.variableScopes.map((scope) => `<option value="${escapeHtml(scope)}">${escapeHtml(titleCase(scope))}</option>`).join("")}
          </select>
        </label>
        <div class="variable-controls__actions">
          <button id="variable-reset" type="button">Reset</button>
          <div id="variable-filter-summary" class="filter-summary">Showing all variables</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col">Status</th>
              <th scope="col">Definitions</th>
              <th scope="col">Usages</th>
              <th scope="col">Scopes</th>
              <th scope="col">Example location</th>
            </tr>
          </thead>
          <tbody id="variable-table-body">
            ${derived.variables.length
              ? derived.variables.map((variable) => `
                <tr>
                  <td><code>${escapeHtml(variable.name)}</code></td>
                  <td>${variable.likelyRequired ? "Likely required" : "Fallback observed"}</td>
                  <td>${escapeHtml(variable.definitions.length)}</td>
                  <td>${escapeHtml(variable.usages.length)}</td>
                  <td>${escapeHtml(variable.scopes.join(", ") || "—")}</td>
                  <td><code>${escapeHtml(variable.firstUsage ? summarizeOccurrence(variable.firstUsage) : (variable.definitions[0] ? summarizeOccurrence(variable.definitions[0]) : "—"))}</code></td>
                </tr>
              `).join("")
              : '<tr><td colspan="6" class="empty-state-cell">No variables recorded.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderScanDetails(report) {
  const roots = report.scan?.roots || {};
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>Scan details</h2>
        <p>Grounded scan roots and raw metadata for auditability.</p>
      </div>
      <div class="split-grid">
        <section>
          <h4>App roots</h4>
          ${ensureArray(roots.app).length
            ? `<ul class="simple-list">${ensureArray(roots.app).map((entry) => `<li><code>${escapeHtml(entry)}</code></li>`).join("")}</ul>`
            : '<p class="empty-state">None</p>'}
        </section>
        <section>
          <h4>Package roots</h4>
          ${ensureArray(roots.package).length
            ? `<ul class="simple-list">${ensureArray(roots.package).map((entry) => `<li><code>${escapeHtml(entry)}</code></li>`).join("")}</ul>`
            : '<p class="empty-state">None</p>'}
        </section>
        <section>
          <h4>Root-level config roots</h4>
          ${ensureArray(roots.root).length
            ? `<ul class="simple-list">${ensureArray(roots.root).map((entry) => `<li><code>${escapeHtml(entry)}</code></li>`).join("")}</ul>`
            : '<p class="empty-state">None</p>'}
        </section>
      </div>
      ${ensureArray(report.scanWarnings).length
        ? `
          <section class="scan-warning-list">
            <h4>Scan warnings</h4>
            <ul class="simple-list">
              ${ensureArray(report.scanWarnings).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}
            </ul>
          </section>
        `
        : ""}
      <details>
        <summary>Raw JSON metadata</summary>
        <pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
      </details>
    </section>
  `;
}

function renderClientScript(report) {
  return `
    <script id="env-inventory-report-data" type="application/json">${escapeJsonForScript(report)}</script>
    <script>
      (() => {
        const report = JSON.parse(document.getElementById("env-inventory-report-data").textContent);

        function ensureArray(value) {
          return Array.isArray(value) ? value : [];
        }

        function sortUnique(values) {
          return Array.from(new Set(ensureArray(values).filter(Boolean).map((value) => String(value)))).sort((left, right) => left.localeCompare(right));
        }

        function derive(variable) {
          const definitions = ensureArray(variable.definitions);
          const usages = ensureArray(variable.usages);
          const hasFallback = usages.some((usage) => usage.kind === "default");
          const missingExample = usages.length > 0 && !definitions.some((definition) => definition.kind === "envFile" || definition.kind === "doc");
          const scopes = sortUnique([
            ...definitions.map((definition) => definition.scope),
            ...usages.map((usage) => usage.scope),
          ]);
          return {
            ...variable,
            definitions,
            usages,
            scopes,
            hasFallback,
            likelyRequired: !hasFallback,
            missingExample,
            firstUsage: usages[0] || null,
            searchBlob: [
              variable.name,
              ...definitions.map((definition) => definition.file),
              ...usages.map((usage) => usage.file),
              ...usages.map((usage) => usage.snippet || ""),
            ].join(" ").toLowerCase(),
          };
        }

        const variables = ensureArray(report.variables).map(derive);
        const state = {
          search: "",
          status: "",
          scope: "",
        };

        const controls = {
          search: document.getElementById("variable-search"),
          status: document.getElementById("variable-status"),
          scope: document.getElementById("variable-scope"),
          reset: document.getElementById("variable-reset"),
          summary: document.getElementById("variable-filter-summary"),
          body: document.getElementById("variable-table-body"),
        };

        function escapeHtml(value) {
          return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function summarizeLocation(variable) {
          const entry = variable.firstUsage || variable.definitions[0];
          if (!entry) {
            return "—";
          }
          return entry.file + ":" + entry.line;
        }

        function matchesStatus(variable) {
          if (!state.status) {
            return true;
          }
          if (state.status === "required") {
            return variable.likelyRequired;
          }
          if (state.status === "optional") {
            return !variable.likelyRequired;
          }
          if (state.status === "missing-example") {
            return variable.missingExample;
          }
          if (state.status === "secret-like") {
            return Boolean(variable.secretLike);
          }
          if (state.status === "public-like") {
            return Boolean(variable.publicLike);
          }
          return true;
        }

        function visibleVariables() {
          const search = state.search.trim().toLowerCase();
          return variables
            .filter((variable) => {
              if (search && !variable.searchBlob.includes(search)) {
                return false;
              }
              if (!matchesStatus(variable)) {
                return false;
              }
              if (state.scope && !variable.scopes.includes(state.scope)) {
                return false;
              }
              return true;
            })
            .sort((left, right) => left.name.localeCompare(right.name));
        }

        function renderTable() {
          const visible = visibleVariables();
          controls.summary.textContent = visible.length === variables.length
            ? "Showing all variables"
            : "Showing " + visible.length + " of " + variables.length + " variables";

          if (!visible.length) {
            controls.body.innerHTML = '<tr><td colspan="6" class="empty-state-cell">No variables match the current filters.</td></tr>';
            return;
          }

          controls.body.innerHTML = visible.map((variable) => [
            "<tr>",
            "<td><code>" + escapeHtml(variable.name) + "</code></td>",
            "<td>" + (variable.likelyRequired ? "Likely required" : "Fallback observed") + "</td>",
            "<td>" + variable.definitions.length + "</td>",
            "<td>" + variable.usages.length + "</td>",
            "<td>" + escapeHtml(variable.scopes.join(", ") || "—") + "</td>",
            "<td><code>" + escapeHtml(summarizeLocation(variable)) + "</code></td>",
            "</tr>"
          ].join("")).join("");
        }

        function updateState() {
          state.search = controls.search.value;
          state.status = controls.status.value;
          state.scope = controls.scope.value;
        }

        controls.search.addEventListener("input", () => {
          updateState();
          renderTable();
        });
        controls.status.addEventListener("change", () => {
          updateState();
          renderTable();
        });
        controls.scope.addEventListener("change", () => {
          updateState();
          renderTable();
        });
        controls.reset.addEventListener("click", () => {
          state.search = "";
          state.status = "";
          state.scope = "";
          controls.search.value = "";
          controls.status.value = "";
          controls.scope.value = "";
          renderTable();
        });

        renderTable();
      })();
    </script>
  `;
}

export function renderEnvInventoryHtml(report, { htmlOutputPath = "" } = {}) {
  const htmlPath = htmlOutputPath || normalizePath(path.join(report.app.path, HTML_REPORT_RELATIVE));
  const derived = buildDerived(report);
  const pageTitle = `Env inventory · ${report.app.name}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(pageTitle)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --text: #172033;
        --muted: #5b6476;
        --line: #d7deea;
        --good: #0f766e;
        --warning: #b45309;
        --problem: #b91c1c;
        --accent: #3554c5;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
        line-height: 1.45;
      }
      code, pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      .page {
        max-width: 1440px;
        margin: 0 auto;
        padding: 24px;
      }
      .page-header h1 {
        margin: 0 0 8px;
        font-size: 2rem;
      }
      .meta-grid,
      .status-grid,
      .split-grid,
      .variable-grid {
        display: grid;
        gap: 12px;
      }
      .meta-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        margin-top: 16px;
      }
      .status-grid {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        margin: 20px 0;
      }
      .split-grid {
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }
      .variable-grid {
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }
      .meta-item,
      .status-card,
      .panel,
      .variable-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: 0 8px 30px rgba(23, 32, 51, 0.05);
      }
      .meta-item,
      .status-card,
      .panel {
        padding: 16px;
      }
      .meta-item__label,
      .status-card__label,
      .filter-summary,
      .panel__header p,
      .empty-state,
      .occurrence-meta {
        color: var(--muted);
      }
      .meta-item__label,
      .status-card__label {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .status-card__value {
        margin-top: 10px;
        font-size: 1.7rem;
        font-weight: 700;
      }
      .status-card--good { border-left: 5px solid var(--good); }
      .status-card--warning { border-left: 5px solid var(--warning); }
      .status-card--problem { border-left: 5px solid var(--problem); }
      .warning-banner {
        margin: 16px 0 20px;
        padding: 14px 16px;
        background: rgba(180, 83, 9, 0.08);
        border: 1px solid rgba(180, 83, 9, 0.25);
        border-radius: 12px;
        color: var(--warning);
      }
      .panel__header {
        margin-bottom: 14px;
      }
      .panel__header h2,
      .variable-card h3,
      .variable-card h4 {
        margin: 0 0 6px;
      }
      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(23, 32, 51, 0.08);
        font-size: 0.82rem;
      }
      .pill--good {
        background: rgba(15, 118, 110, 0.12);
        color: var(--good);
      }
      .pill--warning {
        background: rgba(180, 83, 9, 0.12);
        color: var(--warning);
      }
      .pill--problem {
        background: rgba(185, 28, 28, 0.12);
        color: var(--problem);
      }
      .pill--accent {
        background: rgba(53, 84, 197, 0.12);
        color: var(--accent);
      }
      .variable-card {
        padding: 0;
        overflow: hidden;
      }
      .variable-card summary {
        list-style: none;
        cursor: pointer;
        padding: 16px;
      }
      .variable-card summary::-webkit-details-marker {
        display: none;
      }
      .variable-card__summary {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .variable-card__counts {
        min-width: 90px;
        display: grid;
        gap: 4px;
        justify-items: end;
        font-size: 0.88rem;
        color: var(--muted);
      }
      .variable-card__body {
        border-top: 1px solid var(--line);
        padding: 16px;
      }
      .variable-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }
      .occurrence-list,
      .simple-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 10px;
      }
      .occurrence-list li {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
      }
      .occurrence-list__top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
      }
      .occurrence-snippet {
        margin-top: 8px;
      }
      .occurrence-snippet code,
      pre {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .variable-controls {
        position: sticky;
        top: 0;
        z-index: 3;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        padding: 14px;
        margin-bottom: 14px;
        background: rgba(245, 247, 251, 0.96);
        backdrop-filter: blur(10px);
        border: 1px solid var(--line);
        border-radius: 12px;
      }
      .variable-controls label {
        display: grid;
        gap: 6px;
        font-size: 0.88rem;
        color: var(--muted);
      }
      .variable-controls input,
      .variable-controls select,
      .variable-controls button {
        min-height: 38px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--text);
      }
      .variable-controls__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 10px;
      }
      .table-wrap {
        overflow: auto;
      }
      .data-table {
        width: 100%;
        border-collapse: collapse;
      }
      .data-table th,
      .data-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
        text-align: left;
      }
      .data-table thead th {
        position: sticky;
        top: 0;
        background: var(--panel);
      }
      .empty-state-cell {
        text-align: center;
        color: var(--muted);
        padding: 20px;
      }
      details pre {
        overflow: auto;
        padding: 12px;
        background: #0f172a;
        color: #e5eefc;
        border-radius: 12px;
      }
      @media (max-width: 900px) {
        .page {
          padding: 16px;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="page-header">
        <h1>Env inventory report · ${escapeHtml(report.app.name)}</h1>
        <p>Static, app-local HTML built from the machine-readable JSON source of truth.</p>
        ${renderWarningBanner(report)}
        <div class="meta-grid">
          <article class="meta-item">
            <div class="meta-item__label">App root</div>
            <div class="meta-item__value"><code>${escapeHtml(report.app.path)}</code></div>
          </article>
          <article class="meta-item">
            <div class="meta-item__label">JSON report path</div>
            <div class="meta-item__value"><code>${escapeHtml(report.app.outputPath)}</code></div>
          </article>
          <article class="meta-item">
            <div class="meta-item__label">HTML report path</div>
            <div class="meta-item__value"><code>${escapeHtml(htmlPath)}</code></div>
          </article>
          <article class="meta-item">
            <div class="meta-item__label">Config path</div>
            <div class="meta-item__value"><code>${escapeHtml(report.scan?.config?.path || ".agents/env-inventory.config.json")}</code></div>
          </article>
          <article class="meta-item">
            <div class="meta-item__label">Config found</div>
            <div class="meta-item__value">${escapeHtml(report.scan?.config?.exists ? "yes" : "no")}</div>
          </article>
        </div>
      </header>

      <section class="status-grid">
        ${renderStatusCards(report, derived)}
      </section>

      <main class="split-grid">
        <section class="panel">
          <div class="panel__header">
            <h2>Inventory model</h2>
            <p>Required vs optional is inferred from observed fallback usage. Variables with a <code>default</code> usage are treated as optional for this report.</p>
          </div>
          <div class="pill-row">
            <span class="pill pill--warning">Likely required</span>
            <span class="pill pill--good">Fallback observed</span>
            <span class="pill pill--problem">Secret-like</span>
            <span class="pill pill--accent">Public-like</span>
          </div>
        </section>
        ${renderCoverageGaps(derived)}
      </main>

      ${renderVariableGroup("No fallback observed", "Variables with usages but no observed in-code fallback/default.", derived.required, "required")}
      ${renderVariableGroup("Fallbacks observed", "Variables where the report found an explicit default/fallback path.", derived.optional, "optional")}
      ${renderDynamicAccesses(report)}
      ${renderExplorer(report, derived)}
      ${renderScanDetails(report)}
    </div>
    ${renderClientScript(report)}
  </body>
</html>
`;
}

export async function loadEnvInventoryReport(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  return JSON.parse(raw);
}

export function defaultHtmlOutputForReport(report) {
  return normalizePath(path.join(report.app.path, HTML_REPORT_RELATIVE));
}

export async function writeEnvInventoryHtml({ repoRoot, report, outputPath }) {
  const relativeOutput = normalizePath(outputPath || defaultHtmlOutputForReport(report));
  const absoluteOutput = path.resolve(repoRoot, relativeOutput);
  const html = renderEnvInventoryHtml(report, { htmlOutputPath: relativeOutput });
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  await fs.writeFile(absoluteOutput, html, "utf8");
  return { html, outputPath: relativeOutput };
}

function parseCliArgs(argv) {
  const options = {
    input: "",
    output: "",
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--input") {
      options.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--output") {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--check") {
      options.check = true;
      continue;
    }
    if (current === "--help" || current === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node .agents/skills/env-inventory/scripts/render-env-inventory-html.mjs --input apps/listings/doc/env-inventory.json",
    "  node .agents/skills/env-inventory/scripts/render-env-inventory-html.mjs --input apps/listings/doc/env-inventory.json --output apps/listings/docs/env-inventory.html",
    "",
    "Options:",
    "  --input <path>   Input JSON report path",
    "  --output <path>  Optional HTML output path (defaults to apps/<app>/docs/env-inventory.html)",
    "  --check          Verify HTML output is current without rewriting it",
  ].join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.input) {
    throw new Error("Pass --input <path>.");
  }

  const repoRoot = process.cwd();
  const absoluteInput = path.resolve(repoRoot, options.input);
  const report = await loadEnvInventoryReport(absoluteInput);
  const relativeOutput = normalizePath(options.output || defaultHtmlOutputForReport(report));
  const absoluteOutput = path.resolve(repoRoot, relativeOutput);
  const html = renderEnvInventoryHtml(report, { htmlOutputPath: relativeOutput });

  if (options.check) {
    let existing = "";
    try {
      existing = await fs.readFile(absoluteOutput, "utf8");
    } catch {
      existing = "";
    }
    if (existing !== html) {
      console.error(`[stale] ${relativeOutput}`);
      return 1;
    }
  } else {
    await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
    await fs.writeFile(absoluteOutput, html, "utf8");
  }

  console.log(`[env-inventory-html] ${relativeOutput}`);
  return 0;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  runCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
