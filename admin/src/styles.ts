import type { CSSProperties } from 'react';

export const styles: Record<string, CSSProperties> = {
  container: { padding: '24px', maxWidth: '800px' },
  title: { fontSize: '24px', fontWeight: 700, marginBottom: '24px' },
  section: { marginBottom: '24px' },
  label: { display: 'block', fontWeight: 600, marginBottom: '8px' },
  select: { width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #dcdce4', fontSize: '14px' },
  input: { padding: '8px 12px', borderRadius: '4px', border: '1px solid #dcdce4', fontSize: '14px' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '16px' },
  th: { textAlign: 'left', padding: '8px 12px', background: '#f6f6f9', borderBottom: '2px solid #dcdce4', fontWeight: 600 },
  td: { padding: '8px 12px', borderBottom: '1px solid #eaeaef' },
  button: { padding: '10px 20px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' },
  primaryButton: { background: '#4945ff', color: '#fff' },
  secondaryButton: { background: '#eaeaef', color: '#32324d', marginLeft: '8px' },
  error: { color: '#d02b20', background: '#fcecea', padding: '12px', borderRadius: '4px', marginBottom: '16px' },
  success: { color: '#328048', background: '#eafbe7', padding: '12px', borderRadius: '4px' },
  warning: { color: '#b5460f', background: '#fdf4dc', padding: '8px 12px', borderRadius: '4px', marginTop: '8px', fontSize: '13px' },
  formatNote: { color: '#4945ff', background: '#f0f0ff', padding: '8px 12px', borderRadius: '4px', marginBottom: '12px', fontSize: '13px' },
  progressBar: { width: '100%', height: '8px', background: '#eaeaef', borderRadius: '4px', marginTop: '12px', overflow: 'hidden' },
  progressFill: { height: '100%', background: '#4945ff', borderRadius: '4px', transition: 'width 0.3s' },
};
