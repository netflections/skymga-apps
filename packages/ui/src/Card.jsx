export default function Card({ children, className = '', ...props }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-6 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  )
}
