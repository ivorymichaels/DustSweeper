import React from 'react'

export default function ErrorBanner({ message }) {
  if (!message) return null
  return (
    <div style={{ background: '#fee', padding: 8, border: '1px solid #f88' }}>
      <strong>Error: </strong>{message}
    </div>
  )
}
