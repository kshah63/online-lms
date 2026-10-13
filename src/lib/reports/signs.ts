/**
 * Whether the author's report publishes directly: staff, support, admin, or a
 * teacher with report_auto_approve. Mirrors submit_report's v_signs_it; when
 * true the form requires a GP and the database publishes on submit, otherwise
 * the report goes to the in-charge as pending.
 */
export function signsReport(p: { role: string; report_auto_approve: boolean }): boolean {
  return p.role === "staff" || p.role === "support" || p.role === "admin" || (p.role === "teacher" && p.report_auto_approve);
}
