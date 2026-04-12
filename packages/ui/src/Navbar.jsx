import { Link } from 'react-router-dom'

export default function Navbar({ brand, links = [], children }) {
  return (
    <nav className="bg-sky-900 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
          {brand}
        </Link>
        <div className="flex items-center gap-6">
          {links.map(({ to, label }) => (
            <Link key={to} to={to} className="text-sm text-sky-100 hover:text-white transition-colors">
              {label}
            </Link>
          ))}
          {children}
        </div>
      </div>
    </nav>
  )
}
