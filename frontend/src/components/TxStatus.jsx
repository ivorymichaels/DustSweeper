import React from 'react'

export default function TxStatus({ status }) {
  if (!status) return null
  return (
    <div style={{ marginTop: 12 }}>
      <strong>Transaction status:</strong> {String(status)}
    </div>
  )
}
