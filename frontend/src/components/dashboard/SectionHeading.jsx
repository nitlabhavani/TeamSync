/**
 * Small reusable section heading for dashboard pages — icon + title + an
 * optional muted subtitle, so every section across Student/Guide dashboards
 * reads with the same visual hierarchy instead of ad-hoc headings per page.
 */
const SectionHeading = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-center gap-2">
    {Icon && <Icon className="w-4 h-4 text-brand shrink-0" />}
    <p className="text-sm font-semibold text-slate-ink">{title}</p>
    {subtitle && <span className="text-xs text-slate-muted truncate">— {subtitle}</span>}
  </div>
);

export default SectionHeading;
