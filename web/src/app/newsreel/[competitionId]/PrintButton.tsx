'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="pagebadge print-hide"
      style={{ cursor: 'pointer', border: 'none' }}
    >
      Download PDF
    </button>
  );
}
