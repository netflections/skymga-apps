import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import Register from './pages/Register'
import Accept from './pages/Accept'
import Results from './pages/Results'
import History from './pages/History'

function Root() {
  const { user, loading } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')

  if (loading) return null

  if (error === 'not_member') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <p className="font-semibold text-red-700 mb-1">Email not found</p>
        <p className="text-gray-500 text-sm mb-4">
          Your email address is not in the MGA member roster.
          If you believe this is an error, please contact the tournament coordinator.
        </p>
        <a href="/" className="text-sky-600 hover:text-sky-800 text-sm">← Back</a>
      </div>
    )
  }

  if (error === 'inactive') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <p className="font-semibold text-red-700 mb-1">Inactive membership</p>
        <p className="text-gray-500 text-sm mb-4">
          Your MGA membership is currently inactive. Please contact the tournament coordinator.
        </p>
        <a href="/" className="text-sky-600 hover:text-sky-800 text-sm">← Back</a>
      </div>
    )
  }

  if (user) return <Navigate to="/register" replace />
  return <Login />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Root />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/register" element={<Register />} />
            <Route path="/history" element={<History />} />
            <Route path="/accept/:token" element={<Accept />} />
            <Route path="/results" element={<Results />} />
            <Route path="/results/:year" element={<Results />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
