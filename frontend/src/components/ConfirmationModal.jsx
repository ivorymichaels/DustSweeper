import React from 'react'

export default function ConfirmationModal({ open, onClose, swaps = [], onSubmit, swapping }) {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', padding: 16, maxWidth: 800, width: '90%', borderRadius: 8 }}>
        <h3>Confirm Sweep</h3>
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Token</th>
                <th>Expected Out</th>
                <th>Gas</th>
                <th>Info</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map((s, i) => (
                <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                  <td>{s.token}</td>
                  <td>{s.swap?.expectedAmountOut ?? '-'}</td>
                  <td>{s.swap?.estimatedGas ?? '-'}</td>
                  <td style={{ fontSize: 12, color: '#666' }}>{s.error ? `Error: ${s.error}` : 'OK'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={swapping}>Cancel</button>
          <button onClick={onSubmit} disabled={swapping}>{swapping ? 'Submitting...' : 'Submit sweep'}</button>
        </div>
      </div>
    </div>
  )
}
