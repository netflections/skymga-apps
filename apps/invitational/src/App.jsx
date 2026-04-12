import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'

function Home() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="bg-sky-700 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold">MGA Invitational</span>
        </div>
      </nav>
      <main className="mx-auto max-w-4xl px-4 py-12 text-center">
        <h1 className="text-4xl font-bold text-sky-700 mb-4">MGA Invitational Lottery</h1>
        <p className="text-lg text-gray-600">Registration and results coming soon.</p>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}
