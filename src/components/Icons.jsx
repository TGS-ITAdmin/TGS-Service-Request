const base = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const IconCheck = (p) => <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
export const IconClip = (p) => <svg {...base} {...p}><path d="M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9" /></svg>
export const IconComment = (p) => <svg {...base} {...p}><path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1121 12z" /></svg>
export const IconSubtask = (p) => <svg {...base} {...p}><path d="M6 4v8a3 3 0 003 3h8" /><path d="M14 11l4 4-4 4" /></svg>
export const IconPlus = (p) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
export const IconClose = (p) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const IconDownload = (p) => <svg {...base} {...p}><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg>
export const IconFile = (p) => <svg {...base} {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></svg>
export const IconList = (p) => <svg {...base} {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
export const IconBoard = (p) => <svg {...base} {...p}><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></svg>
export const IconFilter = (p) => <svg {...base} {...p}><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>

// Purely visual circle (use inside other buttons). done => filled green with check.
export function CircleIcon({ done, size = 18 }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 rounded-full border items-center justify-center transition-colors ${
        done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-400 text-transparent'
      }`}
      style={{ width: size, height: size }}
    >
      <IconCheck width={size - 6} height={size - 6} strokeWidth={3} />
    </span>
  )
}

// Asana-style clickable completion circle.
export function CompleteCircle({ done, onClick, disabled, size = 18, title }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      disabled={disabled}
      onClick={onClick}
      className={`flex-shrink-0 rounded-full border flex items-center justify-center transition-colors ${
        done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-400 text-transparent hover:border-green-500 hover:text-green-500'
      } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
      style={{ width: size, height: size }}
    >
      <IconCheck width={size - 6} height={size - 6} strokeWidth={3} />
    </button>
  )
}
