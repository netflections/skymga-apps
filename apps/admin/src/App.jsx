import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'

function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-sky-700 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold">MGA Admin</span>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold text-sky-700 mb-4">Admin Dashboard</h1>
        <p className="text-gray-600">Member roster, tournament management, and draw console coming soon.</p>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
