import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const TimeValueSelect = ({ label, value, options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !triggerRef.current) return;

    const updateMenuPosition = () => {
      if (!triggerRef.current) return;

      const rect = triggerRef.current.getBoundingClientRect();
      const gap = 8;
      const estimatedHeight = Math.min(options.length * 40 + 12, 240);
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

      setMenuStyle({
        position: 'fixed',
        zIndex: 10100,
        width: `${rect.width}px`,
        maxHeight: '240px',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--scrollbar-thumb, #cbd5e1) transparent',
        top: openUpward ? 'auto' : `${Math.min(rect.bottom + gap, window.innerHeight - 16)}px`,
        bottom: openUpward ? `${Math.max(window.innerHeight - rect.top + gap, 16)}px` : 'auto',
        left: `${Math.max(16, Math.min(rect.left, window.innerWidth - rect.width - 16))}px`,
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    document.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      document.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, options.length]);

  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase ml-2">{label}</span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`w-full bg-slate-50 dark:bg-slate-900/50 border rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-white outline-none transition-colors flex items-center justify-between ${isOpen ? 'border-primary ring-2 ring-primary/15' : 'border-slate-200 dark:border-slate-700'}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span className="font-medium">{selectedOption?.label}</span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && menuStyle && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          onMouseDown={(event) => event.stopPropagation()}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl p-1 overscroll-contain custom-scrollbar"
          style={menuStyle}
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors ${option.value === value ? 'bg-primary text-white font-semibold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60'}`}
              role="option"
              aria-selected={option.value === value}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

export default TimeValueSelect;
