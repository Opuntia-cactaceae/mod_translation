import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { DraftJobSelectionProvider } from './contexts/DraftJobSelectionContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DraftJobSelectionProvider>
        <App />
      </DraftJobSelectionProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
