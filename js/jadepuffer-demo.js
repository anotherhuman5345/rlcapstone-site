/* UI for the JADEPUFFER detector demo. Loads a sample log, runs the detector
   (js/jadepuffer-detect.js) in the browser, and renders the findings. */

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const ATTACK = `-- synthetic JADEPUFFER-style database activity (test log)
SELECT config_value FROM app_settings WHERE name = 'minio_credentials';
SELECT LOAD_FILE('/var/run/docker.sock');
SELECT name, dl FROM mysql.func;
-- High-ROI databases to drop (data already backed up to staging host)
INSERT INTO users (username, password, enabled) VALUES ('xadmin', '$2a$10$abcdefghijklmnopqrstuvQ9', 1);
INSERT INTO roles (username, role) VALUES ('xadmin', 'ROLE_ADMIN');
CREATE TABLE config_info_enc AS SELECT id, AES_ENCRYPT(content, 'a1b2c3d4-uuid-key') FROM config_info;
SET GLOBAL FOREIGN_KEY_CHECKS = 0;
DROP TABLE config_info;
DROP TABLE his_config_info;
-- nacos is the largest - drop it too
DROP DATABASE nacos;
SET GLOBAL FOREIGN_KEY_CHECKS = 1;
CREATE TABLE README_RANSOM (msg TEXT);
INSERT INTO README_RANSOM (msg) VALUES ('Your data has been encrypted. Pay 0.5 BTC to 3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy to recover it. Contact e78393397@proton.me for the decryptor.');`;

  const BENIGN = `-- normal application database activity
SELECT id, name, price FROM products WHERE category = 'coffee';
INSERT INTO orders (user_id, total_cents) VALUES (42, 1299);
UPDATE users SET last_login = NOW() WHERE id = 42;
SELECT COUNT(*) FROM sessions WHERE active = 1;
CREATE TABLE temp_daily_report AS SELECT user_id, SUM(total_cents) FROM orders GROUP BY user_id;
DROP TABLE temp_daily_report;
INSERT INTO audit_log (action, user_id) VALUES ('checkout', 42);`;

  const LEVEL_CLASS = { CRITICAL: "crit", HIGH: "high", MEDIUM: "med", LOW: "low", CLEAN: "clean" };

  function render(report) {
    const box = $("jp-result");
    box.hidden = false;
    const lvl = LEVEL_CLASS[report.level] || "low";

    let html = `<div class="jp-badge ${lvl}">
        <div class="jp-score">${report.score}<span>/100</span></div>
        <div class="jp-level">${report.level}</div>
      </div>
      <p class="jp-verdict">${report.verdict}</p>`;

    if (report.iocHits.length) {
      html += `<h3>Known indicators matched</h3><ul class="jp-iocs">`;
      report.iocHits.forEach((h) => {
        html += `<li><span class="jp-ioc-type">${h.type}</span> <code>${escapeHtml(h.value)}</code></li>`;
      });
      html += `</ul>`;
    }

    if (report.findings.length) {
      html += `<h3>Behaviour flags (${report.findings.length})</h3><div class="jp-findings">`;
      report.findings.forEach((f) => {
        const loc = f.line ? "line " + f.line : "sequence";
        html += `<div class="jp-finding">
          <div class="jp-finding-head">
            <span class="jp-stage">${escapeHtml(f.stage)}</span>
            <strong>${escapeHtml(f.name)}</strong>
            <span class="jp-meta">${loc} · +${f.weight}</span>
          </div>
          <div class="jp-mitre">${escapeHtml(f.mitre)}</div>
          <p class="jp-why">${escapeHtml(f.why)}</p>
          <code class="jp-ev">${escapeHtml(f.evidence)}</code>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="jp-none">No suspicious behaviours found in this log.</p>`;
    }
    box.innerHTML = html;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function runScan() {
    const text = $("jp-input").value;
    const report = window.jadepuffer.scan(window.jadepuffer.statementsFrom(text));
    render(report);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("jp-input").value = ATTACK;
    $("jp-scan").addEventListener("click", runScan);
    $("jp-load-attack").addEventListener("click", () => { $("jp-input").value = ATTACK; $("jp-result").hidden = true; });
    $("jp-load-benign").addEventListener("click", () => { $("jp-input").value = BENIGN; $("jp-result").hidden = true; });
  });
})();
