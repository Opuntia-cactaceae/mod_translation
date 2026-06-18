/* ------------------------------------------------------------------ */
/*  Shared detail field used in job summary & config sections          */
/* ------------------------------------------------------------------ */

export default function JobDetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="job-detail-field">
      <span className="job-detail-field-label">{label}</span>
      <span className={`job-detail-field-value${mono ? ' mono' : ''}`}>
        {value || '\u2014'}
      </span>
    </div>
  );
}
