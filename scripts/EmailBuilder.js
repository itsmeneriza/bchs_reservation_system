/**
 * EmailBuilder — shared HTML email template builder for server.js.
 *
 * All six notification emails share the same outer wrapper (maroon header,
 * 600 px container, office-hours footer, automated-notice disclaimer).
 * This module exposes two helpers:
 *
 *   buildEmailHtml(title, bodyHtml, opts?)   → full email HTML string
 *   buildDetailTable(rows)                   → <table> HTML for reservation details
 *
 * Usage in server.js:
 *   import { buildEmailHtml, buildDetailTable } from './scripts/EmailBuilder.js';
 *
 * CommonJS only — this module is server-side code exclusively.
 */

'use strict';

// ─── Outer wrapper ────────────────────────────────────────────────────────────

/**
 * Wraps content in the standard BCHS email shell.
 *
 * @param {string} title     - H2 heading text (appears below the maroon bar)
 * @param {string} bodyHtml  - Inner HTML (paragraphs, tables, banners, etc.)
 * @param {object} [opts]
 * @param {string} [opts.titleColor]   - CSS colour for the title (default '#800020')
 * @param {string} [opts.footerNote]   - Extra sentence above the automated disclaimer
 * @returns {string}
 */
function buildEmailHtml(title, bodyHtml, opts = {}) {
    const titleColor = opts.titleColor || '#800020';
    const officeHours = `<p style="color:#64748b;font-size:0.875rem;">
        Office Hours: Monday – Friday, 8:00 AM – 5:00 PM
    </p>`;
    const footer = opts.footerNote
        ? `<p>${opts.footerNote}</p>${officeHours}`
        : officeHours;

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
  <div style="background:#800020;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
    <h2 style="color:white;margin:0;font-size:18px;">BCHS Facility Reservation</h2>
  </div>
  <h3 style="color:${titleColor};margin-bottom:8px;">${title}</h3>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">
  ${footer}
  <p style="font-size:0.75rem;color:#94a3b8;">
    This is an automated notice from the BCHS Reservation System. Please do not reply to this email.
  </p>
</div>`.trim();
}

// ─── Detail table ─────────────────────────────────────────────────────────────

/**
 * Builds a two-column detail table (label / value) for reservation summaries.
 *
 * @param {Array<{label: string, value: string, highlight?: boolean}>} rows
 *   Each row has a label and a value.  Set highlight:true for the maroon accent style.
 * @returns {string}  Full <table>…</table> HTML.
 */
function buildDetailTable(rows) {
    const rowsHtml = rows.map((row, i) => {
        const bg = row.highlight
            ? 'background:#fff5f7;'
            : i % 2 === 1 ? 'background:#f8fafc;' : '';
        const labelStyle = row.highlight
            ? 'padding:10px 12px;color:#800020;font-weight:700;font-size:13px;width:35%;'
            : 'padding:10px 12px;color:#64748b;font-size:13px;width:35%;';
        const valueStyle = row.highlight
            ? 'padding:10px 12px;font-weight:700;color:#800020;'
            : 'padding:10px 12px;font-weight:600;';
        return `<tr style="${bg}">
    <td style="${labelStyle}">${row.label}</td>
    <td style="${valueStyle}">${row.value || '—'}</td>
  </tr>`;
    }).join('\n');

    return `<table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
  ${rowsHtml}
</table>`;
}

// ─── Change-diff table (for admin-edit notifications) ─────────────────────────

/**
 * Builds a three-column before/after diff table for edit notification emails.
 *
 * @param {Array<{field: string, before: string, after: string}>} rows
 * @param {Object<string,string>} [labels]  Optional field → display-label map
 * @returns {string}
 */
function buildDiffTable(rows, labels = {}) {
    const headerStyle = 'padding:8px;text-align:left;font-size:12px;color:#94a3b8;text-transform:uppercase;';
    const rowsHtml = rows.map(({ field, before, after }) => {
        const label = labels[field] || field;
        return `<tr>
    <td style="padding:8px;color:#64748b;font-weight:600;">${label}</td>
    <td style="padding:8px;color:#991b1b;text-decoration:line-through;">${before || '—'}</td>
    <td style="padding:8px;color:#166534;font-weight:700;">${after || '—'}</td>
  </tr>`;
    }).join('\n');

    return `<table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
  <thead>
    <tr style="background:#f8fafc;">
      <th style="${headerStyle}">Field</th>
      <th style="${headerStyle}">Before</th>
      <th style="${headerStyle}">After</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { buildEmailHtml, buildDetailTable, buildDiffTable };
