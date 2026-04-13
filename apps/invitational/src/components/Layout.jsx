import { Outlet, Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-sky-700 text-white shadow-sm">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-display text-lg font-semibold tracking-wide hover:text-sky-100 transition-colors">
              MGA Invitational
            </Link>
            <NavLink
              to="/results"
              className={({ isActive }) =>
                `text-sm transition-colors ${isActive ? 'text-white font-medium' : 'text-sky-200 hover:text-white'}`
              }
            >
              Results
            </NavLink>
            {user && (
              <NavLink
                to="/history"
                className={({ isActive }) =>
                  `text-sm transition-colors ${isActive ? 'text-white font-medium' : 'text-sky-200 hover:text-white'}`
                }
              >
                My History
              </NavLink>
            )}
          </div>
          {user && (
            <button
              onClick={signOut}
              className="text-sm text-sky-200 hover:text-white transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 sm:px-6 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4 text-center text-xs text-gray-400">
          Sky Meadow Men's Golf Association
        </div>
      </footer>
    </div>
  )
}
