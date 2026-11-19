export function StarButton({ on, onToggle, name }) {
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `Remove ${name} from starred` : `Star ${name}`} title={on ? 'Remove from starred' : 'Add to starred'}
      onClick={(e) => { e.stopPropagation(); onToggle() }} className={`text-lg leading-none ${on ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}>{on ? '★' : '☆'}</button>
  )
}

