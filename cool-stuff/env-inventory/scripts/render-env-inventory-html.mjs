#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HTML_REPORT_RELATIVE = path.join("docs", "env-inventory.html");
const NO_FALLBACK_LABEL = "No fallback observed";
const FALLBACK_LABEL = "Fallback observed";
const FALLBACKS_LABEL = "Fallbacks observed";

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

function renderInlineCode(value) {
  return `<code class="env-inventory-inline-code">${escapeHtml(value)}</code>`;
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

function fileBaseName(value) {
  return normalizePath(value).split("/").pop() || "";
}

function isEnvExampleDefinition(definition) {
  return definition?.kind === "envFile" && fileBaseName(definition.file) === ".env.example";
}

function deriveVariableMeta(variable) {
  const definitions = ensureArray(variable.definitions);
  const usages = ensureArray(variable.usages);
  const hasFallback = usages.some((usage) => usage.kind === "default");
  const missingExample = usages.length > 0 && !definitions.some(isEnvExampleDefinition);
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
    <div class="env-inventory-alert">
      <p class="text-sm leading-6 text-strong"><strong>Config warning:</strong> Config file was not found. Built-in defaults were used.</p>
    </div>
  `;
}

function statusCards(report, derived) {
  return [
    { label: "Variables", value: report.summary.totalVariables, mode: "good" },
    { label: "Definitions", value: report.summary.totalDefinitions, mode: "good" },
    { label: "Usages", value: report.summary.totalUsages, mode: "good" },
    { label: NO_FALLBACK_LABEL, value: derived.likelyRequiredCount, mode: "warning" },
    { label: FALLBACKS_LABEL, value: derived.withFallbackCount, mode: "good" },
    { label: "Missing example/docs", value: derived.missingExample.length, mode: "warning" },
    { label: "Secret-like", value: report.summary.secretLikeCount, mode: "good" },
    { label: "Public-like", value: report.summary.publicLikeCount, mode: "good" },
    { label: "Dynamic access", value: report.summary.dynamicAccessCount, mode: "warning" },
  ];
}

function renderStatusCards(report, derived) {
  return statusCards(report, derived)
    .map((card) => `
      <article class="paper-panel env-inventory-status-card env-inventory-status-card--${cardState(card.value, card.mode)}">
        <div class="env-inventory-status-label">${escapeHtml(card.label)}</div>
        <div class="env-inventory-status-value">${escapeHtml(card.value)}</div>
      </article>
    `)
    .join("");
}

function renderPills(variable) {
  const pills = [];
  pills.push(variable.likelyRequired
    ? `<span class="count-chip env-inventory-chip env-inventory-chip--warning">${NO_FALLBACK_LABEL}</span>`
    : `<span class="count-chip env-inventory-chip env-inventory-chip--good">${FALLBACK_LABEL}</span>`);
  if (variable.secretLike) {
    pills.push('<span class="count-chip env-inventory-chip env-inventory-chip--problem">Secret-like</span>');
  }
  if (variable.publicLike) {
    pills.push('<span class="count-chip env-inventory-chip env-inventory-chip--accent">Public-like</span>');
  }
  if (variable.missingExample) {
    pills.push('<span class="count-chip env-inventory-chip env-inventory-chip--warning">Missing example/docs</span>');
  }
  for (const scope of variable.scopes) {
    pills.push(`<span class="count-chip env-inventory-chip">${escapeHtml(titleCase(scope))}</span>`);
  }
  return pills.join("");
}

function renderOccurrenceList(entries, { includeSnippet = false } = {}) {
  if (!entries.length) {
    return '<p class="text-sm leading-6 text-muted">None recorded.</p>';
  }
  return `
    <ul class="env-inventory-occurrence-list">
      ${entries.map((entry) => `
        <li class="env-inventory-occurrence-item">
          <div class="env-inventory-occurrence-top">
            ${renderInlineCode(summarizeOccurrence(entry))}
            <span class="text-sm leading-6 text-muted">${escapeHtml(titleCase(entry.kind))} · ${escapeHtml(titleCase(entry.scope))}</span>
          </div>
          ${includeSnippet && (entry.comment || entry.snippet)
            ? `
              <div class="env-inventory-snippet">
                ${entry.comment ? `<div class="text-sm leading-6 text-muted">${escapeHtml(entry.comment)}</div>` : ""}
                ${entry.snippet ? renderInlineCode(entry.snippet) : ""}
              </div>
            `
            : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderVariableCard(variable) {
  return `
    <details class="paper-panel env-inventory-variable-card" data-env-variable-card="${escapeHtml(variable.name)}" data-variable-status="${variable.likelyRequired ? "required" : "optional"}">
      <summary>
        <div class="env-inventory-variable-summary">
          <div class="env-inventory-variable-heading">
            <h3 class="font-serif text-2xl text-strong env-inventory-variable-name">${escapeHtml(variable.name)}</h3>
            <div class="env-inventory-chip-row mt-3">${renderPills(variable)}</div>
          </div>
          <div class="env-inventory-variable-counts">
            <span class="count-chip env-inventory-chip"><strong>${variable.definitions.length}</strong>&nbsp;defs</span>
            <span class="count-chip env-inventory-chip"><strong>${variable.usages.length}</strong>&nbsp;uses</span>
          </div>
        </div>
      </summary>
      <div class="env-inventory-variable-body">
        <div class="env-inventory-variable-meta">
          <div class="space-y-2">
            <p class="field-label text-sm font-semibold">Definition kinds</p>
            <p class="text-sm leading-6 text-muted">${variable.definitionKinds.length ? escapeHtml(variable.definitionKinds.map(titleCase).join(", ")) : "None"}</p>
          </div>
          <div class="space-y-2">
            <p class="field-label text-sm font-semibold">Usage kinds</p>
            <p class="text-sm leading-6 text-muted">${variable.usageKinds.length ? escapeHtml(variable.usageKinds.map(titleCase).join(", ")) : "None"}</p>
          </div>
          <div class="space-y-2">
            <p class="field-label text-sm font-semibold">Primary usage</p>
            <div>${variable.firstUsage ? renderInlineCode(`${variable.firstUsage.file}:${variable.firstUsage.line}`) : '<p class="text-sm leading-6 text-muted">None</p>'}</div>
          </div>
        </div>
        <div class="env-inventory-split-grid">
          <section>
            <div class="env-inventory-section-header">
              <h4 class="font-serif text-2xl text-strong">Definitions</h4>
            </div>
            ${renderOccurrenceList(variable.definitions, { includeSnippet: true })}
          </section>
          <section>
            <div class="env-inventory-section-header">
              <h4 class="font-serif text-2xl text-strong">Usages</h4>
            </div>
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
    <section class="paper-panel env-inventory-panel">
      <div class="env-inventory-section-header">
        <h2 class="font-serif text-2xl text-strong">${escapeHtml(title)}</h2>
        <p class="text-sm leading-6 text-muted">${escapeHtml(description)}</p>
      </div>
      <div class="env-inventory-variable-grid" data-env-group="${escapeHtml(groupKey)}">
        ${variables.map((variable) => renderVariableCard(variable)).join("")}
      </div>
    </section>
  `;
}

function renderCoverageGaps(derived) {
  return `
    <section class="paper-panel env-inventory-panel">
      <div class="env-inventory-section-header">
        <h2 class="font-serif text-2xl text-strong">Coverage gaps</h2>
        <p class="text-sm leading-6 text-muted">Variables with usages but no observed ${renderInlineCode(".env.example")} definition.</p>
      </div>
      ${derived.missingExample.length
        ? `
          <div class="env-inventory-table-wrap">
            <table class="env-inventory-table">
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
                    <td>${renderInlineCode(variable.name)}</td>
                    <td>${escapeHtml(variable.usages.length)}</td>
                    <td>${renderInlineCode(variable.firstUsage ? summarizeOccurrence(variable.firstUsage) : "—")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        : '<p class="text-sm leading-6 text-muted">No example or docs gaps detected from the current report.</p>'}
    </section>
  `;
}

function renderDynamicAccesses(report) {
  const dynamicAccesses = ensureArray(report.dynamicAccesses);
  return `
    <section class="paper-panel env-inventory-panel">
      <div class="env-inventory-section-header">
        <h2 class="font-serif text-2xl text-strong">Dynamic env access</h2>
        <p class="text-sm leading-6 text-muted">These accesses could not be resolved to a concrete variable name statically.</p>
      </div>
      ${dynamicAccesses.length
        ? `
          <div class="env-inventory-table-wrap">
            <table class="env-inventory-table">
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
                    <td>${renderInlineCode(`${entry.file}:${entry.line}`)}</td>
                    <td>${escapeHtml(titleCase(entry.scope))}</td>
                    <td>${escapeHtml(entry.reason)}</td>
                    <td>${renderInlineCode(entry.snippet || "")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        : '<p class="text-sm leading-6 text-muted">No dynamic env access recorded.</p>'}
    </section>
  `;
}

function renderExplorer(report, derived) {
  return `
    <section id="variable-explorer" class="paper-panel env-inventory-panel">
      <div class="env-inventory-section-header">
        <h2 class="font-serif text-2xl text-strong">Variable explorer</h2>
        <p class="text-sm leading-6 text-muted">Search and filter the inventory without leaving the static report.</p>
      </div>
      <div id="variable-controls" class="env-inventory-controls">
        <label class="env-inventory-field">
          <span class="field-label text-sm font-semibold">Search</span>
          <input id="variable-search" class="field-control" type="search" placeholder="Search variable names, files, snippets">
        </label>
        <label class="env-inventory-field">
          <span class="field-label text-sm font-semibold">Status</span>
          <select id="variable-status" class="field-control">
            <option value="">All</option>
            <option value="required">${NO_FALLBACK_LABEL}</option>
            <option value="optional">${FALLBACK_LABEL}</option>
            <option value="missing-example">Missing example/docs</option>
            <option value="secret-like">Secret-like</option>
            <option value="public-like">Public-like</option>
          </select>
        </label>
        <label class="env-inventory-field">
          <span class="field-label text-sm font-semibold">Scope</span>
          <select id="variable-scope" class="field-control">
            <option value="">All</option>
            ${derived.variableScopes.map((scope) => `<option value="${escapeHtml(scope)}">${escapeHtml(titleCase(scope))}</option>`).join("")}
          </select>
        </label>
        <div class="env-inventory-control-actions">
          <button id="variable-reset" class="touch-button-secondary" type="button">Reset</button>
          <div id="variable-filter-summary" class="text-sm leading-6 text-muted">Showing all variables</div>
        </div>
      </div>
      <div class="env-inventory-table-wrap">
        <table class="env-inventory-table">
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
          <tbody id="variable-table-body" class="text-sm leading-6">
            ${derived.variables.length
              ? derived.variables.map((variable) => `
                <tr>
                  <td>${renderInlineCode(variable.name)}</td>
                  <td>${variable.likelyRequired ? NO_FALLBACK_LABEL : FALLBACK_LABEL}</td>
                  <td>${escapeHtml(variable.definitions.length)}</td>
                  <td>${escapeHtml(variable.usages.length)}</td>
                  <td>${escapeHtml(variable.scopes.join(", ") || "—")}</td>
                  <td>${renderInlineCode(variable.firstUsage ? summarizeOccurrence(variable.firstUsage) : (variable.definitions[0] ? summarizeOccurrence(variable.definitions[0]) : "—"))}</td>
                </tr>
              `).join("")
              : '<tr><td colspan="6" class="env-inventory-empty-state-cell">No variables recorded.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRawBlock(content, { id, label = "Copy" } = {}) {
  const rawId = escapeHtml(id);
  const buttonLabel = escapeHtml(label);
  return `
    <div class="env-inventory-raw-block">
      <div class="env-inventory-raw-actions">
        <button
          type="button"
          class="touch-button-secondary"
          data-copy-raw
          data-copy-target="${rawId}"
          data-copy-label-default="${buttonLabel}"
          data-copy-label-success="Copied"
          data-copy-label-error="Copy unavailable"
        >${buttonLabel}</button>
      </div>
      <pre id="${rawId}" class="env-inventory-raw text-sm leading-6" data-copy-source>${escapeHtml(content)}</pre>
    </div>
  `;
}

function renderScanDetails(report) {
  const roots = report.scan?.roots || {};
  return `
    <section id="scan-details" class="paper-panel env-inventory-panel">
      <div class="env-inventory-section-header">
        <h2 class="font-serif text-2xl text-strong">Scan details</h2>
        <p class="text-sm leading-6 text-muted">Grounded scan roots and raw metadata for auditability.</p>
      </div>
      <div class="env-inventory-split-grid">
        <section>
          <div class="env-inventory-section-header">
            <h4 class="font-serif text-2xl text-strong">App roots</h4>
          </div>
          ${ensureArray(roots.app).length
            ? `<ul class="env-inventory-simple-list">${ensureArray(roots.app).map((entry) => `<li>${renderInlineCode(entry)}</li>`).join("")}</ul>`
            : '<p class="text-sm leading-6 text-muted">None</p>'}
        </section>
        <section>
          <div class="env-inventory-section-header">
            <h4 class="font-serif text-2xl text-strong">Package roots</h4>
          </div>
          ${ensureArray(roots.package).length
            ? `<ul class="env-inventory-simple-list">${ensureArray(roots.package).map((entry) => `<li>${renderInlineCode(entry)}</li>`).join("")}</ul>`
            : '<p class="text-sm leading-6 text-muted">None</p>'}
        </section>
        <section>
          <div class="env-inventory-section-header">
            <h4 class="font-serif text-2xl text-strong">Root-level config roots</h4>
          </div>
          ${ensureArray(roots.root).length
            ? `<ul class="env-inventory-simple-list">${ensureArray(roots.root).map((entry) => `<li>${renderInlineCode(entry)}</li>`).join("")}</ul>`
            : '<p class="text-sm leading-6 text-muted">None</p>'}
        </section>
      </div>
      ${ensureArray(report.scanWarnings).length
        ? `
          <section class="env-inventory-scan-warnings">
            <div class="env-inventory-section-header">
              <h4 class="font-serif text-2xl text-strong">Scan warnings</h4>
            </div>
            <ul class="env-inventory-simple-list">
              ${ensureArray(report.scanWarnings).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}
            </ul>
          </section>
        `
        : ""}
      <details class="env-inventory-disclosure">
        <summary>Raw JSON metadata</summary>
        ${renderRawBlock(JSON.stringify(report, null, 2), { id: "scan-details-raw-json" })}
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
          const missingExample = usages.length > 0 && !definitions.some((definition) => definition.kind === "envFile" && String(definition.file || "").split("/").pop() === ".env.example");
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
        const rawCopyButtons = Array.from(document.querySelectorAll("[data-copy-raw]"));

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

        async function copyText(text) {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(text);
            return;
          }

          const helper = document.createElement("textarea");
          helper.value = text;
          helper.setAttribute("readonly", "");
          helper.style.position = "absolute";
          helper.style.left = "-9999px";
          document.body.appendChild(helper);
          helper.select();
          const succeeded = document.execCommand("copy");
          document.body.removeChild(helper);
          if (!succeeded) {
            throw new Error("copy failed");
          }
        }

        function setCopyButtonLabel(button, key) {
          const fallbackLabels = {
            default: "Copy",
            success: "Copied",
            error: "Copy unavailable",
          };
          const datasetKey = "copyLabel" + key.charAt(0).toUpperCase() + key.slice(1);
          button.textContent = button.dataset[datasetKey] || fallbackLabels[key];
        }

        function bindRawCopyButtons() {
          rawCopyButtons.forEach((button) => {
            setCopyButtonLabel(button, "default");
            button.addEventListener("click", async () => {
              const targetId = button.dataset.copyTarget;
              const target = targetId ? document.getElementById(targetId) : null;
              const rawText = target ? target.textContent || "" : "";
              if (!rawText) {
                setCopyButtonLabel(button, "error");
                window.clearTimeout(button._copyResetTimer);
                button._copyResetTimer = window.setTimeout(() => setCopyButtonLabel(button, "default"), 1800);
                return;
              }

              try {
                await copyText(rawText);
                setCopyButtonLabel(button, "success");
              } catch {
                setCopyButtonLabel(button, "error");
              }

              window.clearTimeout(button._copyResetTimer);
              button._copyResetTimer = window.setTimeout(() => setCopyButtonLabel(button, "default"), 1800);
            });
          });
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
            controls.body.innerHTML = '<tr><td colspan="6" class="env-inventory-empty-state-cell">No variables match the current filters.</td></tr>';
            return;
          }

          controls.body.innerHTML = visible.map((variable) => [
            "<tr>",
            "<td><code class=\\"env-inventory-inline-code\\">" + escapeHtml(variable.name) + "</code></td>",
            "<td>" + (variable.likelyRequired ? ${JSON.stringify(NO_FALLBACK_LABEL)} : ${JSON.stringify(FALLBACK_LABEL)}) + "</td>",
            "<td>" + variable.definitions.length + "</td>",
            "<td>" + variable.usages.length + "</td>",
            "<td>" + escapeHtml(variable.scopes.join(", ") || "—") + "</td>",
            "<td><code class=\\"env-inventory-inline-code\\">" + escapeHtml(summarizeLocation(variable)) + "</code></td>",
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

        bindRawCopyButtons();
        renderTable();
      })();
    </script>
  `;
}

function renderMetaCards(report, htmlPath) {
  const cards = [
    { label: "App root", value: renderInlineCode(report.app.path) },
    { label: "JSON report path", value: renderInlineCode(report.app.outputPath) },
    { label: "HTML report path", value: renderInlineCode(htmlPath) },
    { label: "Config path", value: renderInlineCode(report.scan?.config?.path || ".agents/env-inventory.config.json") },
  ];

  return `
    <section class="env-inventory-meta-grid">
      ${cards.map((card) => `
        <article class="paper-panel env-inventory-meta-card">
          <div class="env-inventory-meta-label">${escapeHtml(card.label)}</div>
          <div class="text-sm leading-6 text-strong">${card.value}</div>
        </article>
      `).join("")}
    </section>
  `;
}

function renderStandaloneStyles() {
  return `
    :root {
      color-scheme: light;
      --env-bg: #f4f0e8;
      --env-surface: #fffdf8;
      --env-surface-strong: #f7f1e3;
      --env-border: #d8cdb6;
      --env-border-strong: #b7a98b;
      --env-text: #2c2418;
      --env-text-muted: #685c4b;
      --env-accent: #6a4c2a;
      --env-good: #2f6b45;
      --env-warning: #996c00;
      --env-problem: #8a2f2f;
      --env-shadow: 0 16px 40px rgba(73, 54, 22, 0.12);
      --env-code-bg: #f3ecdc;
    }

    * {
      box-sizing: border-box;
    }

    html {
      font-size: 16px;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #f9f5ed 0%, var(--env-bg) 100%);
      color: var(--env-text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    code,
    pre,
    input,
    select,
    button {
      font: inherit;
    }

    .app-shell {
      min-height: 100vh;
    }

    .env-inventory-page {
      width: min(80rem, calc(100vw - 1.5rem));
      margin: 0 auto;
      padding: 1rem 0 2.5rem;
      display: grid;
      gap: 1rem;
    }

    @media (min-width: 40rem) {
      .env-inventory-page {
        width: min(80rem, calc(100vw - 3rem));
        padding-top: 1.5rem;
      }
    }

    .paper-panel,
    .top-bar {
      background: var(--env-surface);
      border: 1px solid var(--env-border);
      border-radius: 1rem;
      box-shadow: var(--env-shadow);
      padding: 1.25rem;
    }

    .env-inventory-header-copy,
    .env-inventory-panel,
    .env-inventory-meta-card,
    .env-inventory-status-card,
    .env-inventory-variable-body,
    .env-inventory-scan-warnings,
    .env-inventory-raw-block,
    .env-inventory-disclosure[open] {
      display: grid;
      gap: 0.75rem;
    }

    .top-bar-title-row,
    .env-inventory-title-row,
    .env-inventory-chip-row,
    .env-inventory-variable-summary,
    .env-inventory-occurrence-top,
    .env-inventory-raw-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }

    .env-inventory-title-row {
      align-items: flex-start;
    }

    .env-inventory-title-row h1,
    .env-inventory-section-header h2,
    .env-inventory-section-header h4,
    .env-inventory-variable-name,
    .env-inventory-meta-label,
    .env-inventory-status-label,
    .env-inventory-status-value,
    .field-label,
    .env-inventory-disclosure > summary {
      margin: 0;
    }

    .font-serif {
      font-family: Georgia, "Times New Roman", Times, serif;
    }

    .text-3xl {
      font-size: clamp(1.75rem, 2.4vw, 2.3rem);
    }

    .text-2xl {
      font-size: clamp(1.2rem, 1.6vw, 1.5rem);
    }

    .text-sm {
      font-size: 0.9375rem;
    }

    .leading-tight {
      line-height: 1.15;
    }

    .leading-6 {
      line-height: 1.6;
    }

    .text-strong {
      color: var(--env-text);
    }

    .text-muted {
      color: var(--env-text-muted);
    }

    .font-medium,
    .font-semibold,
    strong {
      font-weight: 600;
    }

    .mt-3 {
      margin-top: 0.75rem;
    }

    .space-y-2 > * + * {
      margin-top: 0.5rem;
    }

    .env-inventory-alert {
      padding: 0.875rem 1rem;
      border-radius: 0.875rem;
      border: 1px solid color-mix(in srgb, var(--env-warning) 40%, white);
      background: color-mix(in srgb, var(--env-warning) 12%, white);
    }

    .count-chip,
    .touch-button-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      min-height: 2.25rem;
      padding: 0.4rem 0.85rem;
      border-radius: 999px;
      border: 1px solid var(--env-border-strong);
      background: var(--env-surface-strong);
      color: var(--env-text);
      text-decoration: none;
      font-size: 0.9375rem;
      line-height: 1.3;
    }

    .touch-button-secondary {
      cursor: pointer;
    }

    .touch-button-secondary:hover {
      background: color-mix(in srgb, var(--env-surface-strong) 70%, white);
    }

    .env-inventory-chip--good {
      border-color: color-mix(in srgb, var(--env-good) 40%, white);
      color: var(--env-good);
    }

    .env-inventory-chip--warning {
      border-color: color-mix(in srgb, var(--env-warning) 45%, white);
      color: var(--env-warning);
    }

    .env-inventory-chip--problem {
      border-color: color-mix(in srgb, var(--env-problem) 40%, white);
      color: var(--env-problem);
    }

    .env-inventory-chip--accent {
      border-color: color-mix(in srgb, var(--env-accent) 40%, white);
      color: var(--env-accent);
    }

    .env-inventory-meta-grid,
    .env-inventory-status-grid,
    .env-inventory-controls,
    .env-inventory-variable-meta,
    .env-inventory-section-grid,
    .env-inventory-split-grid,
    .env-inventory-variable-grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(0, 1fr);
    }

    @media (min-width: 48rem) {
      .env-inventory-meta-grid,
      .env-inventory-status-grid,
      .env-inventory-controls,
      .env-inventory-variable-meta {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 72rem) {
      .env-inventory-meta-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .env-inventory-status-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .env-inventory-controls {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    .env-inventory-meta-label,
    .env-inventory-status-label {
      color: var(--env-text-muted);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .env-inventory-status-value {
      font-size: 1.8rem;
      line-height: 1.1;
    }

    .env-inventory-status-card--good {
      border-color: color-mix(in srgb, var(--env-good) 20%, var(--env-border));
    }

    .env-inventory-status-card--warning {
      border-color: color-mix(in srgb, var(--env-warning) 28%, var(--env-border));
    }

    .env-inventory-status-card--problem {
      border-color: color-mix(in srgb, var(--env-problem) 25%, var(--env-border));
    }

    .env-inventory-section-header {
      display: grid;
      gap: 0.3rem;
    }

    .env-inventory-inline-code,
    .env-inventory-snippet code,
    .env-inventory-table code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
      background: var(--env-code-bg);
      border: 1px solid var(--env-border);
      border-radius: 0.55rem;
      padding: 0.15rem 0.45rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--env-text);
    }

    .env-inventory-variable-card {
      border-style: dashed;
    }

    .env-inventory-variable-card > summary {
      list-style: none;
      cursor: pointer;
    }

    .env-inventory-variable-card > summary::-webkit-details-marker {
      display: none;
    }

    .env-inventory-variable-summary {
      justify-content: space-between;
    }

    .env-inventory-variable-heading,
    .env-inventory-variable-counts {
      min-width: 0;
    }

    .env-inventory-variable-counts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .env-inventory-occurrence-list,
    .env-inventory-simple-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 0.75rem;
    }

    .env-inventory-occurrence-item,
    .env-inventory-simple-list li {
      padding: 0.85rem 0.95rem;
      border-radius: 0.85rem;
      background: color-mix(in srgb, var(--env-surface) 82%, var(--env-code-bg));
      border: 1px solid color-mix(in srgb, var(--env-border) 65%, white);
    }

    .env-inventory-snippet {
      display: grid;
      gap: 0.5rem;
      margin-top: 0.6rem;
      padding: 0.75rem;
      border-radius: 0.75rem;
      background: var(--env-code-bg);
      border: 1px solid var(--env-border);
    }

    .env-inventory-field {
      display: grid;
      gap: 0.45rem;
    }

    .field-control {
      width: 100%;
      padding: 0.75rem 0.9rem;
      border-radius: 0.85rem;
      border: 1px solid var(--env-border-strong);
      background: #fff;
      color: var(--env-text);
    }

    .env-inventory-control-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.75rem;
    }

    .env-inventory-table-wrap {
      overflow-x: auto;
      border-radius: 0.9rem;
      border: 1px solid var(--env-border);
    }

    .env-inventory-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 40rem;
      background: var(--env-surface);
    }

    .env-inventory-table th,
    .env-inventory-table td {
      padding: 0.8rem 0.9rem;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid color-mix(in srgb, var(--env-border) 75%, white);
    }

    .env-inventory-table thead th {
      font-size: 0.8125rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--env-text-muted);
      background: color-mix(in srgb, var(--env-surface-strong) 65%, white);
    }

    .env-inventory-empty-state-cell {
      text-align: center;
      color: var(--env-text-muted);
    }

    .env-inventory-raw-actions {
      justify-content: flex-end;
    }

    .env-inventory-raw {
      margin: 0;
      padding: 1rem;
      border-radius: 0.9rem;
      border: 1px solid var(--env-border);
      background: var(--env-code-bg);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      color: var(--env-text);
    }

    .env-inventory-disclosure {
      border-top: 1px solid color-mix(in srgb, var(--env-border) 75%, white);
      padding-top: 1rem;
    }

    .env-inventory-disclosure > summary {
      cursor: pointer;
      font-weight: 600;
    }
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
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(pageTitle)}</title>
    <style>${renderStandaloneStyles()}</style>
  </head>
  <body class="app-shell">
    <main class="env-inventory-page">
      <header class="top-bar">
        <div class="env-inventory-header-copy">
          <div class="top-bar-title-row env-inventory-title-row">
            <span class="count-chip env-inventory-chip env-inventory-chip--accent">${escapeHtml(report.app.name)}</span>
            <h1 class="font-serif text-3xl leading-tight text-strong">Env inventory report</h1>
          </div>
          <p class="text-sm leading-6 text-muted">Self-contained static HTML built from the machine-readable JSON source of truth.</p>
          ${renderWarningBanner(report)}
        </div>
      </header>

      ${renderMetaCards(report, htmlPath)}

      <section class="env-inventory-status-grid">
        ${renderStatusCards(report, derived)}
      </section>

      <div class="env-inventory-section-grid">
        <section class="paper-panel env-inventory-panel">
          <div class="env-inventory-section-header">
            <h2 class="font-serif text-2xl text-strong">Inventory model</h2>
            <p class="text-sm leading-6 text-muted">Required vs optional is inferred from observed fallback usage. Variables with a ${renderInlineCode("default")} usage are treated as optional for this report.</p>
          </div>
          <div class="env-inventory-chip-row">
            <span class="count-chip env-inventory-chip env-inventory-chip--warning">${NO_FALLBACK_LABEL}</span>
            <span class="count-chip env-inventory-chip env-inventory-chip--good">${FALLBACK_LABEL}</span>
            <span class="count-chip env-inventory-chip env-inventory-chip--problem">Secret-like</span>
            <span class="count-chip env-inventory-chip env-inventory-chip--accent">Public-like</span>
          </div>
        </section>
        ${renderCoverageGaps(derived)}
      </div>

      ${renderVariableGroup("No fallback observed", "Variables with usages but no observed in-code fallback/default.", derived.required, "required")}
      ${renderVariableGroup("Fallbacks observed", "Variables where the report found an explicit default/fallback path.", derived.optional, "optional")}
      ${renderDynamicAccesses(report)}
      ${renderExplorer(report, derived)}
      ${renderScanDetails(report)}
    </main>
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
    "  node <skill-dir>/scripts/render-env-inventory-html.mjs --input apps/app-a/doc/env-inventory.json",
    "  node <skill-dir>/scripts/render-env-inventory-html.mjs --input apps/app-a/doc/env-inventory.json --output apps/app-a/docs/env-inventory.html",
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
