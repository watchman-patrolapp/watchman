// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import 'leaflet/dist/leaflet.css'  // ✅ ADD THIS - Leaflet base styles
import './utils/leaflet-icons'      // ✅ Leaflet icon fix — MUST be before any map loads
import { AuthProvider } from './auth/AuthProvider'
import ErrorBoundary from './components/ErrorBoundary'
import { Toaster } from 'react-hot-toast'
import { supabase } from './supabase/client';
window.supabase = supabase;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <Toaster position="top-right" />
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)